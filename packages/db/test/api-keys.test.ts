import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gerarApiKey, hashDaApiKey, prefixoDaApiKey } from '../src/api-keys.js';
import { type BancoDeTeste, codigoDoErro, criarBancoDeTeste } from '../src/teste/banco-de-teste.js';

// API keys (F3-5; plano docs/planos/f3-5-api-keys-cors.md, decisões 6 e 12): leitura do
// ebisu_auth entre contas, CHECK do tipo e auditoria que ignora o ultimo_uso.

const SEM_PERMISSAO = '42501';
const VIOLA_CHECK = '23514';

let banco: BancoDeTeste;
let admin: pg.Client;
let auth: pg.Client;
const tenants = [randomUUID(), randomUUID()];
const empresas = [randomUUID(), randomUUID()];

const inserir = `INSERT INTO api_key (id, tenant_id, empresa_id, nome, prefixo, hash, tipo, escopos, origens_cors)
  VALUES ($1, $2, $3, 'Chave', $4, 'h', $5, $6, $7)`;
const chave = (i: number, tipo: string, escopos: string[], origens: string[]) => [
  randomUUID(),
  tenants[i],
  empresas[i],
  gerarApiKey().prefixo,
  tipo,
  escopos,
  origens,
];

beforeAll(async () => {
  banco = await criarBancoDeTeste();
  admin = await banco.conectar(banco.urlAdmin);
  auth = await banco.conectar(banco.urlDoPapel('ebisu_auth'));
  for (const [i, tenant] of tenants.entries()) {
    await admin.query(
      `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', $2, now())`,
      [tenant, `conta-${i}`],
    );
    await admin.query(
      `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, updated_at)
       VALUES ($1, $2, 'Empresa', 'E', now())`,
      [empresas[i], tenant],
    );
    await admin.query(inserir, chave(i, 'SERVIDOR', ['contato.read'], []));
  }
}, 180_000);

afterAll(async () => {
  await Promise.all([admin?.end(), auth?.end()]);
  await banco?.container.stop();
});

describe('api_key no banco', () => {
  it('ebisu_auth lê chaves de todas as contas, mas não grava', async () => {
    const { rows } = await auth.query('SELECT count(*)::int AS n FROM api_key');
    expect(rows[0].n).toBe(2);
    expect(await codigoDoErro(auth, `UPDATE api_key SET ultimo_uso = now()`)).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, `DELETE FROM api_key`)).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, inserir, chave(0, 'SERVIDOR', ['contato.read'], []))).toBe(
      SEM_PERMISSAO,
    );
  });

  it('CHECK: navegador só com origens, servidor sem origens, sempre ao menos um escopo', async () => {
    const casos: Array<[string, string[], string[], string | null]> = [
      ['NAVEGADOR', ['lead.create'], [], VIOLA_CHECK],
      ['SERVIDOR', ['contato.read'], ['https://site.com'], VIOLA_CHECK],
      ['SERVIDOR', [], [], VIOLA_CHECK],
      ['NAVEGADOR', ['lead.create'], ['https://site.com'], null],
    ];
    for (const [tipo, escopos, origens, esperado] of casos)
      expect(await codigoDoErro(admin, inserir, chave(0, tipo, escopos, origens)), tipo).toBe(
        esperado,
      );
  });

  it('a auditoria ignora a mudança que só toca o ultimo_uso', async () => {
    const id = randomUUID();
    await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenants[1]]);
    await admin.query(inserir, [id, ...chave(1, 'SERVIDOR', ['contato.read'], []).slice(1)]);
    await admin.query(`UPDATE api_key SET ultimo_uso = now() WHERE id = $1`, [id]);
    await admin.query(`UPDATE api_key SET nome = 'Outra' WHERE id = $1`, [id]);
    const { rows } = await admin.query(
      `SELECT acao FROM audit_log WHERE entidade_id = $1 ORDER BY ocorreu_em`,
      [id],
    );
    expect(rows.map((r) => r.acao)).toEqual(['create', 'update']);
  });

  it('gerarApiKey: token com prefixo, prefixo exibido e hash do token inteiro', () => {
    const { token, prefixo, hash } = gerarApiKey();
    expect(token).toMatch(/^ebk_live_[A-Za-z0-9_-]{43}$/);
    expect(prefixo).toBe(token.slice(0, 17));
    expect(prefixoDaApiKey(token)).toBe(prefixo);
    expect(hash).toBe(hashDaApiKey(token));
    expect(gerarApiKey().token).not.toBe(token);
    for (const ruim of ['', 'ebk_live_curto', `ebk_test_${'a'.repeat(43)}`, `${token}x`])
      expect(prefixoDaApiKey(ruim), ruim).toBeNull();
  });
});
