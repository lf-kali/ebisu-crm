import { CATALOGO_PERMISSOES } from '@ebisu/db';
import { RespostaEu, RespostaSessao } from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limitadorEmMemoria } from '../../src/core/limite/limitador.js';
import {
  cadastrar,
  type CenarioConta,
  corpoDeCadastro,
  criarCenarioConta,
  novoEmail,
  SENHA,
} from './cenario.js';

// POST /v1/auth/registrar (plano docs/planos/f3-4a-cadastro-empresas.md, decisões 1 a 7).

let c: CenarioConta;
beforeAll(async () => {
  c = await criarCenarioConta();
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

const COOKIE = '__Host-ebisu_refresh';
const registrar = (corpo: object) => cadastrar(c.app, corpo);
const contas = async () => Number((await c.sql(`SELECT count(*) AS n FROM tenant`)).rows[0]!.n);

describe('cadastro de conta', () => {
  it('cria conta em teste, empresa, padrões e dono, e já abre a sessão', async () => {
    const corpo = corpoDeCadastro({
      empresa: {
        razao_social: 'Duarte Assistência Técnica Ltda',
        nome_fantasia: 'Duarte Centro',
        cnpj: '11.222.333/0001-81',
      },
    });
    const r = await registrar(corpo);
    expect(r.status).toBe(201);
    const sessao = RespostaSessao.parse(r.body);
    expect(sessao.conta).toMatchObject({ nome: 'Assistência Duarte', slug: 'assistencia-duarte' });
    expect(sessao.contas).toEqual([sessao.conta]);
    expect(([] as string[]).concat(r.headers['set-cookie'] ?? []).join()).toContain(`${COOKIE}=`);

    const eu = await request(c.app.getHttpServer())
      .get('/v1/eu')
      .set('Authorization', `Bearer ${sessao.access_token}`);
    expect(eu.status).toBe(200);
    const { empresas, usuario } = RespostaEu.parse(eu.body);
    expect(usuario).toMatchObject({ nome: 'Marina Duarte', email: corpo.email });
    expect(empresas).toHaveLength(1);
    expect(empresas[0]!.nome_fantasia).toBe('Duarte Centro');
    // Dono: todas as permissões do catálogo, em todas as empresas.
    expect(Object.keys(empresas[0]!.permissoes)).toHaveLength(CATALOGO_PERMISSOES.length);
    expect(new Set(Object.values(empresas[0]!.permissoes))).toEqual(new Set(['TENANT']));

    const tenantId = sessao.conta.tenant_id;
    const [tenant] = (await c.sql(`SELECT status FROM tenant WHERE id = $1`, [tenantId])).rows;
    expect(tenant!.status).toBe('TRIAL');
    const [empresa] = (await c.sql(`SELECT id, cnpj FROM empresa WHERE tenant_id = $1`, [tenantId]))
      .rows;
    expect(empresa!.cnpj).toBe('11222333000181');
    const [dono] = (
      await c.sql(
        `SELECT m.status, a.empresa_id, p.chave FROM membro m
           JOIN atribuicao_papel a ON a.membro_id = m.id JOIN papel p ON p.id = a.papel_id
          WHERE m.tenant_id = $1`,
        [tenantId],
      )
    ).rows;
    expect(dono).toEqual({ status: 'ATIVO', empresa_id: null, chave: 'OWNER' });
    const padroes = (
      await c.sql(
        `SELECT (SELECT count(*) FROM funil WHERE empresa_id = $1 AND padrao) AS funis,
                (SELECT count(*) FROM origem_lead WHERE empresa_id = $1) AS origens,
                (SELECT count(*) FROM motivo_perda WHERE empresa_id = $1) AS motivos,
                (SELECT count(*) FROM papel WHERE tenant_id = $2) AS papeis`,
        [empresa!.id, tenantId],
      )
    ).rows[0]!;
    expect(Number(padroes.funis)).toBe(1);
    expect(Number(padroes.origens)).toBeGreaterThan(0);
    expect(Number(padroes.motivos)).toBeGreaterThan(0);
    expect(Number(padroes.papeis)).toBeGreaterThan(1);
  });

  it('a auditoria registra a criação com o novo dono como autor e o request_id', async () => {
    const r = await registrar(corpoDeCadastro()).set('X-Request-Id', 'cadastro-auditado');
    expect(r.status).toBe(201);
    const tenantId = r.body.conta.tenant_id as string;
    const [membro] = (await c.sql(`SELECT id FROM membro WHERE tenant_id = $1`, [tenantId])).rows;
    const linhas = (
      await c.sql(
        `SELECT entidade_tipo, acao, ator_membro_id, request_id FROM audit_log
          WHERE tenant_id = $1 AND entidade_tipo IN ('membro', 'empresa', 'atribuicao_papel')`,
        [tenantId],
      )
    ).rows;
    expect(linhas.map((l) => l.entidade_tipo).sort()).toEqual([
      'atribuicao_papel',
      'empresa',
      'membro',
    ]);
    for (const linha of linhas)
      expect(linha).toMatchObject({
        acao: 'create',
        ator_membro_id: membro!.id,
        request_id: 'cadastro-auditado',
      });
  });

  it('normaliza o e-mail (maiúsculas)', async () => {
    const email = novoEmail('maiusculas');
    const r = await registrar(corpoDeCadastro({ email: email.toUpperCase() }));
    expect(r.status).toBe(201);
    const linhas = (await c.sql(`SELECT email FROM usuario WHERE email ILIKE $1`, [email])).rows;
    expect(linhas).toEqual([{ email }]);
  });

  it('e-mail existente com a senha certa cria outra conta do mesmo usuário', async () => {
    const email = novoEmail('duas-contas');
    expect((await registrar(corpoDeCadastro({ email }))).status).toBe(201);
    const r = await registrar(corpoDeCadastro({ email, conta: { nome: 'Segunda Loja' } }));
    expect(r.status).toBe(201);
    const sessao = RespostaSessao.parse(r.body);
    expect(sessao.conta.nome).toBe('Segunda Loja');
    expect(sessao.contas).toHaveLength(2);
    const usuarios = (await c.sql(`SELECT id FROM usuario WHERE email = $1`, [email])).rows;
    expect(usuarios).toHaveLength(1);
  });

  it('e-mail existente com outra senha dá 401 e não cria nada', async () => {
    const email = novoEmail('senha-errada');
    expect((await registrar(corpoDeCadastro({ email }))).status).toBe(201);
    const antes = await contas();
    const r = await registrar(corpoDeCadastro({ email, senha: 'outra-senha-bem-longa-9' }));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('nao_autenticado');
    expect(await contas()).toBe(antes);
  });

  it('usuário sem conta (sobra de um cadastro que falhou) conclui ao repetir', async () => {
    const email = novoEmail('sobra');
    // A primeira transação (usuário) passou e a segunda (conta) não: só o usuário existe.
    const { gerarHashSenha } = await import('../../src/modules/auth/senha.js');
    await c.sql(
      `INSERT INTO usuario (id, email, nome, senha_hash, updated_at)
       VALUES (gen_random_uuid(), $1, 'Sobra', $2, now())`,
      [email, await gerarHashSenha(SENHA)],
    );
    const r = await registrar(corpoDeCadastro({ email }));
    expect(r.status).toBe(201);
    expect(RespostaSessao.parse(r.body).contas).toHaveLength(1);
  });

  it.each([
    ['curta (11)', 'a1b2c3d4e5f'],
    ['longa (129)', 'x'.repeat(129)],
    ['vazada', '1qaz2wsx3edc'],
    ['vazada, com outra caixa', 'Q1W2E3R4T5Y6'],
    ['com a parte do e-mail', 'sou-o-fulano.vip-2026'],
    ['com o nome', 'senha-da-MARINA-forte'],
    ['com o sobrenome sem acento', 'xx-duarte-xx-1234'],
  ])('senha %s dá 422 em `senha` e não cria nada', async (_caso, senha) => {
    const antes = await contas();
    const r = await registrar(corpoDeCadastro({ email: 'fulano.vip@cadastro.local', senha }));
    expect(r.status).toBe(422);
    expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'senha' })]);
    expect(await contas()).toBe(antes);
  });

  it('CNPJ inválido na empresa dá 422', async () => {
    const r = await registrar(
      corpoDeCadastro({
        empresa: { razao_social: 'X Ltda', nome_fantasia: 'X', cnpj: '11.222.333/0001-82' },
      }),
    );
    expect(r.status).toBe(422);
    expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'empresa.cnpj' })]);
  });

  it('corpo que não é JSON dá 422 e não cria nada (formulário de outro site)', async () => {
    const antes = await contas();
    const r = await request(c.app.getHttpServer())
      .post('/v1/auth/registrar')
      .type('form')
      .send(corpoDeCadastro());
    expect(r.status).toBe(422);
    expect(r.body.detail).toContain('JSON');
    expect(await contas()).toBe(antes);
  });

  it('slug repetido ganha sufixo numérico', async () => {
    const nome = 'Oficina Única São José';
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await registrar(corpoDeCadastro({ conta: { nome } }));
      expect(r.status).toBe(201);
      slugs.push(r.body.conta.slug);
    }
    expect(slugs).toEqual([
      'oficina-unica-sao-jose',
      'oficina-unica-sao-jose-2',
      'oficina-unica-sao-jose-3',
    ]);
  });

  it('rate limit: o 6º cadastro na hora, do mesmo IP, dá 429 com Retry-After', async () => {
    const limitado = await c.criarApp(limitadorEmMemoria());
    for (let i = 0; i < 5; i++)
      expect((await cadastrar(limitado, corpoDeCadastro())).status).toBe(201);
    const r = await cadastrar(limitado, corpoDeCadastro());
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rate limit: o mesmo e-mail também é limitado, mesmo com erro de senha', async () => {
    const limitado = await c.criarApp(limitadorEmMemoria());
    const email = novoEmail('insistente');
    const corpo = corpoDeCadastro({ email, senha: 'outra-senha-bem-longa-9' });
    expect((await cadastrar(limitado, corpoDeCadastro({ email }))).status).toBe(201);
    for (let i = 0; i < 4; i++) expect((await cadastrar(limitado, corpo)).status).toBe(401);
    expect((await cadastrar(limitado, corpo)).status).toBe(429);
  });
});
