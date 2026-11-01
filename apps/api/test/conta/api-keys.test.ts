import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ApiKey, ApiKeyCriada, ListaApiKeys, RespostaEu } from '@ebisu/contracts';
import { hashDaApiKey } from '@ebisu/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limitadorEmMemoria } from '../../src/core/limite/limitador.js';
import { type CenarioConta, contaNova, criarCenarioConta, novoMembro } from './cenario.js';
import { ChavesDeTesteController } from './chaves-de-teste.controller.js';

// API keys e CORS (plano docs/planos/f3-5-api-keys-cors.md): gestão por empresa com
// `config.api_keys`; autenticação por chave só nas rotas marcadas; chave de navegador só em
// /v1/publico/*, a partir das origens cadastradas.

let c: CenarioConta;

beforeAll(async () => {
  c = await criarCenarioConta([ChavesDeTesteController]);
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

const SITE = 'https://www.assistencia.com.br';

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

/** Pedido de gestão (Bearer + X-Empresa-Id); POST leva uma Idempotency-Key nova ou a dada. */
function gestao(
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

const servidor = (escopos = ['contato.read', 'contato.create']) => ({
  tipo: 'SERVIDOR',
  nome: 'n8n',
  escopos,
});
const navegador = (origens = [SITE]) => ({
  tipo: 'NAVEGADOR',
  nome: 'Site',
  origens_cors: origens,
});

async function criarChave(x: Conta, corpo: object): Promise<ApiKeyCriada> {
  const r = await gestao(x, 'post', '/v1/api-keys', corpo);
  expect(r.status).toBe(201);
  return ApiKeyCriada.parse(r.body);
}

/** Pedido com a chave (sem Bearer), no app dado (padrão: o do cenário). */
function comChave(
  token: string,
  metodo: 'get' | 'post' | 'options',
  rota: string,
  app: INestApplication = c.app,
) {
  return request(app.getHttpServer())[metodo](rota).set('X-Api-Key', token);
}

const eco = (token: string) => comChave(token, 'get', '/v1/teste/chaves/eco');
const publica = (token: string, origem: string | null = SITE, app?: INestApplication) => {
  const req = comChave(token, 'post', '/v1/publico/teste', app).set(
    'Idempotency-Key',
    randomUUID(),
  );
  return (origem ? req.set('Origin', origem) : req).send({ nome: 'Lead' });
};

describe('gestão de API keys', () => {
  it('cria dos dois tipos; o token só aparece no POST e o banco guarda só o hash', async () => {
    const x = await conta('Conta Chaves');
    const chave = await criarChave(x, servidor());
    expect(chave).toMatchObject({
      tipo: 'SERVIDOR',
      escopos: ['contato.read', 'contato.create'],
      origens_cors: [],
      criado_por: x.donoId,
      revogada_em: null,
      ultimo_uso: null,
    });
    expect(chave.token).toMatch(/^ebk_live_[A-Za-z0-9_-]{43}$/);
    expect(chave.token!.startsWith(chave.prefixo)).toBe(true);

    const [linha] = (await c.sql(`SELECT hash FROM api_key WHERE id = $1`, [chave.id])).rows;
    expect(linha!.hash).toBe(hashDaApiKey(chave.token!));
    const tudo = JSON.stringify((await c.sql(`SELECT * FROM api_key`)).rows);
    expect(tudo).not.toContain(chave.token);

    const lida = await gestao(x, 'get', `/v1/api-keys/${chave.id}`);
    expect(lida.status).toBe(200);
    expect(lida.body).not.toHaveProperty('token');
    expect(JSON.stringify(lida.body)).not.toContain(chave.token);

    const site = await criarChave(x, navegador([`${SITE}/`, 'http://localhost:5173']));
    expect(site).toMatchObject({
      tipo: 'NAVEGADOR',
      escopos: ['lead.create'],
      origens_cors: [SITE, 'http://localhost:5173'],
    });
  });

  it('repetir o POST com a mesma Idempotency-Key devolve a chave sem o token', async () => {
    const x = await conta('Conta Repete');
    const idem = randomUUID();
    const r1 = await gestao(x, 'post', '/v1/api-keys', servidor(), idem);
    const r2 = await gestao(x, 'post', '/v1/api-keys', servidor(), idem);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.token).toMatch(/^ebk_live_/);
    expect(r2.body).toEqual({ ...r1.body, token: null });
    const salvas = JSON.stringify(
      (await c.sql(`SELECT resposta FROM idempotencia_requisicao`)).rows,
    );
    expect(salvas).not.toContain(r1.body.token);
  });

  it('lista (paginada, revogadas incluídas), edita e revoga (de novo, 204)', async () => {
    const x = await conta('Conta Lista Chaves');
    const a = await criarChave(x, servidor());
    const b = await criarChave(x, navegador());
    const lista = ListaApiKeys.parse((await gestao(x, 'get', '/v1/api-keys?limit=1')).body);
    expect(lista.dados.map((k) => k.id)).toEqual([a.id]);
    const resto = ListaApiKeys.parse(
      (await gestao(x, 'get', `/v1/api-keys?limit=1&cursor=${lista.proximo_cursor}`)).body,
    );
    expect(resto).toMatchObject({ dados: [{ id: b.id }], proximo_cursor: null });

    const editada = await gestao(x, 'patch', `/v1/api-keys/${a.id}`, {
      nome: 'Zapier',
      escopos: ['contato.read'],
    });
    expect(editada.status).toBe(200);
    expect(ApiKey.parse(editada.body)).toMatchObject({ nome: 'Zapier', escopos: ['contato.read'] });
    const origens = await gestao(x, 'patch', `/v1/api-keys/${b.id}`, {
      origens_cors: ['https://loja.com.br'],
    });
    expect(origens.body.origens_cors).toEqual(['https://loja.com.br']);

    expect((await gestao(x, 'delete', `/v1/api-keys/${a.id}`)).status).toBe(204);
    expect((await gestao(x, 'delete', `/v1/api-keys/${a.id}`)).status).toBe(204);
    const revogada = ApiKey.parse((await gestao(x, 'get', `/v1/api-keys/${a.id}`)).body);
    expect(revogada.revogada_em).not.toBeNull();
    const naLista = ListaApiKeys.parse((await gestao(x, 'get', '/v1/api-keys')).body);
    expect(naLista.dados.map((k) => k.id)).toEqual([a.id, b.id]);
    const r = await gestao(x, 'patch', `/v1/api-keys/${a.id}`, { nome: 'Outra' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('transicao_invalida');
  });

  it('escopos sem escalada: fora do catálogo, config.*, sem a permissão, ou no navegador: 422', async () => {
    const x = await conta('Conta Escopos');
    for (const escopos of [['nada.disso'], ['config.api_keys'], ['config.membros']]) {
      const r = await gestao(x, 'post', '/v1/api-keys', servidor(escopos));
      expect(r.status, escopos.join()).toBe(422);
    }
    const navegadorComOutro = await gestao(x, 'post', '/v1/api-keys', {
      ...navegador(),
      escopos: ['contato.read'],
    });
    expect(navegadorComOutro.status).toBe(422);

    // Gestor com config.api_keys e contato.read, mas sem contato.delete.
    const gestor = await novoMembro(
      c,
      x.tenantId,
      { 'config.api_keys': 'EMPRESA', 'contato.read': 'EMPRESA' },
      x.empresaId,
    );
    const g = { token: gestor.token, empresaId: x.empresaId };
    expect((await gestao(g, 'post', '/v1/api-keys', servidor(['contato.read']))).status).toBe(201);
    const escalada = await gestao(g, 'post', '/v1/api-keys', servidor(['contato.delete']));
    expect(escalada.status).toBe(422);
    const chave = await criarChave(x, servidor(['contato.read']));
    const editar = await gestao(g, 'patch', `/v1/api-keys/${chave.id}`, {
      escopos: ['contato.delete'],
    });
    expect(editar.status).toBe(422);

    const s = await criarChave(x, servidor());
    const n = await criarChave(x, navegador());
    const tipoErrado = [
      await gestao(x, 'patch', `/v1/api-keys/${s.id}`, { origens_cors: [SITE] }),
      await gestao(x, 'patch', `/v1/api-keys/${n.id}`, { escopos: ['contato.read'] }),
    ];
    expect(tipoErrado.map((r) => r.status)).toEqual([422, 422]);
    const vencida = await gestao(x, 'post', '/v1/api-keys', {
      ...servidor(),
      expira_em: '2020-01-01T00:00:00Z',
    });
    expect(vencida.status).toBe(422);
  });

  it('origem inválida, com caminho, http fora de localhost, curinga, repetida ou demais: 422', async () => {
    const x = await conta('Conta Origens');
    const invalidas = [
      ['site.com.br'],
      [`${SITE}/form`],
      [`${SITE}?a=1`],
      ['http://www.assistencia.com.br'],
      ['https://*.assistencia.com.br'],
      ['https://user:senha@assistencia.com.br'],
      ['ftp://assistencia.com.br'],
      [SITE, `${SITE}/`],
      Array.from({ length: 11 }, (_, i) => `https://s${i}.com.br`),
      [],
    ];
    for (const origens of invalidas) {
      const r = await gestao(x, 'post', '/v1/api-keys', navegador(origens));
      expect(r.status, JSON.stringify(origens)).toBe(422);
    }
    const semOrigens = await gestao(x, 'post', '/v1/api-keys', { tipo: 'NAVEGADOR', nome: 'X' });
    expect(semOrigens.status).toBe(422);
  });

  it('sem config.api_keys: 403; chave de outra empresa ou conta: 404', async () => {
    const x = await conta('Conta Acesso Chaves');
    const y = await conta('Outra Conta Chaves');
    const semPermissao = await novoMembro(
      c,
      x.tenantId,
      { 'contato.read': 'EMPRESA' },
      x.empresaId,
    );
    const r = await gestao(
      { token: semPermissao.token, empresaId: x.empresaId },
      'get',
      '/v1/api-keys',
    );
    expect(r.status).toBe(403);

    const deY = await criarChave(y, servidor());
    for (const [metodo, corpo] of [['get'], ['patch', { nome: 'x' }], ['delete']] as const) {
      const outra = await gestao(x, metodo, `/v1/api-keys/${deY.id}`, corpo);
      expect(outra.status, metodo).toBe(404);
    }
    expect(ListaApiKeys.parse((await gestao(x, 'get', '/v1/api-keys')).body).dados).toEqual([]);
  });

  it('as rotas de gestão não aceitam API key', async () => {
    const x = await conta('Conta Gestão Sem Chave');
    const chave = await criarChave(x, servidor());
    const r = await comChave(chave.token!, 'get', '/v1/api-keys').set('X-Empresa-Id', x.empresaId);
    expect(r.status).toBe(401);
  });
});

describe('autenticação por chave', () => {
  it('a chave de servidor entra na rota marcada, com a empresa dela e sem membro', async () => {
    const x = await conta('Conta Eco');
    const chave = await criarChave(x, servidor());
    const r = await eco(chave.token!);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      empresa_id: x.empresaId,
      membro_id: null,
      api_key_id: chave.id,
      escopos: ['contato.create', 'contato.read'],
    });
    const mesmaEmpresa = await eco(chave.token!).set('X-Empresa-Id', x.empresaId.toUpperCase());
    expect(mesmaEmpresa.status).toBe(200);
  });

  it('rota sem a marca não aceita chave (pede o Bearer)', async () => {
    const x = await conta('Conta Sem Marca');
    const chave = await criarChave(x, servidor());
    const r = await comChave(chave.token!, 'get', '/v1/teste/chaves/sem-marca').set(
      'X-Empresa-Id',
      x.empresaId,
    );
    expect(r.status).toBe(401);
  });

  it('chave inválida, revogada, vencida, de empresa ou conta inativa: 401', async () => {
    const x = await conta('Conta Inválidas');
    const boa = await criarChave(x, servidor());
    const trocaSegredo = boa.token!.slice(0, -1) + (boa.token!.endsWith('A') ? 'B' : 'A');
    const inexistente = `ebk_live_${'x'.repeat(43)}`;
    for (const token of [trocaSegredo, inexistente, 'qualquer', '']) {
      expect((await eco(token)).status, token).toBe(401);
    }

    const revogada = await criarChave(x, servidor());
    await gestao(x, 'delete', `/v1/api-keys/${revogada.id}`);
    expect((await eco(revogada.token!)).status).toBe(401);

    const vencida = await criarChave(x, { ...servidor(), expira_em: '2099-01-01T00:00:00Z' });
    expect((await eco(vencida.token!)).status).toBe(200);
    await c.sql(`UPDATE api_key SET expira_em = now() - interval '1 minute' WHERE id = $1`, [
      vencida.id,
    ]);
    expect((await eco(vencida.token!)).status).toBe(401);

    const empresa = await conta('Conta Empresa Inativa');
    const daEmpresa = await criarChave(empresa, servidor());
    await c.sql(`UPDATE empresa SET ativo = false WHERE id = $1`, [empresa.empresaId]);
    expect((await eco(daEmpresa.token!)).status).toBe(401);

    const suspensa = await conta('Conta Suspensa');
    const daSuspensa = await criarChave(suspensa, servidor());
    await c.sql(`UPDATE tenant SET status = 'SUSPENSO' WHERE id = $1`, [suspensa.tenantId]);
    expect((await eco(daSuspensa.token!)).status).toBe(401);
  });

  it('escopo faltando ou outra empresa: 403; com Bearer junto: 401', async () => {
    const x = await conta('Conta 403');
    const soCriar = await criarChave(x, servidor(['contato.create']));
    expect((await eco(soCriar.token!)).status).toBe(403);

    const chave = await criarChave(x, servidor());
    const y = await conta('Conta 403 Outra');
    const outra = await eco(chave.token!).set('X-Empresa-Id', y.empresaId);
    expect(outra.status).toBe(403);
    expect(outra.body.code).toBe('empresa_nao_autorizada');

    const ambos = await eco(chave.token!).set('Authorization', `Bearer ${x.token}`);
    expect(ambos.status).toBe(401);
  });

  it('chave de servidor vinda de navegador (com Origin): 403; tipos trocados: 401', async () => {
    const x = await conta('Conta Tipos');
    const s = await criarChave(x, servidor());
    const n = await criarChave(x, navegador());
    const comOrigem = await eco(s.token!).set('Origin', SITE);
    expect(comOrigem.status).toBe(403);
    expect(comOrigem.headers['access-control-allow-origin']).toBeUndefined();
    expect((await eco(n.token!)).status).toBe(401);
    expect((await publica(s.token!, null)).status).toBe(401);
  });

  it('quem criou foi suspenso: a chave continua', async () => {
    const x = await conta('Conta Criador');
    const gestor = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const chave = await criarChave({ ...x, token: gestor.token }, servidor(['contato.read']));
    await c.sql(`UPDATE membro SET status = 'SUSPENSO' WHERE id = $1`, [gestor.membroId]);
    expect((await eco(chave.token!)).status).toBe(200);
  });

  it('o comando roda com a chave como autora (auditoria) e o POST é idempotente', async () => {
    const x = await conta('Conta Autoria');
    const chave = await criarChave(x, servidor());
    const idem = randomUUID();
    const criar = () =>
      comChave(chave.token!, 'post', '/v1/teste/chaves/contatos')
        .set('Idempotency-Key', idem)
        .send({ nome: 'Lead da integração' });
    const r1 = await criar();
    const r2 = await criar();
    expect(r1.status).toBe(201);
    expect(r2.body).toEqual(r1.body);
    const linhas = (
      await c.sql(
        `SELECT ator_membro_id, ator_api_key_id, empresa_id, acao FROM audit_log
          WHERE entidade_id = $1`,
        [r1.body.id],
      )
    ).rows;
    expect(linhas).toEqual([
      {
        ator_membro_id: null,
        ator_api_key_id: chave.id,
        empresa_id: x.empresaId,
        acao: 'create',
      },
    ]);
    const semChave = await comChave(chave.token!, 'post', '/v1/teste/chaves/contatos').send({
      nome: 'x',
    });
    expect(semChave.status).toBe(422);
  });

  it('ultimo_uso é marcado e não regrava dentro do minuto (nem vira auditoria)', async () => {
    const x = await conta('Conta Uso');
    const chave = await criarChave(x, servidor());
    await eco(chave.token!);
    const uso = async () =>
      (await c.sql(`SELECT ultimo_uso FROM api_key WHERE id = $1`, [chave.id])).rows[0]!
        .ultimo_uso as Date;
    const primeiro = await uso();
    expect(primeiro).not.toBeNull();
    await eco(chave.token!);
    expect(await uso()).toEqual(primeiro);
    const auditoria = (await c.sql(`SELECT acao FROM audit_log WHERE entidade_id = $1`, [chave.id]))
      .rows;
    expect(auditoria).toEqual([{ acao: 'create' }]);
    // Gravado em UTC, como as demais colunas (o pg cru leria como hora local).
    const lida = ApiKey.parse((await gestao(x, 'get', `/v1/api-keys/${chave.id}`)).body);
    expect(Math.abs(Date.parse(lida.ultimo_uso!) - Date.now())).toBeLessThan(60_000);
  });
});

describe('CORS das rotas públicas', () => {
  it('preflight em /v1/publico/* responde com os cabeçalhos; fora dali, nenhum', async () => {
    const pre = await request(c.app.getHttpServer())
      .options('/v1/publico/teste')
      .set('Origin', 'https://qualquer.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, x-api-key, idempotency-key');
    expect(pre.status).toBe(204);
    expect(pre.headers).toMatchObject({
      'access-control-allow-origin': 'https://qualquer.com',
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'Content-Type, X-Api-Key, Idempotency-Key',
      'access-control-max-age': '600',
    });
    expect(pre.headers.vary).toContain('Origin');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    for (const rota of ['/v1/eu', '/v1/api-keys', '/v1/auth/login']) {
      const fora = await request(c.app.getHttpServer())
        .options(rota)
        .set('Origin', SITE)
        .set('Access-Control-Request-Method', 'POST');
      expect(fora.headers['access-control-allow-origin'], rota).toBeUndefined();
    }
    const get = await request(c.app.getHttpServer()).get('/v1/saude').set('Origin', SITE);
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('origem cadastrada recebe Allow-Origin exato; fora da lista ou sem Origin: 403 sem ele', async () => {
    const x = await conta('Conta CORS');
    const chave = await criarChave(x, navegador());
    const ok = await publica(chave.token!);
    expect(ok.status).toBe(201);
    expect(ok.headers['access-control-allow-origin']).toBe(SITE);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    expect(ok.body).toMatchObject({
      empresa_id: x.empresaId,
      api_key_id: chave.id,
      membro_id: null,
    });

    for (const origem of ['https://golpe.com', 'https://assistencia.com.br', null]) {
      const r = await publica(chave.token!, origem);
      expect(r.status, String(origem)).toBe(403);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
    const invalida = await publica('ebk_live_nada');
    expect(invalida.status).toBe(401);
    expect(invalida.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('limites', () => {
  it('60 por minuto por chave e 30 por IP nas rotas públicas: 429 com Retry-After', async () => {
    // Só o limite da chave (o do IP desligado), para chegar à 61ª da mesma chave.
    const memoria = limitadorEmMemoria();
    const soPorChave = await c.criarApp({
      ...memoria,
      registrar: (chave, maximo, janela) =>
        chave.startsWith('apikey-ip:')
          ? Promise.resolve(0)
          : memoria.registrar(chave, maximo, janela),
    });
    const x = await conta('Conta Limite Chave');
    const chave = await criarChave(x, navegador());
    for (let i = 0; i < 60; i++)
      expect((await publica(chave.token!, SITE, soPorChave)).status).toBe(201);
    const r = await publica(chave.token!, SITE, soPorChave);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    // A origem confere, então o site consegue ler o 429.
    expect(r.headers['access-control-allow-origin']).toBe(SITE);

    const porIp = await c.criarApp(limitadorEmMemoria());
    const outra = await criarChave(x, navegador());
    for (let i = 0; i < 30; i++)
      expect((await publica(outra.token!, SITE, porIp)).status).toBe(201);
    expect((await publica(outra.token!, SITE, porIp)).status).toBe(429);
  }, 60_000);

  it('21 falhas de chave do mesmo IP: 429, mesmo com a chave certa', async () => {
    const app = await c.criarApp(limitadorEmMemoria());
    const x = await conta('Conta Limite Falhas');
    const chave = await criarChave(x, servidor());
    for (let i = 0; i < 20; i++)
      expect(
        (await comChave(`ebk_live_${'y'.repeat(43)}`, 'get', '/v1/teste/chaves/eco', app)).status,
      ).toBe(401);
    const bloqueada = await comChave(chave.token!, 'get', '/v1/teste/chaves/eco', app);
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.headers['retry-after']).toBeDefined();
  }, 30_000);
});
