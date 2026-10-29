import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BancoDeTeste,
  codigoDoErro,
  criarBancoDeTeste,
  rodarNoPacote,
} from '../src/teste/banco-de-teste.js';

// Convites e outbox de e-mail (F3-4b2; plano docs/planos/f3-4b2-convites.md): RLS, leitura do
// ebisu_auth, índice de convite pendente e a função de reivindicação do worker.

const SEM_PERMISSAO = '42501';
const VIOLA_UNICO = '23505';
const VIOLA_CHECK = '23514';

let banco: BancoDeTeste;
let admin: pg.Client;
let app: pg.Client;
let auth: pg.Client;
const tenants = [randomUUID(), randomUUID()];
const convites = [randomUUID(), randomUUID()];

/** Convite e e-mail pendente em cada tenant, gravados pelo superusuário (sem RLS). */
async function semear(cliente: pg.Client, ids: { tenant: string; convite: string; email: string }) {
  await cliente.query(
    `INSERT INTO convite (id, tenant_id, email, atribuicoes, expira_em, updated_at)
     VALUES ($1, $2, $3, '[]', now() + interval '7 days', now())`,
    [ids.convite, ids.tenant, ids.email],
  );
  await cliente.query(
    `INSERT INTO email_saida (id, tenant_id, tipo, convite_id, updated_at)
     VALUES ($1, $2, 'CONVITE', $3, now())`,
    [randomUUID(), ids.tenant, ids.convite],
  );
}

beforeAll(async () => {
  banco = await criarBancoDeTeste();
  admin = await banco.conectar(banco.urlAdmin);
  app = await banco.conectar(banco.urlDoPapel('ebisu_app'));
  auth = await banco.conectar(banco.urlDoPapel('ebisu_auth'));
  for (const [i, tenant] of tenants.entries()) {
    await admin.query(
      `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', $2, now())`,
      [tenant, `conta-${i}`],
    );
    await semear(admin, { tenant, convite: convites[i]!, email: `pessoa${i}@teste.local` });
  }
}, 180_000);

afterAll(async () => {
  await Promise.all([admin?.end(), app?.end(), auth?.end()]);
  await banco?.container.stop();
});

/** Roda `sql` como ebisu_app dentro da conta `tenant`. */
async function naConta<T extends pg.QueryResultRow>(
  tenant: string,
  sql: string,
  params: unknown[] = [],
) {
  await app.query('BEGIN');
  try {
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    return (await app.query<T>(sql, params)).rows;
  } finally {
    await app.query('ROLLBACK');
  }
}

describe('convite e email_saida', () => {
  it('SEG-1: ebisu_app só vê convites e e-mails da própria conta', async () => {
    for (const tabela of ['convite', 'email_saida']) {
      const linhas = await naConta<{ tenant_id: string }>(
        tenants[0]!,
        `SELECT tenant_id FROM ${tabela}`,
      );
      expect(linhas.map((l) => l.tenant_id)).toEqual([tenants[0]]);
    }
    expect((await app.query('SELECT count(*)::int AS n FROM email_saida')).rows[0].n).toBe(0);
  });

  it('ebisu_auth lê convites de todas as contas, mas não grava nem lê o outbox', async () => {
    const { rows } = await auth.query('SELECT count(*)::int AS n FROM convite');
    expect(rows[0].n).toBe(2);
    expect(await codigoDoErro(auth, `UPDATE convite SET aceito_em = now()`)).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, `DELETE FROM convite`)).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, 'SELECT 1 FROM email_saida')).toBe(SEM_PERMISSAO);
    expect(
      await codigoDoErro(auth, `SELECT * FROM reivindicar_email_saida(10, interval '1 minute')`),
    ).toBe(SEM_PERMISSAO);
  });

  it('um convite pendente por e-mail na conta; e-mail só normalizado', async () => {
    const repetido = `INSERT INTO convite (id, tenant_id, email, atribuicoes, expira_em, updated_at)
      VALUES ($1, $2, 'pessoa0@teste.local', '[]', now(), now())`;
    expect(await codigoDoErro(admin, repetido, [randomUUID(), tenants[0]])).toBe(VIOLA_UNICO);
    // Em outra conta, ou depois de revogado, pode.
    expect(await codigoDoErro(admin, repetido, [randomUUID(), tenants[1]])).toBeNull();
    expect(
      await codigoDoErro(
        admin,
        `INSERT INTO convite (id, tenant_id, email, atribuicoes, expira_em, updated_at)
         VALUES ($1, $2, 'Maiuscula@teste.local', '[]', now(), now())`,
        [randomUUID(), tenants[0]],
      ),
    ).toBe(VIOLA_CHECK);
  });
});

