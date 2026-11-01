import { randomUUID } from 'node:crypto';
import {
  Consentimento,
  Contato,
  ListaConsentimentos,
  ListaContatos,
  ListaMotivosPerda,
  ListaOrigens,
  RespostaEu,
} from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta, novoMembro } from '../conta/cenario.js';

// Contatos, consentimentos, origens e motivos de perda (plano docs/planos/f4-1-contatos.md).

let c: CenarioConta;

beforeAll(async () => {
  c = await criarCenarioConta();
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

interface Conta {
  token: string;
  tenantId: string;
  empresaId: string;
  donoId: string;
}

async function conta(nome: string): Promise<Conta> {
  const { token, tenantId } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse(
    (await request(c.app.getHttpServer()).get('/v1/eu').set('Authorization', `Bearer ${token}`))
      .body,
  );
  return { token, tenantId, empresaId: eu.empresas[0]!.id, donoId: eu.membro.id };
}

type Metodo = 'get' | 'post' | 'patch' | 'delete';

function pedir(
  x: { token: string; empresaId: string },
  metodo: Metodo,
  rota: string,
  corpo?: object,
  chave?: string,
) {
  const req = request(c.app.getHttpServer())
    [metodo](rota)
    .set('Authorization', `Bearer ${x.token}`)
    .set('X-Empresa-Id', x.empresaId);
  if (metodo === 'post') req.set('Idempotency-Key', chave ?? randomUUID());
  return corpo ? req.send(corpo) : req;
}

async function criar(x: Conta, corpo: object): Promise<Contato> {
  const r = await pedir(x, 'post', '/v1/contatos', corpo);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return Contato.parse(r.body);
}

const buscar = async (x: Conta, consulta: string) =>
  ListaContatos.parse((await pedir(x, 'get', `/v1/contatos?${consulta}`)).body).dados.map(
    (k) => k.nome,
  );

describe('contatos', () => {
  it('cria com e-mail e telefone normalizados; lê, edita e exclui (soft delete)', async () => {
    const x = await conta('Conta Contatos');
    const criado = await criar(x, {
      nome: 'João da Conceição',
      email: '  Joao.Conceicao@Exemplo.COM ',
      telefone: '(11) 98765-4321',
      documento: '529.982.247-25',
      endereco: { cep: '01310-100', cidade: 'São Paulo', uf: 'sp' },
    });
    expect(criado).toMatchObject({
      empresa_id: x.empresaId,
      email: 'Joao.Conceicao@Exemplo.COM',
      telefone_e164: '+5511987654321',
      whatsapp_e164: null,
      documento: '52998224725',
      endereco: { cep: '01310-100', cidade: 'São Paulo', uf: 'SP' },
      ciclo_vida: 'LEAD',
      consentimentos: [],
    });
    const [linha] = (
      await c.sql(`SELECT email_normalizado, nome_busca FROM contato WHERE id = $1`, [criado.id])
    ).rows;
    expect(linha).toEqual({
      email_normalizado: 'joao.conceicao@exemplo.com',
      nome_busca: 'joao da conceicao',
    });

    const editado = await pedir(x, 'patch', `/v1/contatos/${criado.id}`, {
      nome: 'João C. Silva',
      whatsapp: '11 98765-4321',
      documento: null,
    });
    expect(editado.status).toBe(200);
    expect(Contato.parse(editado.body)).toMatchObject({
      nome: 'João C. Silva',
      whatsapp_e164: '+5511987654321',
      documento: null,
    });

    // `null` remove o endereço (JSON), como os demais campos opcionais.
    const semEndereco = await pedir(x, 'patch', `/v1/contatos/${criado.id}`, { endereco: null });
    expect(semEndereco.status).toBe(200);
    expect(semEndereco.body.endereco).toBeNull();
    const [banco] = (await c.sql(`SELECT endereco FROM contato WHERE id = $1`, [criado.id])).rows;
    expect(banco!.endereco).toBeNull();

    expect((await pedir(x, 'delete', `/v1/contatos/${criado.id}`)).status).toBe(204);
    expect((await pedir(x, 'get', `/v1/contatos/${criado.id}`)).status).toBe(404);
    const [excluido] = (await c.sql(`SELECT deleted_at FROM contato WHERE id = $1`, [criado.id]))
      .rows;
    expect(excluido!.deleted_at).not.toBeNull();
  });

  it('dedupe: e-mail, telefone ou WhatsApp repetido dá 409 com o id e o campo; excluído libera', async () => {
    const x = await conta('Conta Dedupe');
    const ana = await criar(x, { nome: 'Ana', email: 'ana@loja.test', telefone: '11987650001' });
    for (const [corpo, campo] of [
      [{ nome: 'Outra', email: 'ANA@loja.test' }, 'email'],
      [{ nome: 'Outra', telefone: '+55 11 98765-0001' }, 'telefone'],
    ] as const) {
      const r = await pedir(x, 'post', '/v1/contatos', corpo);
      expect(r.status, campo).toBe(409);
      expect(r.body).toMatchObject({ code: 'duplicado', id_existente: ana.id, campo });
    }
    const bia = await criar(x, { nome: 'Bia', whatsapp: '11987650002' });
    const noPatch = await pedir(x, 'patch', `/v1/contatos/${bia.id}`, { email: 'ana@loja.test' });
    expect(noPatch.status).toBe(409);
    expect(noPatch.body).toMatchObject({ id_existente: ana.id, campo: 'email' });
    // O próprio contato pode regravar o mesmo e-mail.
    expect(
      (await pedir(x, 'patch', `/v1/contatos/${ana.id}`, { email: 'ana@loja.test' })).status,
    ).toBe(200);

    await pedir(x, 'delete', `/v1/contatos/${ana.id}`);
    expect(
      (await pedir(x, 'post', '/v1/contatos', { nome: 'Ana 2', email: 'ana@loja.test' })).status,
    ).toBe(201);
  });

  it('dois POST simultâneos com o mesmo e-mail: um 201 e um 409', async () => {
    const x = await conta('Conta Corrida');
    const respostas = await Promise.all(
      Array.from({ length: 2 }, () =>
        pedir(x, 'post', '/v1/contatos', { nome: 'Corrida', email: 'corrida@loja.test' }),
      ),
    );
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    const { rows } = await c.sql(
      `SELECT count(*)::int AS n FROM contato WHERE email_normalizado = 'corrida@loja.test'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('validação: sem meio de contato, telefone ou CPF inválido, campo derivado: 422', async () => {
    const x = await conta('Conta Validação');
    const casos: Array<[object, string]> = [
      [{ nome: 'Sem meio' }, 'email'],
      [{ nome: 'Fone', telefone: '(11) 1234-5678' }, 'telefone'],
      [{ nome: 'Doc', email: 'doc@loja.test', documento: '111.111.111-11' }, 'documento'],
      [
        { nome: 'PJ', email: 'pj@loja.test', tipo_pessoa: 'PJ', documento: '529.982.247-25' },
        'documento',
      ],
      [{ nome: 'Derivado', email: 'd@loja.test', ciclo_vida: 'CLIENTE' }, ''],
      [{ nome: 'Score', email: 's@loja.test', score_total: 99 }, ''],
    ];
    for (const [corpo, campo] of casos) {
      const r = await pedir(x, 'post', '/v1/contatos', corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(422);
      if (campo)
        expect(
          r.body.campos.map((k: { campo: string }) => k.campo),
          JSON.stringify(corpo),
        ).toContain(campo);
    }
    const k = await criar(x, { nome: 'Único meio', email: 'unico@loja.test' });
    const semMeio = await pedir(x, 'patch', `/v1/contatos/${k.id}`, { email: null });
    expect(semMeio.status).toBe(422);
    const derivado = await pedir(x, 'patch', `/v1/contatos/${k.id}`, { completude_perfil: 100 });
    expect(derivado.status).toBe(422);
  });

  it('origem de outra empresa ou inativa e responsável sem acesso: 422', async () => {
    const x = await conta('Conta Referências');
    const y = await conta('Outra Referências');
    const origemDeY = ListaOrigens.parse((await pedir(y, 'get', '/v1/origens')).body).dados[0]!;
    const r1 = await pedir(x, 'post', '/v1/contatos', {
      nome: 'X',
      email: 'x@a.test',
      origem_id: origemDeY.id,
    });
    expect(r1.status).toBe(422);
    const origem = ListaOrigens.parse((await pedir(x, 'get', '/v1/origens')).body).dados[0]!;
    await pedir(x, 'delete', `/v1/origens/${origem.id}`);
    const r2 = await pedir(x, 'post', '/v1/contatos', {
      nome: 'X',
      email: 'x2@a.test',
      origem_id: origem.id,
    });
    expect(r2.status).toBe(422);
    const r3 = await pedir(x, 'post', '/v1/contatos', {
      nome: 'X',
      email: 'x3@a.test',
      responsavel_id: y.donoId,
    });
    expect(r3.status).toBe(422);
    const r4 = await pedir(x, 'post', '/v1/contatos', {
      nome: 'X',
      email: 'x4@a.test',
      responsavel_id: x.donoId,
    });
    expect(r4.status).toBe(201);
  });

  it('busca por nome sem acento, trecho do e-mail e telefone formatado; filtros', async () => {
    const x = await conta('Conta Busca');
    const origem = ListaOrigens.parse((await pedir(x, 'get', '/v1/origens')).body).dados[0]!;
    await criar(x, { nome: 'João Araújo', email: 'joao@loja.test', origem_id: origem.id });
    await criar(x, { nome: 'Maria Sá', email: 'maria_sa@loja.test', telefone: '(21) 99876-5432' });
    await criar(x, { nome: 'Pedro', email: 'pedro@outra.test' });
    expect(await buscar(x, 'q=joao araujo')).toEqual(['João Araújo']);
    expect(await buscar(x, 'q=ARAÚJO')).toEqual(['João Araújo']);
    expect(await buscar(x, `q=${encodeURIComponent('@loja')}`)).toEqual([
      'Maria Sá',
      'João Araújo',
    ]);
    expect(await buscar(x, `q=${encodeURIComponent('99876-54')}`)).toEqual(['Maria Sá']);
    // `_` e `%` são texto, não curingas do LIKE.
    expect(await buscar(x, 'q=maria_')).toEqual(['Maria Sá']);
    expect(await buscar(x, 'q=a%25a')).toEqual([]);
    expect(await buscar(x, `filtro[origem_id]=${origem.id}`)).toEqual(['João Araújo']);
    const r = await pedir(x, 'get', '/v1/contatos?filtro[desconhecido]=1');
    expect(r.status).toBe(422);
  });

  it('lista paginada do mais recente ao mais antigo', async () => {
    const x = await conta('Conta Páginas');
    for (const n of [1, 2, 3]) await criar(x, { nome: `C${n}`, email: `c${n}@p.test` });
    const p1 = ListaContatos.parse((await pedir(x, 'get', '/v1/contatos?limit=2')).body);
    expect(p1.dados.map((k) => k.nome)).toEqual(['C3', 'C2']);
    const p2 = ListaContatos.parse(
      (await pedir(x, 'get', `/v1/contatos?limit=2&cursor=${p1.proximo_cursor}`)).body,
    );
    expect(p2).toMatchObject({ dados: [{ nome: 'C1' }], proximo_cursor: null });
  });

  it('PROPRIO: só vê e mantém os seus; cria sempre como responsável', async () => {
    const x = await conta('Conta Próprio');
    const vendedor = await novoMembro(
      c,
      x.tenantId,
      { 'contato.read': 'PROPRIO', 'contato.create': 'PROPRIO', 'contato.update': 'PROPRIO' },
      x.empresaId,
    );
    const v = { token: vendedor.token, empresaId: x.empresaId };
    // Com o dono como responsável: é o que o filtro por responsável abaixo tentaria alcançar.
    const doDono = await criar(x, {
      nome: 'Do dono',
      email: 'dono@p.test',
      responsavel_id: x.donoId,
    });
    const r = await pedir(v, 'post', '/v1/contatos', { nome: 'Meu', email: 'meu@p.test' });
    expect(r.status).toBe(201);
    expect(r.body.responsavel_id).toBe(vendedor.membroId);
    const outro = await pedir(v, 'post', '/v1/contatos', {
      nome: 'Para o dono',
      email: 'outro@p.test',
      responsavel_id: x.donoId,
    });
    expect(outro.status).toBe(403);
    const lista = ListaContatos.parse((await pedir(v, 'get', '/v1/contatos')).body);
    expect(lista.dados.map((k) => k.nome)).toEqual(['Meu']);
    expect((await pedir(v, 'get', `/v1/contatos/${doDono.id}`)).status).toBe(404);
    expect((await pedir(v, 'patch', `/v1/contatos/${doDono.id}`, { nome: 'x' })).status).toBe(404);
    const passar = await pedir(v, 'patch', `/v1/contatos/${r.body.id}`, {
      responsavel_id: x.donoId,
    });
    expect(passar.status).toBe(403);
    // Filtrar pelo responsável não substitui o escopo: o contato do dono continua fora.
    const filtrado = ListaContatos.parse(
      (await pedir(v, 'get', `/v1/contatos?filtro[responsavel_id]=${x.donoId}`)).body,
    );
    expect(filtrado.dados).toEqual([]);
    // Dedupe: o 409 diz o campo, mas só traz o id quando o contato é dele.
    const deOutro = await pedir(v, 'post', '/v1/contatos', { nome: 'Cópia', email: 'dono@p.test' });
    expect(deOutro.status).toBe(409);
    expect(deOutro.body.campo).toBe('email');
    expect(deOutro.body).not.toHaveProperty('id_existente');
    const meu = await pedir(v, 'post', '/v1/contatos', { nome: 'Cópia', email: 'meu@p.test' });
    expect(meu.body).toMatchObject({ campo: 'email', id_existente: r.body.id });
  });

  it('POST idempotente e auditoria só com os nomes das colunas', async () => {
    const x = await conta('Conta Idempotente');
    const chave = randomUUID();
    const corpo = { nome: 'Idem', email: 'idem@loja.test' };
    const r1 = await pedir(x, 'post', '/v1/contatos', corpo, chave);
    const r2 = await pedir(x, 'post', '/v1/contatos', corpo, chave);
    expect(r2.body).toEqual(r1.body);
    const { rows } = await c.sql(
      `SELECT acao, diff::text AS diff FROM audit_log WHERE entidade_id = $1`,
      [r1.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff).toContain('email_normalizado');
    expect(rows[0]!.diff).not.toContain('idem@loja.test');
  });
});

describe('consentimentos', () => {
  it('registra, revoga com um registro novo e o contato mostra a situação atual', async () => {
    const x = await conta('Conta Consentimento');
    const k = await criar(x, { nome: 'Consente', whatsapp: '11987659999' });
    const registrar = (concedido: boolean) =>
      pedir(x, 'post', `/v1/contatos/${k.id}/consentimentos`, {
        canal: 'WHATSAPP',
        finalidade: 'MARKETING',
        concedido,
        base_legal: 'consentimento',
        evidencia: { texto: 'Aceito receber ofertas', origem: 'balcão' },
      });
    expect(Consentimento.parse((await registrar(true)).body).concedido).toBe(true);
    expect((await registrar(false)).status).toBe(201);
    const historico = ListaConsentimentos.parse(
      (await pedir(x, 'get', `/v1/contatos/${k.id}/consentimentos`)).body,
    );
    expect(historico.dados.map((d) => d.concedido)).toEqual([false, true]);
    const contato = Contato.parse((await pedir(x, 'get', `/v1/contatos/${k.id}`)).body);
    expect(contato.consentimentos).toEqual([
      expect.objectContaining({ canal: 'WHATSAPP', finalidade: 'MARKETING', concedido: false }),
    ]);
    // Só acrescenta: não há rota de edição nem de exclusão.
    const id = historico.dados[0]!.id;
    expect((await pedir(x, 'patch', `/v1/contatos/${k.id}/consentimentos/${id}`, {})).status).toBe(
      404,
    );
    expect((await pedir(x, 'delete', `/v1/contatos/${k.id}/consentimentos/${id}`)).status).toBe(
      404,
    );
  });
});

describe('origens e motivos de perda', () => {
  it('CRUD de origens; nome repetido dá 409; desativar mantém o contato apontando', async () => {
    const x = await conta('Conta Origens');
    const nova = await pedir(x, 'post', '/v1/origens', { nome: 'Feira', tipo: 'OUTRO' });
    expect(nova.status).toBe(201);
    const repetida = await pedir(x, 'post', '/v1/origens', { nome: 'Feira', tipo: 'BALCAO' });
    expect(repetida.status).toBe(409);
    expect(repetida.body.id_existente).toBe(nova.body.id);
    const k = await criar(x, {
      nome: 'Da feira',
      email: 'feira@loja.test',
      origem_id: nova.body.id,
    });
    expect((await pedir(x, 'delete', `/v1/origens/${nova.body.id}`)).status).toBe(204);
    const lida = await pedir(x, 'get', `/v1/origens/${nova.body.id}`);
    expect(lida.body.ativo).toBe(false);
    expect(Contato.parse((await pedir(x, 'get', `/v1/contatos/${k.id}`)).body).origem_id).toBe(
      nova.body.id,
    );
    const reativada = await pedir(x, 'patch', `/v1/origens/${nova.body.id}`, { ativo: true });
    expect(reativada.body.ativo).toBe(true);
  });

  it('motivos de perda: lista os padrões, cria, renomeia e desativa', async () => {
    const x = await conta('Conta Motivos');
    const padroes = ListaMotivosPerda.parse(
      (await pedir(x, 'get', '/v1/motivos-perda')).body,
    ).dados;
    expect(padroes.length).toBeGreaterThan(0);
    const novo = await pedir(x, 'post', '/v1/motivos-perda', { nome: 'Achou caro' });
    expect(novo.status).toBe(201);
    const outro = await pedir(x, 'post', '/v1/motivos-perda', { nome: 'Sem estoque' });
    const renomear = await pedir(x, 'patch', `/v1/motivos-perda/${outro.body.id}`, {
      nome: 'Achou caro',
    });
    expect(renomear.status).toBe(409);
    expect((await pedir(x, 'delete', `/v1/motivos-perda/${novo.body.id}`)).status).toBe(204);
  });

  it('escrever pede config.crm; ler pede contato.read', async () => {
    const x = await conta('Conta Config CRM');
    const leitor = await novoMembro(c, x.tenantId, { 'contato.read': 'EMPRESA' }, x.empresaId);
    const l = { token: leitor.token, empresaId: x.empresaId };
    expect((await pedir(l, 'get', '/v1/origens')).status).toBe(200);
    expect((await pedir(l, 'post', '/v1/origens', { nome: 'X', tipo: 'OUTRO' })).status).toBe(403);
    expect((await pedir(l, 'post', '/v1/motivos-perda', { nome: 'X' })).status).toBe(403);
  });
});
