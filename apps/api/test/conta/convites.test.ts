import { randomUUID } from 'node:crypto';
import {
  ConsultaConvite,
  Convite,
  ListaConvites,
  ListaPapeis,
  RespostaEu,
  RespostaSessao,
} from '@ebisu/contracts';
import { gerarTokenConvite, hashDoTokenConvite } from '@ebisu/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limitadorEmMemoria } from '../../src/core/limite/limitador.js';
import { ORIGEM_WEB } from '../app-de-teste.js';
import {
  cadastrar,
  type CenarioConta,
  contaNova,
  corpoDeCadastro,
  criarCenarioConta,
  membroCom,
  novoEmail,
  novoMembro,
  SENHA,
} from './cenario.js';

// Convites e aceite (plano docs/planos/f3-4b2-convites.md). O worker é simulado: o teste gera o
// token e grava o hash no convite, como o worker faz no envio.

let c: CenarioConta;
beforeAll(async () => {
  c = await criarCenarioConta();
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

const NOVA_SENHA = 'girassol-teclado-ponte-77';
const http = () => request(c.app.getHttpServer());
const pedir = (token: string, metodo: 'get' | 'post' | 'delete', rota: string, corpo?: object) => {
  const req = http()[metodo](rota).set('Authorization', `Bearer ${token}`);
  if (metodo === 'post') req.set('Idempotency-Key', randomUUID());
  return corpo ? req.send(corpo) : req;
};

interface Conta {
  token: string;
  tenantId: string;
  empresaId: string;
  papeis: Record<string, string>;
}

async function conta(nome: string): Promise<Conta> {
  const { token, tenantId } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse(
    (await http().get('/v1/eu').set('Authorization', `Bearer ${token}`)).body,
  );
  const papeis = ListaPapeis.parse((await pedir(token, 'get', '/v1/papeis')).body).dados;
  return {
    token,
    tenantId,
    empresaId: eu.empresas[0]!.id,
    papeis: Object.fromEntries(papeis.map((p) => [p.chave, p.id])),
  };
}

type Atribuicoes = Array<{ papel_id: string | undefined; empresa_id: string | null }>;
const atendente = (x: Conta): Atribuicoes => [
  { papel_id: x.papeis.ATENDENTE, empresa_id: x.empresaId },
];

async function convidar(x: Conta, email: string, atribuicoes = atendente(x), token = x.token) {
  return pedir(token, 'post', '/v1/membros/convites', { email, atribuicoes });
}

/** Faz o papel do worker: gera o token do link e grava o hash no convite. */
async function enviar(conviteId: string): Promise<string> {
  const token = gerarTokenConvite();
  await c.sql(`UPDATE convite SET token_hash = $1 WHERE id = $2`, [
    hashDoTokenConvite(token),
    conviteId,
  ]);
  return token;
}

const consultar = (token: string) => http().post('/v1/auth/convites/consultar').send({ token });
const aceitar = (corpo: object) => http().post('/v1/auth/convites/aceitar').send(corpo);
const eu = (token: string) => http().get('/v1/eu').set('Authorization', `Bearer ${token}`);

/** Convite enviado para um e-mail novo; devolve o id e o token do link. */
async function conviteEnviado(
  x: Conta,
  email = novoEmail('convidado'),
  atribuicoes = atendente(x),
) {
  const r = await convidar(x, email, atribuicoes);
  expect(r.status).toBe(201);
  return { id: r.body.id as string, token: await enviar(r.body.id), email };
}

describe('convidar', () => {
  it('cria com os papéis e põe o e-mail no outbox, sem token guardado', async () => {
    const x = await conta('Conta Convida');
    const email = novoEmail('nova.pessoa');
    const r = await convidar(x, email.toUpperCase());
    expect(r.status).toBe(201);
    const convite = Convite.parse(r.body);
    expect(convite).toMatchObject({ email, expirado: false, envio: 'PENDENTE' });
    expect(convite.atribuicoes).toEqual([
      { papel: expect.objectContaining({ chave: 'ATENDENTE' }), empresa_id: x.empresaId },
    ]);
    const saida = (await c.sql(`SELECT * FROM email_saida WHERE convite_id = $1`, [convite.id]))
      .rows;
    expect(saida).toEqual([expect.objectContaining({ tipo: 'CONVITE', status: 'PENDENTE' })]);
    const [linha] = (
      await c.sql(`SELECT token_hash, convidado_por FROM convite WHERE id = $1`, [convite.id])
    ).rows;
    expect(linha!.token_hash).toBeNull();
    expect(linha!.convidado_por).not.toBeNull();

    // A rota fixa /membros/convites não cai em /membros/:id.
    const lista = ListaConvites.parse((await pedir(x.token, 'get', '/v1/membros/convites')).body);
    expect(lista.dados.map((d) => d.id)).toEqual([convite.id]);
  });

  it('sem config.rbac dá 403; dono só por um dono; ADMIN convida para os outros papéis', async () => {
    const x = await conta('Conta Permissões');
    const soMembros = await membroCom(c, x.tenantId, { 'config.membros': 'TENANT' }, null);
    expect((await convidar(x, novoEmail(), atendente(x), soMembros)).status).toBe(403);
    const admin = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const comoDono = [{ papel_id: x.papeis.OWNER, empresa_id: null }];
    expect((await convidar(x, novoEmail(), comoDono, admin.token)).status).toBe(403);
    expect((await convidar(x, novoEmail(), atendente(x), admin.token)).status).toBe(201);
    expect((await convidar(x, novoEmail(), comoDono)).status).toBe(201);
    const naEmpresa = [{ papel_id: x.papeis.OWNER, empresa_id: x.empresaId }];
    expect((await convidar(x, novoEmail(), naEmpresa)).status).toBe(422);
  });

  it('e-mail já membro, ou com convite pendente, dá 409; convite vencido dá lugar a outro', async () => {
    const x = await conta('Conta Repetidos');
    const membro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    expect((await convidar(x, membro.email)).status).toBe(409);

    const email = novoEmail('pendente');
    const primeiro = await convidar(x, email);
    const repetido = await convidar(x, email);
    expect(repetido.status).toBe(409);
    expect(repetido.body).toMatchObject({ code: 'duplicado', id_existente: primeiro.body.id });

    await c.sql(`UPDATE convite SET expira_em = now() WHERE id = $1`, [primeiro.body.id]);
    const novo = await convidar(x, email);
    expect(novo.status).toBe(201);
    const [antigo] = (
      await c.sql(`SELECT revogado_em FROM convite WHERE id = $1`, [primeiro.body.id])
    ).rows;
    expect(antigo!.revogado_em).not.toBeNull();
  });

  it('repetir o POST com a mesma Idempotency-Key devolve o mesmo convite', async () => {
    const x = await conta('Conta Idempotente');
    const chave = randomUUID();
    const corpo = { email: novoEmail(), atribuicoes: atendente(x) };
    const enviarCom = () =>
      http()
        .post('/v1/membros/convites')
        .set('Authorization', `Bearer ${x.token}`)
        .set('Idempotency-Key', chave)
        .send(corpo);
    const [a, b] = [await enviarCom(), await enviarCom()];
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    const saida = (
      await c.sql(`SELECT count(*) AS n FROM email_saida WHERE convite_id = $1`, [a.body.id])
    ).rows;
    expect(Number(saida[0]!.n)).toBe(1);
  });
});

describe('reenviar e revogar', () => {
  it('reenviar invalida o link anterior, cancela o e-mail pendente e põe outro no outbox', async () => {
    const x = await conta('Conta Reenvia');
    const { id, token } = await conviteEnviado(x);
    expect((await consultar(token)).status).toBe(200);
    const r = await pedir(x.token, 'post', `/v1/membros/convites/${id}/reenviar`);
    expect(r.status).toBe(200);
    expect((await consultar(token)).status).toBe(410);
    const status = (
      await c.sql(`SELECT status FROM email_saida WHERE convite_id = $1 ORDER BY created_at`, [id])
    ).rows.map((l) => l.status);
    expect(status).toEqual(['CANCELADO', 'PENDENTE']);
    expect((await consultar(await enviar(id))).status).toBe(200);
  });

  it('revogar derruba o link na hora; repetir não muda; reenviar revogado dá 409', async () => {
    const x = await conta('Conta Revoga');
    const { id, token } = await conviteEnviado(x);
    expect((await pedir(x.token, 'delete', `/v1/membros/convites/${id}`)).status).toBe(204);
    expect((await consultar(token)).status).toBe(410);
    expect((await aceitar({ token, nome: 'X', senha: NOVA_SENHA })).status).toBe(410);
    expect((await pedir(x.token, 'delete', `/v1/membros/convites/${id}`)).status).toBe(204);
    expect((await pedir(x.token, 'post', `/v1/membros/convites/${id}/reenviar`)).status).toBe(409);
    const lista = ListaConvites.parse((await pedir(x.token, 'get', '/v1/membros/convites')).body);
    expect(lista.dados.map((d) => d.id)).not.toContain(id);
  });

  it('convite de dono só é revogado por um dono', async () => {
    const x = await conta('Conta Revoga Dono');
    const admin = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const r = await convidar(x, novoEmail(), [{ papel_id: x.papeis.OWNER, empresa_id: null }]);
    expect(r.status).toBe(201);
    expect((await pedir(admin.token, 'delete', `/v1/membros/convites/${r.body.id}`)).status).toBe(
      403,
    );
    expect((await pedir(x.token, 'delete', `/v1/membros/convites/${r.body.id}`)).status).toBe(204);
  });

  it('convidar e reenviar têm limite (por e-mail de destino e por convite): 429', async () => {
    // Cada app de teste tem a própria chave do JWT: a conta nasce no app com o limitador real.
    const limitado = await c.criarApp(limitadorEmMemoria());
    const { token, tenantId } = await contaNova(limitado, { conta: { nome: 'Conta Limitada' } });
    // Conta com mais de 24 h: fora do limite de conta nova (testado à parte).
    await c.sql(`UPDATE tenant SET created_at = now() - interval '2 days' WHERE id = $1`, [
      tenantId,
    ]);
    const empresaId = (
      await request(limitado.getHttpServer()).get('/v1/eu').set('Authorization', `Bearer ${token}`)
    ).body.empresas[0].id as string;
    const papeis = ListaPapeis.parse(
      (
        await request(limitado.getHttpServer())
          .get('/v1/papeis')
          .set('Authorization', `Bearer ${token}`)
      ).body,
    ).dados;
    const x = {
      token,
      tenantId: '',
      empresaId,
      papeis: Object.fromEntries(papeis.map((p) => [p.chave, p.id])),
    };
    const viaLimitado = (rota: string, corpo?: object) => {
      const req = request(limitado.getHttpServer())
        .post(rota)
        .set('Authorization', `Bearer ${x.token}`)
        .set('Idempotency-Key', randomUUID());
      return corpo ? req.send(corpo) : req;
    };
    const email = novoEmail('insistente');
    const corpo = { email, atribuicoes: atendente(x) };
    const status: number[] = [];
    for (let i = 0; i < 4; i++)
      status.push((await viaLimitado('/v1/membros/convites', corpo)).status);
    expect(status).toEqual([201, 409, 409, 429]);

    const outro = await viaLimitado('/v1/membros/convites', {
      email: novoEmail(),
      atribuicoes: atendente(x),
    });
    const reenvios: number[] = [];
    for (let i = 0; i < 4; i++)
      reenvios.push((await viaLimitado(`/v1/membros/convites/${outro.body.id}/reenviar`)).status);
    expect(reenvios).toEqual([200, 200, 200, 429]);
  });

  it('conta nova (menos de 24 h) manda no máximo 5 convites; repetir com a mesma chave não gasta cota', async () => {
    const limitado = await c.criarApp(limitadorEmMemoria());
    const { token } = await contaNova(limitado, { conta: { nome: 'Conta Recém-Criada' } });
    const http2 = () => request(limitado.getHttpServer());
    const papeis = ListaPapeis.parse(
      (await http2().get('/v1/papeis').set('Authorization', `Bearer ${token}`)).body,
    ).dados;
    const atribuicoes = [
      { papel_id: papeis.find((p) => p.chave === 'ADMIN')!.id, empresa_id: null },
    ];
    const convidarCom = (chave: string, email: string) =>
      http2()
        .post('/v1/membros/convites')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', chave)
        .send({ email, atribuicoes });

    // A mesma requisição repetida devolve a resposta salva sem contar no limite.
    const chave = randomUUID();
    const email = novoEmail('repetido');
    const repeticoes = [];
    for (let i = 0; i < 5; i++) repeticoes.push(await convidarCom(chave, email));
    expect(repeticoes.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(repeticoes.map((r) => r.body.id)).size).toBe(1);

    const status: number[] = [];
    for (let i = 0; i < 5; i++) status.push((await convidarCom(randomUUID(), novoEmail())).status);
    expect(status).toEqual([201, 201, 201, 201, 429]);
  });

  it('tentativas barradas de uma conta não esgotam o teto global das outras', async () => {
    const limitado = await c.criarApp(limitadorEmMemoria());
    const http2 = () => request(limitado.getHttpServer());
    // Atacante: conta recém-cadastrada martelando reenvios de convites que nem existem.
    const atacante = await contaNova(limitado, { conta: { nome: 'Conta Atacante' } });
    const status = new Map<number, number>();
    for (let i = 0; i < 310; i++) {
      const r = await http2()
        .post(`/v1/membros/convites/${randomUUID()}/reenviar`)
        .set('Authorization', `Bearer ${atacante.token}`)
        .set('Idempotency-Key', randomUUID());
      status.set(r.status, (status.get(r.status) ?? 0) + 1);
    }
    expect(status.get(429)).toBeGreaterThan(0);
    // Vítima: conta antiga, dentro da própria cota, segue convidando.
    const vitima = await contaNova(limitado, { conta: { nome: 'Conta Vítima Antiga' } });
    await c.sql(`UPDATE tenant SET created_at = now() - interval '2 days' WHERE id = $1`, [
      vitima.tenantId,
    ]);
    const papeis = ListaPapeis.parse(
      (await http2().get('/v1/papeis').set('Authorization', `Bearer ${vitima.token}`)).body,
    ).dados;
    const r = await http2()
      .post('/v1/membros/convites')
      .set('Authorization', `Bearer ${vitima.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        email: novoEmail(),
        atribuicoes: [{ papel_id: papeis.find((p) => p.chave === 'ADMIN')!.id, empresa_id: null }],
      });
    expect(r.status).toBe(201);
    // 310 requisições: no runner do CI passa dos 5 s padrão.
  }, 30_000);

  it('convite de outra conta dá 404', async () => {
    const x = await conta('Conta Daqui');
    const y = await conta('Conta de Lá');
    const { id } = await conviteEnviado(y);
    expect((await pedir(x.token, 'post', `/v1/membros/convites/${id}/reenviar`)).status).toBe(404);
    expect((await pedir(x.token, 'delete', `/v1/membros/convites/${id}`)).status).toBe(404);
  });
});

describe('aceitar', () => {
  it('e-mail novo: cria o acesso verificado e entra na conta com os papéis do convite', async () => {
    const x = await conta('Conta Recebe');
    const { id, token, email } = await conviteEnviado(x);
    expect(ConsultaConvite.parse((await consultar(token)).body)).toEqual({
      conta: { nome: 'Conta Recebe' },
      email,
      acao: 'CRIAR_ACESSO',
    });
    expect((await aceitar({ token, senha: NOVA_SENHA })).status).toBe(422);

    const r = await aceitar({ token, nome: 'Rita Prado', senha: NOVA_SENHA });
    expect(r.status).toBe(201);
    const sessao = RespostaSessao.parse(r.body);
    expect(sessao.conta.tenant_id).toBe(x.tenantId);
    const perfil = RespostaEu.parse((await eu(sessao.access_token)).body);
    expect(perfil.usuario).toMatchObject({ nome: 'Rita Prado', email });
    expect(perfil.empresas.map((e) => e.id)).toEqual([x.empresaId]);
    expect(perfil.empresas[0]!.permissoes['contato.read']).toBeDefined();

    const [usuario] = (
      await c.sql(`SELECT email_verificado_em FROM usuario WHERE email = $1`, [email])
    ).rows;
    expect(usuario!.email_verificado_em).not.toBeNull();
    const [convite] = (await c.sql(`SELECT aceito_em, token_hash FROM convite WHERE id = $1`, [id]))
      .rows;
    expect(convite).toMatchObject({ aceito_em: expect.any(Date), token_hash: null });
    // O audit log tem o novo membro como autor.
    const [auditoria] = (
      await c.sql(
        `SELECT ator_membro_id, entidade_id FROM audit_log WHERE entidade_tipo = 'membro' AND acao = 'create' AND entidade_id = $1`,
        [perfil.membro.id],
      )
    ).rows;
    expect(auditoria!.ator_membro_id).toBe(perfil.membro.id);

    // O link vale uma vez.
    expect((await consultar(token)).status).toBe(410);
    expect((await aceitar({ token, nome: 'Rita Prado', senha: NOVA_SENHA })).status).toBe(410);
  });

  it('usuário verificado: precisa da senha dele (401 sem mexer em nada); com ela, ganha a conta', async () => {
    const x = await conta('Conta Verificado');
    const outra = await conta('Conta Original');
    const pessoa = await novoMembro(c, outra.tenantId, 'ATENDENTE', outra.empresaId);
    await c.sql(`UPDATE usuario SET email_verificado_em = now() WHERE email = $1`, [pessoa.email]);
    const { token } = await conviteEnviado(x, pessoa.email);
    expect(ConsultaConvite.parse((await consultar(token)).body).acao).toBe('SENHA_ATUAL');

    const errada = await aceitar({ token, senha: 'senha-que-nao-e-dela-1' });
    expect(errada.status).toBe(401);
    const membros = (
      await c.sql(
        `SELECT count(*) AS n FROM membro m JOIN usuario u ON u.id = m.usuario_id WHERE u.email = $1`,
        [pessoa.email],
      )
    ).rows;
    expect(Number(membros[0]!.n)).toBe(1);

    const r = await aceitar({ token, senha: SENHA });
    expect(r.status).toBe(201);
    const sessao = RespostaSessao.parse(r.body);
    expect(sessao.conta.tenant_id).toBe(x.tenantId);
    expect(sessao.contas.map((k) => k.tenant_id).sort()).toEqual(
      [x.tenantId, outra.tenantId].sort(),
    );
  });

  it('e-mail não verificado (cadastro de outra pessoa): senha nova, sessões antigas caem', async () => {
    const x = await conta('Conta Vítima');
    // Alguém cadastrou o e-mail da pessoa antes dela (sem provar a posse).
    const email = novoEmail('sequestrado');
    const cadastro = await cadastrar(
      c.app,
      corpoDeCadastro({ email, conta: { nome: 'Conta do Intruso' } }),
    );
    expect(cadastro.status).toBe(201);
    const cookie = ([] as string[])
      .concat(cadastro.headers['set-cookie'] ?? [])
      .find((l) => l.startsWith('__Host-ebisu_refresh='))!
      .split(';')[0]!;

    const { token } = await conviteEnviado(x, email);
    expect(ConsultaConvite.parse((await consultar(token)).body).acao).toBe('NOVA_SENHA');
    expect((await aceitar({ token, senha: 'curta' })).status).toBe(422);

    const r = await aceitar({ token, senha: NOVA_SENHA });
    expect(r.status).toBe(201);
    const refresh = await http()
      .post('/v1/auth/refresh')
      .set('Origin', ORIGEM_WEB)
      .set('Cookie', cookie);
    expect(refresh.status).toBe(401);
    expect((await http().post('/v1/auth/login').send({ email, senha: SENHA })).status).toBe(401);
    expect((await http().post('/v1/auth/login').send({ email, senha: NOVA_SENHA })).status).toBe(
      200,
    );
    const [usuario] = (
      await c.sql(`SELECT email_verificado_em FROM usuario WHERE email = $1`, [email])
    ).rows;
    expect(usuario!.email_verificado_em).not.toBeNull();
  });

  it('aceite que vai falhar não mexe na senha nem nas sessões do não verificado', async () => {
    const x = await conta('Conta Ordem');
    const email = novoEmail('ordem');
    const cadastro = await cadastrar(
      c.app,
      corpoDeCadastro({ email, conta: { nome: 'Conta Própria' } }),
    );
    expect(cadastro.status).toBe(201);
    const { token } = await conviteEnviado(x, email);
    // Ele já virou membro da conta por outro caminho: o aceite vai dar 409.
    const [usuario] = (await c.sql(`SELECT id FROM usuario WHERE email = $1`, [email])).rows;
    await c.sql(
      `INSERT INTO membro (id, tenant_id, usuario_id, status, updated_at) VALUES ($1, $2, $3, 'ATIVO', now())`,
      [randomUUID(), x.tenantId, usuario!.id],
    );
    const r = await aceitar({ token, senha: NOVA_SENHA });
    expect(r.status).toBe(409);
    expect((await http().post('/v1/auth/login').send({ email, senha: SENHA })).status).toBe(200);
    const [depois] = (
      await c.sql(`SELECT email_verificado_em FROM usuario WHERE email = $1`, [email])
    ).rows;
    expect(depois!.email_verificado_em).toBeNull();
  });

  it('usuário inativo dá 401', async () => {
    const x = await conta('Conta Inativo');
    const outra = await conta('Conta do Inativo');
    const pessoa = await novoMembro(c, outra.tenantId, 'ATENDENTE', outra.empresaId);
    await c.sql(`UPDATE usuario SET ativo = false WHERE email = $1`, [pessoa.email]);
    const { token } = await conviteEnviado(x, pessoa.email);
    expect((await aceitar({ token, senha: SENHA })).status).toBe(401);
  });

  it('token desconhecido ou vencido dá 410; papel removido ou empresa desativada dão 409', async () => {
    const x = await conta('Conta Mudou');
    expect((await consultar(gerarTokenConvite())).status).toBe(410);
    expect((await consultar('curto')).status).toBe(422);

    const vencido = await conviteEnviado(x);
    await c.sql(`UPDATE convite SET expira_em = now() WHERE id = $1`, [vencido.id]);
    expect((await consultar(vencido.token)).status).toBe(410);

    const papelId = randomUUID();
    await c.sql(
      `INSERT INTO papel (id, tenant_id, chave, nome, updated_at) VALUES ($1, $2, 'TEMP', 'Temp', now())`,
      [papelId, x.tenantId],
    );
    const comPapel = await conviteEnviado(x, novoEmail(), [
      { papel_id: papelId, empresa_id: null },
    ]);
    await c.sql(`DELETE FROM papel WHERE id = $1`, [papelId]);
    expect((await aceitar({ token: comPapel.token, nome: 'X Y', senha: NOVA_SENHA })).status).toBe(
      409,
    );

    const segunda = (
      await pedir(x.token, 'post', '/v1/empresas', {
        razao_social: 'Filial',
        nome_fantasia: 'Filial',
      })
    ).body.id as string;
    const naFilial = await conviteEnviado(x, novoEmail(), [
      { papel_id: x.papeis.ATENDENTE!, empresa_id: segunda },
    ]);
    expect((await pedir(x.token, 'delete', `/v1/empresas/${segunda}`)).status).toBe(204);
    const r = await aceitar({ token: naFilial.token, nome: 'X Y', senha: NOVA_SENHA });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('transicao_invalida');
  });

  it('quem virou membro depois do convite recebe 409 no aceite', async () => {
    const x = await conta('Conta Já Membro');
    const outra = await conta('Conta Antiga');
    const pessoa = await novoMembro(c, outra.tenantId, 'ATENDENTE', outra.empresaId);
    await c.sql(`UPDATE usuario SET email_verificado_em = now() WHERE email = $1`, [pessoa.email]);
    const { token } = await conviteEnviado(x, pessoa.email);
    const [usuario] = (await c.sql(`SELECT id FROM usuario WHERE email = $1`, [pessoa.email])).rows;
    await c.sql(
      `INSERT INTO membro (id, tenant_id, usuario_id, status, updated_at) VALUES ($1, $2, $3, 'ATIVO', now())`,
      [randomUUID(), x.tenantId, usuario!.id],
    );
    const r = await aceitar({ token, senha: SENHA });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('duplicado');
  });

  it('consulta e aceite têm limite por IP (429)', async () => {
    const limitado = await c.criarApp(limitadorEmMemoria());
    const tentar = () =>
      request(limitado.getHttpServer())
        .post('/v1/auth/convites/consultar')
        .send({ token: gerarTokenConvite() });
    for (let i = 0; i < 20; i++) expect((await tentar()).status).toBe(410);
    const r = await tentar();
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });
});
