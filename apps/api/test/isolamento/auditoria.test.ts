import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CenarioIsolamento, criarCenarioIsolamento, IDS } from './cenario.js';
import { pedir } from './suite.js';

// Audit log automático visto pela API (plano docs/planos/f3-3b-audit-log.md): o executarComando
// informa membro, request_id e IP; o trigger do banco grava só os nomes das colunas (SEG-8).

let cenario: CenarioIsolamento;
const http = pedir(() => cenario);
const ROTA = '/v1/teste/contatos';

beforeAll(async () => {
  cenario = await criarCenarioIsolamento();
}, 180_000);
afterAll(async () => {
  await cenario?.fechar();
});

const auditoria = async (entidadeId: string) =>
  (
    await cenario.sql(
      `SELECT tenant_id, empresa_id, ator_membro_id, entidade_tipo, acao, diff, ip, request_id
         FROM audit_log WHERE entidade_id = $1 ORDER BY ocorreu_em, acao`,
      [entidadeId],
    )
  ).rows;

describe('audit log pela API', () => {
  it('POST e PATCH gravam membro, request_id, IP e só os nomes dos campos', async () => {
    const criado = await http('m1', 'post', ROTA, IDS.empresas.a1, { nome: 'Auditada Secreta' });
    expect(criado.status).toBe(201);
    const editado = await http('m1', 'patch', `${ROTA}/${criado.body.id}`, IDS.empresas.a1, {
      nome: 'Outro Nome Secreto',
    });
    expect(editado.status).toBe(200);

    const linhas = await auditoria(criado.body.id);
    expect(linhas.map((l) => l.acao)).toEqual(['create', 'update']);
    expect(linhas[0]).toMatchObject({
      tenant_id: IDS.contas.a,
      empresa_id: IDS.empresas.a1,
      ator_membro_id: IDS.membros.m1,
      entidade_tipo: 'contato',
      request_id: criado.headers['x-request-id'],
    });
    expect(linhas[1]).toMatchObject({
      diff: { campos: ['nome'] },
      request_id: editado.headers['x-request-id'],
    });
    expect(linhas[0]!.request_id).not.toBe(linhas[1]!.request_id);
    expect(linhas[0]!.ip).toMatch(/127\.0\.0\.1|::1/);
    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toContain('Secreta');
    expect(tudo).not.toContain('Secreto');
  });

  it('a repetição idempotente não grava auditoria nova', async () => {
    const chave = randomUUID();
    const r1 = await http('m1', 'post', ROTA, IDS.empresas.a1, { nome: 'audit-idem' }, chave);
    const r2 = await http('m1', 'post', ROTA, IDS.empresas.a1, { nome: 'audit-idem' }, chave);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await auditoria(r1.body.id)).toHaveLength(1);
  });
});