describe('reivindicar_email_saida()', () => {
  it('devolve só (id, tenant_id) de todas as contas, marca ENVIANDO com prazo e não repete', async () => {
    const primeira = await app.query(
      `SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`,
    );
    expect(primeira.fields.map((f) => f.name)).toEqual(['id', 'tenant_id']);
    expect(primeira.rows.map((r) => r.tenant_id).sort()).toEqual([...tenants].sort());
    const segunda = await app.query(
      `SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`,
    );
    expect(segunda.rows).toEqual([]);
    const estado = await admin.query(
      `SELECT status, tentativas, proxima_em > now() AS com_prazo FROM email_saida`,
    );
    expect(estado.rows).toEqual([
      { status: 'ENVIANDO', tentativas: 1, com_prazo: true },
      { status: 'ENVIANDO', tentativas: 1, com_prazo: true },
    ]);

    // Prazo vencido (o worker caiu): outro worker reivindica de novo.
    await admin.query(`UPDATE email_saida SET proxima_em = now() - interval '1 second'`);
    const denovo = await app.query(
      `SELECT * FROM reivindicar_email_saida(1, interval '5 minutes')`,
    );
    expect(denovo.rows).toHaveLength(1);
    await admin.query(`UPDATE email_saida SET status = 'ENVIADO'`);
  });

  it('compara em UTC, qualquer que seja o timezone da sessão', async () => {
    await admin.query(`UPDATE email_saida SET status = 'ENVIADO'`);
    await semear(admin, { tenant: tenants[0]!, convite: randomUUID(), email: 'fuso@teste.local' });
    await app.query(`SET timezone TO 'America/Sao_Paulo'`);
    try {
      const { rows } = await app.query(
        `SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`,
      );
      expect(rows).toHaveLength(1);
      const [linha] = (
        await admin.query(
          `SELECT extract(epoch FROM proxima_em - (now() AT TIME ZONE 'utc'))::int AS segundos
             FROM email_saida WHERE id = $1`,
          [rows[0].id],
        )
      ).rows;
      // O prazo é de 5 minutos a partir de agora (UTC), não 3 horas deslocado.
      expect(linha.segundos).toBeGreaterThan(280);
      expect(linha.segundos).toBeLessThanOrEqual(300);
    } finally {
      await app.query('RESET timezone');
      await admin.query(`UPDATE email_saida SET status = 'ENVIADO'`);
    }
  });

  it('linha criada pelo default numa sessão a leste de UTC já sai na hora', async () => {
    await admin.query(`UPDATE email_saida SET status = 'ENVIADO'`);
    const convite = randomUUID();
    await app.query(`SET timezone TO 'Asia/Tokyo'`);
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenants[0]]);
      await app.query(
        `INSERT INTO convite (id, tenant_id, email, atribuicoes, expira_em, updated_at)
         VALUES ($1, $2, 'toquio@teste.local', '[]', now() + interval '7 days', now())`,
        [convite, tenants[0]],
      );
      // Sem proxima_em: vale o default da coluna.
      await app.query(
        `INSERT INTO email_saida (id, tenant_id, tipo, convite_id, updated_at)
         VALUES ($1, $2, 'CONVITE', $3, now())`,
        [randomUUID(), tenants[0], convite],
      );
      await app.query('COMMIT');
      const { rows } = await app.query(
        `SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`,
      );
      expect(rows).toHaveLength(1);
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
      await app.query('RESET timezone');
      await admin.query(`UPDATE email_saida SET status = 'ENVIADO'`);
    }
  });

  it('o prazo pedido é limitado a 1 hora', async () => {
    await semear(admin, { tenant: tenants[1]!, convite: randomUUID(), email: 'prazo@teste.local' });
    const { rows } = await app.query(
      `SELECT * FROM reivindicar_email_saida(10, interval '100 years')`,
    );
    expect(rows).toHaveLength(1);
    const [linha] = (
      await admin.query(
        `SELECT extract(epoch FROM proxima_em - (now() AT TIME ZONE 'utc'))::int AS segundos
           FROM email_saida WHERE id = $1`,
        [rows[0].id],
      )
    ).rows;
    expect(linha.segundos).toBeLessThanOrEqual(3600);
    await admin.query(`UPDATE email_saida SET status = 'ENVIADO'`);
  });

  it('duas reivindicações simultâneas não pegam a mesma linha (SKIP LOCKED)', async () => {
    await semear(admin, { tenant: tenants[0]!, convite: randomUUID(), email: 'a@teste.local' });
    await semear(admin, { tenant: tenants[1]!, convite: randomUUID(), email: 'b@teste.local' });
    const outro = await banco.conectar(banco.urlDoPapel('ebisu_app'));
    try {
      // A primeira transação segura as linhas que reivindicou até o COMMIT.
      await app.query('BEGIN');
      const a = await app.query(`SELECT * FROM reivindicar_email_saida(1, interval '5 minutes')`);
      const b = await outro.query(
        `SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`,
      );
      await app.query('COMMIT');
      expect(a.rows).toHaveLength(1);
      expect(b.rows).toHaveLength(1);
      expect(b.rows[0].id).not.toBe(a.rows[0].id);
    } finally {
      await outro.end();
    }
  });

  it('ebisu_app não acha outro caminho entre contas (sem contexto não vê o outbox)', async () => {
    expect((await app.query('SELECT count(*)::int AS n FROM email_saida')).rows[0].n).toBe(0);
    expect(await codigoDoErro(app, `UPDATE email_saida SET status = 'FALHOU'`)).toBeNull();
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM email_saida WHERE status = 'FALHOU'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('funciona com um migrador sem superusuário (o dono da função passa pelo RLS)', async () => {
    // Banco novo, migrado por um papel comum que é dono do banco, como em produção.
    await admin.query(
      `CREATE ROLE migrador_comum LOGIN PASSWORD 'migrador' NOSUPERUSER CREATEROLE`,
    );
    await admin.query(`CREATE DATABASE banco_comum OWNER migrador_comum`);
    const url = new URL(banco.urlAdmin);
    url.username = 'migrador_comum';
    url.password = 'migrador';
    url.pathname = '/banco_comum';
    const saida = rodarNoPacote('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      DATABASE_URL: url.toString(),
    });
    expect(saida).toContain('All migrations have been successfully applied');

    const migrador = await banco.conectar(url.toString());
    const urlApp = new URL(banco.urlDoPapel('ebisu_app'));
    urlApp.pathname = '/banco_comum';
    const appComum = await banco.conectar(urlApp.toString());
    try {
      const tenant = randomUUID();
      // O migrador também passa pelo RLS (FORCE): grava cada conta no contexto dela.
      await migrador.query('BEGIN');
      await migrador.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      await migrador.query(
        `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', 'comum', now())`,
        [tenant],
      );
      await semear(migrador, { tenant, convite: randomUUID(), email: 'c@teste.local' });
      await migrador.query('COMMIT');
      const { rows } = await appComum.query(
        `SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`,
      );
      expect(rows.map((r) => r.tenant_id)).toEqual([tenant]);
    } finally {
      await Promise.all([migrador.end(), appComum.end()]);
    }
  });
});
