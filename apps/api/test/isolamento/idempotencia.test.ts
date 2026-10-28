import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gerarDocumento } from '../../src/core/openapi/gerar-documento.js';
import { type CenarioIsolamento, criarCenarioIsolamento, IDS } from './cenario.js';
import { pedir } from './suite.js';

// Idempotency-Key nos POST de domínio (plano docs/planos/f3-3a-idempotencia.md).

let cenario: CenarioIsolamento;
const http = pedir(() => cenario);
const ROTA = '/v1/teste/contatos';
const { a1, a2, b1 } = IDS.empresas;

beforeAll(async () => {
  cenario = await criarCenarioIsolamento();
}, 180_000);
afterAll(async () => {
  await cenario?.fechar();
});

const contar = async (nome: string) =>
  (await cenario.sql('SELECT count(*)::int AS n FROM contato WHERE nome = $1', [nome])).rows[0]!
    .n as number;

describe('Idempotency-Key em POST de domínio', () => {
  it('repetir com a mesma chave devolve a mesma resposta, byte a byte, e cria um só', async () => {
    const chave = randomUUID();
    const primeira = await http('m1', 'post', ROTA, a1, { nome: 'idem-repete' }, chave);
    expect(primeira.status).toBe(201);
    const segunda = await http('m1', 'post', ROTA, a1, { nome: 'idem-repete' }, chave);
    expect(segunda.status).toBe(201);
    expect(segunda.text).toBe(primeira.text);
    // A chave não diferencia maiúsculas (é um UUID).
    const maiuscula = await http(
      'm1',
      'post',
      ROTA,
      a1,
      { nome: 'idem-repete' },
      chave.toUpperCase(),
    );
    expect(maiuscula.text).toBe(primeira.text);
    expect(await contar('idem-repete')).toBe(1);
  });

  it('a ordem das chaves do corpo não muda o pedido', async () => {
    const chave = randomUUID();
    const r1 = await http(
      'm1',
      'post',
      ROTA,
      a1,
      { nome: 'idem-ordem', origem_id: IDS.origens.a1 },
      chave,
    );
    const r2 = await http(
      'm1',
      'post',
      ROTA,
      a1,
      { origem_id: IDS.origens.a1, nome: 'idem-ordem' },
      chave,
    );
    expect(r2.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
  });

  it('mesma chave com outro corpo, empresa, autor ou rota: 422 e nada é criado', async () => {
    const chave = randomUUID();
    const original = await http('admin', 'post', ROTA, a1, { nome: 'idem-div' }, chave);
    expect(original.status).toBe(201);
    const tentativas = [
      await http('admin', 'post', ROTA, a1, { nome: 'idem-div-outro' }, chave),
      await http('admin', 'post', ROTA, a2, { nome: 'idem-div' }, chave),
      await http('m1', 'post', ROTA, a1, { nome: 'idem-div' }, chave),
      await http(
        'admin',
        'post',
        `${ROTA}/${original.body.id}/duplicar`,
        a1,
        { nome: 'idem-div' },
        chave,
      ),
    ];
    for (const r of tentativas) {
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('idempotencia_divergente');
    }
    expect(await contar('idem-div')).toBe(1);
    expect(await contar('idem-div-outro')).toBe(0);
  });

  it('mesma rota com outro parâmetro de rota é outro pedido (422)', async () => {
    const [x, y] = [IDS.contatos.a1DoM1, IDS.contatos.a1DoP];
    const chave = randomUUID();
    expect(
      (await http('admin', 'post', `${ROTA}/${x}/duplicar`, a1, { nome: 'idem-dup' }, chave))
        .status,
    ).toBe(201);
    const r = await http('admin', 'post', `${ROTA}/${y}/duplicar`, a1, { nome: 'idem-dup' }, chave);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('idempotencia_divergente');
    expect(await contar('idem-dup')).toBe(1);
  });

  it('com a chave em uso por outra requisição: 409 na hora, sem efeito', async () => {
    const chave = randomUUID();
    const outra = await cenario.banco.conectar(cenario.banco.urlAdmin);
    try {
      await outra.query('BEGIN');
      await outra.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${IDS.contas.a}:${chave}`,
      ]);
      const r = await http('m1', 'post', ROTA, a1, { nome: 'idem-andamento' }, chave);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('idempotencia_em_andamento');
      await outra.query('ROLLBACK');
    } finally {
      await outra.end();
    }
    expect(await contar('idem-andamento')).toBe(0);
    // Liberada a chave, o pedido roda normalmente.
    expect((await http('m1', 'post', ROTA, a1, { nome: 'idem-andamento' }, chave)).status).toBe(
      201,
    );
  });

  it('uma falha não é memorizada: a mesma chave executa de novo depois', async () => {
    const chave = randomUUID();
    const corpo = { nome: 'idem-falha', origem_id: IDS.origens.a2 };
    const falha = await http('m1', 'post', ROTA, a1, corpo, chave);
    expect(falha.status).toBe(422);
    expect(falha.body.code).toBe('validacao');
    // O mesmo pedido falha do mesmo jeito (não vira "divergente" nem "repetido").
    expect((await http('m1', 'post', ROTA, a1, corpo, chave)).body.code).toBe('validacao');
    const ok = await http('m1', 'post', ROTA, a1, { nome: 'idem-falha' }, chave);
    expect(ok.status).toBe(201);
    expect(await contar('idem-falha')).toBe(1);
  });

  it('sem a chave ou com valor que não é UUID: 422 no campo Idempotency-Key', async () => {
    for (const chave of [null, 'nao-e-uuid']) {
      const r = await http('m1', 'post', ROTA, a1, { nome: 'idem-sem-chave' }, chave);
      expect(r.status).toBe(422);
      expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'Idempotency-Key' })]);
    }
    expect(await contar('idem-sem-chave')).toBe(0);
  });

  it('PATCH e DELETE não exigem a chave', async () => {
    const criado = await http('admin', 'post', ROTA, a1, { nome: 'idem-patch' });
    const id = criado.body.id as string;
    expect(
      (await http('admin', 'patch', `${ROTA}/${id}`, a1, { nome: 'idem-patch-2' }, null)).status,
    ).toBe(200);
    expect((await http('admin', 'delete', `${ROTA}/${id}`, a1, undefined, null)).status).toBe(204);
  });

  it('chave vencida (24 h) roda como nova', async () => {
    const chave = randomUUID();
    const r1 = await http('m1', 'post', ROTA, a1, { nome: 'idem-vencida' }, chave);
    await cenario.sql(
      "UPDATE idempotencia_requisicao SET expira_em = now() - interval '1 second' WHERE chave = $1",
      [chave],
    );
    const r2 = await http('m1', 'post', ROTA, a1, { nome: 'idem-vencida' }, chave);
    expect(r2.status).toBe(201);
    expect(r2.body.id).not.toBe(r1.body.id);
    expect(await contar('idem-vencida')).toBe(2);
    const { rows } = await cenario.sql(
      'SELECT expira_em > now() AS valida FROM idempotencia_requisicao WHERE chave = $1',
      [chave],
    );
    expect(rows).toEqual([{ valida: true }]);
  });

  it('a mesma chave em duas contas são chaves diferentes', async () => {
    const chave = randomUUID();
    const a = await http('m1', 'post', ROTA, a1, { nome: 'idem-contas' }, chave);
    const b = await http('mB', 'post', ROTA, b1, { nome: 'idem-contas' }, chave);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).not.toBe(b.body.id);
    expect(await contar('idem-contas')).toBe(2);
  });

  it('o OpenAPI do POST de domínio mostra Idempotency-Key e 409', () => {
    const doc = gerarDocumento(cenario.app) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const post = doc.paths['/v1/teste/contatos']!.post!;
    expect(post.parameters).toEqual([
      expect.objectContaining({ in: 'header', name: 'X-Empresa-Id', required: true }),
      expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }),
    ]);
    expect(Object.keys(post.responses as object)).toEqual([
      '201',
      '401',
      '403',
      '409',
      '422',
      'default',
    ]);
    const get = doc.paths['/v1/teste/contatos']!.get!;
    expect(JSON.stringify(get.parameters)).not.toContain('Idempotency-Key');
  });
});
