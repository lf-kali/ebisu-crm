import { randomUUID } from 'node:crypto';
import { Empresa, ListaEmpresas } from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta, membroCom } from './cenario.js';

// CRUD /v1/empresas (plano docs/planos/f3-4a-cadastro-empresas.md, decisões 8 e 9): rotas da
// conta, sem X-Empresa-Id, com `config.empresa` em escopo TENANT numa atribuição de toda a conta.

let c: CenarioConta;
let dono: { token: string; tenantId: string };
let outraConta: { token: string; tenantId: string };
let primeiraId: string;

beforeAll(async () => {
  c = await criarCenarioConta();
  dono = await contaNova(c.app, { conta: { nome: 'Conta das Empresas' } });
  outraConta = await contaNova(c.app, { conta: { nome: 'Outra Conta' } });
  const lista = ListaEmpresas.parse((await pedir(dono.token, 'get', '/v1/empresas')).body);
  primeiraId = lista.dados[0]!.id;
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

type Metodo = 'get' | 'post' | 'patch' | 'delete';

/** Pedido autenticado; POST leva uma Idempotency-Key nova (ou a dada, ou nenhuma com null). */
function pedir(token: string, metodo: Metodo, rota: string, corpo?: object, chave?: string | null) {
  const req = request(c.app.getHttpServer())[metodo](rota).set('Authorization', `Bearer ${token}`);
  if (metodo === 'post' && chave !== null) req.set('Idempotency-Key', chave ?? randomUUID());
  return corpo ? req.send(corpo) : req;
}

let sequenciaCnpj = 0;
/** CNPJ válido diferente a cada chamada (base numérica + dígitos calculados). */
function cnpjNovo(): string {
  const base = `9${String(++sequenciaCnpj).padStart(7, '0')}0001`;
  const dv = (b: string) => {
    const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2].slice(13 - b.length);
    const resto = [...b].reduce((t, d, i) => t + Number(d) * pesos[i]!, 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = dv(base);
  return `${base}${primeiro}${dv(base + primeiro)}`;
}

const criar = (token: string, corpo: object = {}, chave?: string | null) =>
  pedir(
    token,
    'post',
    '/v1/empresas',
    { razao_social: 'Filial Ltda', nome_fantasia: 'Filial', ...corpo },
    chave,
  );

describe('CRUD de empresas pelo dono', () => {
  it('cria com os padrões, lê, edita e lista; não pede X-Empresa-Id', async () => {
    const cnpj = cnpjNovo();
    const criada = await criar(dono.token, { nome_fantasia: 'Filial Norte', cnpj });
    expect(criada.status).toBe(201);
    const empresa = Empresa.parse(criada.body);
    expect(empresa).toMatchObject({ nome_fantasia: 'Filial Norte', cnpj, ativo: true });

    const padroes = (
      await c.sql(
        `SELECT (SELECT count(*) FROM funil WHERE empresa_id = $1 AND padrao) AS funis,
                (SELECT count(*) FROM origem_lead WHERE empresa_id = $1) AS origens,
                (SELECT count(*) FROM motivo_perda WHERE empresa_id = $1) AS motivos`,
        [empresa.id],
      )
    ).rows[0]!;
    expect(Number(padroes.funis)).toBe(1);
    expect(Number(padroes.origens)).toBeGreaterThan(0);
    expect(Number(padroes.motivos)).toBeGreaterThan(0);

    const lida = await pedir(dono.token, 'get', `/v1/empresas/${empresa.id}`);
    expect(lida.status).toBe(200);
    expect(lida.body).toEqual(empresa);

    const editada = await pedir(dono.token, 'patch', `/v1/empresas/${empresa.id}`, {
      nome_fantasia: 'Filial Norte 2',
      cnpj: null,
    });
    expect(editada.status).toBe(200);
    expect(editada.body).toMatchObject({ nome_fantasia: 'Filial Norte 2', cnpj: null });

    const lista = ListaEmpresas.parse((await pedir(dono.token, 'get', '/v1/empresas')).body);
    expect(lista.dados.map((e) => e.id)).toEqual(expect.arrayContaining([primeiraId, empresa.id]));
  });

  it('CNPJ com máscara é gravado sem ela; alfanumérico é aceito', async () => {
    const r = await criar(dono.token, { cnpj: '12.abc.345/01de-35' });
    expect(r.status).toBe(201);
    expect(r.body.cnpj).toBe('12ABC34501DE35');
  });

  it('pagina por cursor', async () => {
    await criar(dono.token);
    const todas = ListaEmpresas.parse((await pedir(dono.token, 'get', '/v1/empresas')).body).dados;
    expect(todas.length).toBeGreaterThan(2);
    const vistas: string[] = [];
    let cursor: string | null = null;
    do {
      const rota: string = `/v1/empresas?limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const pagina = ListaEmpresas.parse((await pedir(dono.token, 'get', rota)).body);
      expect(pagina.dados).toHaveLength(1);
      vistas.push(pagina.dados[0]!.id);
      cursor = pagina.proximo_cursor;
    } while (cursor);
    expect(vistas).toEqual(todas.map((e) => e.id));
  });

  it('cursor inválido dá 422', async () => {
    const r = await pedir(dono.token, 'get', '/v1/empresas?cursor=nao-e-cursor');
    expect(r.status).toBe(422);
    expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'cursor' })]);
  });

  it('CNPJ inválido dá 422; repetido na conta dá 409 duplicado com id_existente', async () => {
    expect((await criar(dono.token, { cnpj: '11222333000182' })).status).toBe(422);
    const cnpj = cnpjNovo();
    const primeira = await criar(dono.token, { cnpj });
    expect(primeira.status).toBe(201);
    const repetida = await criar(dono.token, { cnpj: cnpj.replace(/^(\d{2})(\d{3})/, '$1.$2.') });
    expect(repetida.status).toBe(409);
    expect(repetida.body).toMatchObject({ code: 'duplicado', id_existente: primeira.body.id });

    const outra = await criar(dono.token);
    const edicao = await pedir(dono.token, 'patch', `/v1/empresas/${outra.body.id}`, { cnpj });
    expect(edicao.status).toBe(409);
    expect(edicao.body).toMatchObject({ code: 'duplicado', id_existente: primeira.body.id });
    // A própria empresa pode manter o CNPJ dela.
    const mesma = await pedir(dono.token, 'patch', `/v1/empresas/${primeira.body.id}`, { cnpj });
    expect(mesma.status).toBe(200);
  });

  it('o mesmo CNPJ pode existir em outra conta', async () => {
    const cnpj = cnpjNovo();
    expect((await criar(dono.token, { cnpj })).status).toBe(201);
    expect((await criar(outraConta.token, { cnpj })).status).toBe(201);
  });

  it('edição vazia dá 422', async () => {
    const r = await pedir(dono.token, 'patch', `/v1/empresas/${primeiraId}`, {});
    expect(r.status).toBe(422);
  });
});

describe('desativar', () => {
  it('desativa (204), some do /v1/eu, repetir não muda nada; a última ativa dá 409', async () => {
    const conta = await contaNova(c.app, { conta: { nome: 'Conta que Desativa' } });
    const [unica] = ListaEmpresas.parse(
      (await pedir(conta.token, 'get', '/v1/empresas')).body,
    ).dados;
    const ultima = await pedir(conta.token, 'delete', `/v1/empresas/${unica!.id}`);
    expect(ultima.status).toBe(409);
    expect(ultima.body.code).toBe('transicao_invalida');

    const segunda = Empresa.parse((await criar(conta.token)).body);
    expect((await pedir(conta.token, 'delete', `/v1/empresas/${unica!.id}`)).status).toBe(204);
    expect((await pedir(conta.token, 'delete', `/v1/empresas/${unica!.id}`)).status).toBe(204);
    const lida = await pedir(conta.token, 'get', `/v1/empresas/${unica!.id}`);
    expect(lida.body.ativo).toBe(false);
    const eu = await pedir(conta.token, 'get', '/v1/eu');
    expect(eu.body.empresas.map((e: { id: string }) => e.id)).toEqual([segunda.id]);
    // Agora a segunda é a última ativa, mesmo com o id em maiúsculas.
    expect((await pedir(conta.token, 'delete', `/v1/empresas/${segunda.id}`)).status).toBe(409);
    expect(
      (await pedir(conta.token, 'delete', `/v1/empresas/${segunda.id.toUpperCase()}`)).status,
    ).toBe(409);
  });

  it('desativação concorrente: espera a outra transação e não deixa a conta sem empresa ativa', async () => {
    const conta = await contaNova(c.app, { conta: { nome: 'Conta Concorrente' } });
    const segunda = Empresa.parse((await criar(conta.token)).body);
    const [primeira] = ListaEmpresas.parse(
      (await pedir(conta.token, 'get', '/v1/empresas')).body,
    ).dados;
    // Outra transação desativa a primeira e segura a linha; a API tenta desativar a segunda.
    const outra = await c.banco.conectar(c.banco.urlAdmin);
    try {
      await outra.query('BEGIN');
      await outra.query(`UPDATE empresa SET ativo = false WHERE id = $1`, [primeira!.id]);
      let respondeu = false;
      const pedido = pedir(conta.token, 'delete', `/v1/empresas/${segunda.id}`).then((r) => {
        respondeu = true;
        return r;
      });
      await new Promise((fim) => setTimeout(fim, 500));
      // Com a trava, a API ainda espera a outra transação.
      expect(respondeu).toBe(false);
      await outra.query('COMMIT');
      const r = await pedido;
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('transicao_invalida');
    } finally {
      await outra.end();
    }
    const [{ n }] = (
      await c.sql(`SELECT count(*) AS n FROM empresa WHERE tenant_id = $1 AND ativo`, [
        conta.tenantId,
      ])
    ).rows as [{ n: string }];
    expect(Number(n)).toBe(1);
  });
});

describe('idempotência das rotas da conta', () => {
  it('POST sem Idempotency-Key dá 422', async () => {
    const r = await criar(dono.token, {}, null);
    expect(r.status).toBe(422);
    expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'Idempotency-Key' })]);
  });

  it('repetir o POST com a mesma chave devolve a mesma empresa e não cria outra', async () => {
    const chave = randomUUID();
    const antes = (await c.sql(`SELECT count(*) AS n FROM empresa`)).rows[0]!.n;
    const primeira = await criar(dono.token, { nome_fantasia: 'Idempotente' }, chave);
    const segunda = await criar(dono.token, { nome_fantasia: 'Idempotente' }, chave);
    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primeira.body);
    const depois = (await c.sql(`SELECT count(*) AS n FROM empresa`)).rows[0]!.n;
    expect(Number(depois) - Number(antes)).toBe(1);
    const divergente = await criar(dono.token, { nome_fantasia: 'Outra' }, chave);
    expect(divergente.status).toBe(422);
    expect(divergente.body.code).toBe('idempotencia_divergente');
  });
});

describe('acesso às rotas da conta', () => {
  it('sem token dá 401', async () => {
    const r = await request(c.app.getHttpServer()).get('/v1/empresas');
    expect(r.status).toBe(401);
  });

  it('sem config.empresa dá 403', async () => {
    const token = await membroCom(c, dono.tenantId, { 'contato.read': 'TENANT' }, null);
    for (const [metodo, rota] of [
      ['get', '/v1/empresas'],
      ['get', `/v1/empresas/${primeiraId}`],
      ['post', '/v1/empresas'],
      ['patch', `/v1/empresas/${primeiraId}`],
      ['delete', `/v1/empresas/${primeiraId}`],
    ] as const) {
      const r = await pedir(token, metodo, rota, { nome_fantasia: 'X', razao_social: 'X' });
      expect([metodo, rota, r.status, r.body.code]).toEqual([metodo, rota, 403, 'sem_permissao']);
    }
  });

  it('config.empresa com escopo EMPRESA, mesmo em todas as empresas, dá 403', async () => {
    const token = await membroCom(c, dono.tenantId, { 'config.empresa': 'EMPRESA' }, null);
    expect((await pedir(token, 'get', '/v1/empresas')).status).toBe(403);
    expect((await criar(token)).status).toBe(403);
  });

  it('config.empresa TENANT num papel atribuído a uma empresa só dá 403', async () => {
    const token = await membroCom(c, dono.tenantId, { 'config.empresa': 'TENANT' }, primeiraId);
    expect((await pedir(token, 'get', '/v1/empresas')).status).toBe(403);
    expect((await pedir(token, 'delete', `/v1/empresas/${primeiraId}`)).status).toBe(403);
  });

  it('config.empresa TENANT em todas as empresas basta (não precisa ser dono)', async () => {
    const token = await membroCom(c, dono.tenantId, { 'config.empresa': 'TENANT' }, null);
    expect((await pedir(token, 'get', '/v1/empresas')).status).toBe(200);
  });

  it('empresa de outra conta dá 404 e não muda', async () => {
    const [alheia] = ListaEmpresas.parse(
      (await pedir(outraConta.token, 'get', '/v1/empresas')).body,
    ).dados;
    const rota = `/v1/empresas/${alheia!.id}`;
    expect((await pedir(dono.token, 'get', rota)).status).toBe(404);
    expect((await pedir(dono.token, 'patch', rota, { nome_fantasia: 'Invadida' })).status).toBe(
      404,
    );
    expect((await pedir(dono.token, 'delete', rota)).status).toBe(404);
    const [linha] = (
      await c.sql(`SELECT nome_fantasia, ativo FROM empresa WHERE id = $1`, [alheia!.id])
    ).rows;
    expect(linha).toEqual({ nome_fantasia: alheia!.nome_fantasia, ativo: true });
    const lista = ListaEmpresas.parse((await pedir(dono.token, 'get', '/v1/empresas')).body);
    expect(lista.dados.map((e) => e.id)).not.toContain(alheia!.id);
  });
});
