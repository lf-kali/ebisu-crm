import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BancoDeTeste,
  codigoDoErro,
  criarBancoDeTeste,
  rodarNoPacote,
} from './banco-de-teste.js';

const SEM_PERMISSAO = '42501';
const TABELAS_GLOBAIS = ['permissao', 'refresh_token', 'usuario'];
const PRIVILEGIOS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

describe('migração inicial e papéis de banco', () => {
  let banco: BancoDeTeste;
  let admin: pg.Client;
  let app: pg.Client;
  let auth: pg.Client;
  const tenants = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    banco = await criarBancoDeTeste();
    admin = await banco.conectar(banco.urlAdmin);
    app = await banco.conectar(banco.urlDoPapel('ebisu_app'));
    auth = await banco.conectar(banco.urlDoPapel('ebisu_auth'));

    // Dados de dois tenants, gravados pelo superusuário do container (superusuário ignora RLS).
    for (const [i, tenantId] of tenants.entries()) {
      const usuarioId = randomUUID();
      await admin.query('BEGIN');
      await admin.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await admin.query(
        `INSERT INTO usuario (id, email, nome, updated_at) VALUES ($1, $2, 'Pessoa', now())`,
        [usuarioId, `pessoa${i}@teste.local`],
      );
      await admin.query(
        `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', $2, now())`,
        [tenantId, `tenant-${i}`],
      );
      await admin.query(
        `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, updated_at)
         VALUES ($1, $2, 'Empresa', 'E', now())`,
        [randomUUID(), tenantId],
      );
      await admin.query(
        `INSERT INTO membro (id, tenant_id, usuario_id, updated_at) VALUES ($1, $2, $3, now())`,
        [randomUUID(), tenantId, usuarioId],
      );
      await admin.query('COMMIT');
    }
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), app?.end(), auth?.end()]);
    await banco?.container.stop();
  });

  it('não há drift entre schema.prisma e as migrações', async () => {
    await admin.query('CREATE DATABASE sombra');
    const sombra = new URL(banco.urlAdmin);
    sombra.pathname = '/sombra';
    const saida = rodarNoPacote(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--shadow-database-url',
        sombra.toString(),
        '--exit-code',
      ],
      {},
    );
    expect(saida).toContain('No difference detected');
  });

  it('SEG-1: toda tabela tem RLS forçado, exceto as globais de autenticação e o histórico do Prisma', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(['_prisma_migrations', ...TABELAS_GLOBAIS]);
  });

  it('SEG-1: papéis da aplicação só têm privilégio em tabela com RLS forçado (exceto globais do auth)', async () => {
    const { rows } = await admin.query<{ papel: string; tabela: string }>(
      `SELECT r.papel, c.relname AS tabela
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('ebisu_app'), ('ebisu_auth')) AS r(papel)
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
          AND EXISTS (SELECT 1 FROM unnest($1::text[]) p WHERE has_table_privilege(r.papel, c.oid, p))
        ORDER BY 1, 2`,
      [PRIVILEGIOS],
    );
    expect(rows).toEqual(TABELAS_GLOBAIS.map((tabela) => ({ papel: 'ebisu_auth', tabela })));
  });

  it('ebisu_app e ebisu_auth não acessam o histórico de migrações', async () => {
    expect(await codigoDoErro(app, 'SELECT 1 FROM _prisma_migrations')).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, 'SELECT 1 FROM _prisma_migrations')).toBe(SEM_PERMISSAO);
  });

  it('migra outro banco do mesmo cluster reaproveitando os papéis existentes', async () => {
    await admin.query('CREATE DATABASE outro_banco');
    const url = new URL(banco.urlAdmin);
    url.pathname = '/outro_banco';
    const saida = rodarNoPacote('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      DATABASE_URL: url.toString(),
    });
    expect(saida).toContain('All migrations have been successfully applied');
  });

  // Cada caso deixa o papel existente inseguro, tenta migrar um banco novo e desfaz.
  const PAPEIS_INSEGUROS = [
    {
      caso: 'BYPASSRLS',
      papel: 'ebisu_app',
      estragar: 'ALTER ROLE ebisu_app BYPASSRLS',
      desfazer: 'ALTER ROLE ebisu_app NOBYPASSRLS',
    },
    {
      caso: 'REPLICATION',
      papel: 'ebisu_auth',
      estragar: 'ALTER ROLE ebisu_auth REPLICATION',
      desfazer: 'ALTER ROLE ebisu_auth NOREPLICATION',
    },
    {
      caso: 'membro de pg_read_all_data',
      papel: 'ebisu_app',
      estragar: 'GRANT pg_read_all_data TO ebisu_app',
      desfazer: 'REVOKE pg_read_all_data FROM ebisu_app',
    },
  ];

  it.each(PAPEIS_INSEGUROS)(
    'SEG-6: aborta a migração se um papel existente tiver $caso',
    async ({ papel, estragar, desfazer }) => {
      const nomeBanco = `banco_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE ${nomeBanco}`);
      await admin.query(estragar);
      try {
        const url = new URL(banco.urlAdmin);
        url.pathname = `/${nomeBanco}`;
        let saida = '';
        try {
          rodarNoPacote('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
            DATABASE_URL: url.toString(),
          });
        } catch (erro) {
          const { stdout = '', stderr = '' } = erro as { stdout?: string; stderr?: string };
          saida = stdout + stderr;
        }
        expect(saida).toContain(`Papel ${papel} existe com SUPERUSER/BYPASSRLS`);
      } finally {
        await admin.query(desfazer);
      }
    },
  );

  it('SEG-6: configurar-papeis recusa liberar LOGIN de papel alterado depois da migração', async () => {
    await admin.query('GRANT pg_write_all_data TO ebisu_app');
    try {
      expect(() =>
        rodarNoPacote('node', ['scripts/configurar-papeis.mjs'], {
          DATABASE_URL: banco.urlAdmin,
          DB_APP_PASSWORD: 'senha-app-teste',
          DB_AUTH_PASSWORD: 'senha-auth-teste',
        }),
      ).toThrow(/Papel ebisu_app tem SUPERUSER\/BYPASSRLS/);
    } finally {
      await admin.query('REVOKE pg_write_all_data FROM ebisu_app');
    }
  });

  it('SEG-6: ebisu_app e ebisu_auth não são superusuários, não ignoram RLS e não são donos de nada', async () => {
    const { rows } = await admin.query(
      `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS objetos
         FROM pg_roles r WHERE r.rolname IN ('ebisu_app', 'ebisu_auth') ORDER BY 1`,
    );
    expect(rows).toEqual([
      { rolname: 'ebisu_app', rolsuper: false, rolbypassrls: false, rolcanlogin: true, objetos: 0 },
      {
        rolname: 'ebisu_auth',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: true,
        objetos: 0,
      },
    ]);
  });

  it('SEG-1: ebisu_app sem app.tenant_id não enxerga nenhuma linha', async () => {
    const { rows } = await app.query('SELECT count(*)::int AS n FROM tenant');
    expect(rows[0].n).toBe(0);
  });

  it('SEG-1: ebisu_app com app.tenant_id enxerga só o próprio tenant', async () => {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenants[0]]);
    const { rows } = await app.query('SELECT id FROM tenant');
    await app.query('COMMIT');
    expect(rows).toEqual([{ id: tenants[0] }]);
  });

  it.each(TABELAS_GLOBAIS)('ebisu_app não acessa a tabela global %s', async (tabela) => {
    expect(await codigoDoErro(app, `SELECT 1 FROM ${tabela} LIMIT 1`)).toBe(SEM_PERMISSAO);
  });

  it('ebisu_auth lê membro, tenant e empresa de todos os tenants sem contexto', async () => {
    for (const tabela of ['membro', 'tenant', 'empresa']) {
      const { rows } = await auth.query(`SELECT count(*)::int AS n FROM ${tabela}`);
      expect(rows[0].n, tabela).toBe(2);
    }
  });

  it('ebisu_auth não grava em membro, tenant nem empresa', async () => {
    expect(await codigoDoErro(auth, `UPDATE tenant SET nome = 'x'`)).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, `DELETE FROM membro`)).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, `UPDATE empresa SET nome_fantasia = 'x'`)).toBe(SEM_PERMISSAO);
  });

  it('ebisu_auth não acessa dados de negócio', async () => {
    expect(await codigoDoErro(auth, 'SELECT 1 FROM contato LIMIT 1')).toBe(SEM_PERMISSAO);
    expect(await codigoDoErro(auth, 'SELECT 1 FROM ordem_servico LIMIT 1')).toBe(SEM_PERMISSAO);
  });

  it('ebisu_auth grava usuario e lê o catálogo de permissões', async () => {
    const id = randomUUID();
    await auth.query(
      `INSERT INTO usuario (id, email, nome, updated_at) VALUES ($1, 'novo@teste.local', 'Novo', now())`,
      [id],
    );
    await auth.query('SELECT count(*) FROM permissao');
    expect(
      await codigoDoErro(
        auth,
        `INSERT INTO permissao (chave, recurso, acao, descricao) VALUES ('x.y', 'x', 'y', 'teste')`,
      ),
    ).toBe(SEM_PERMISSAO);
  });

  it('configurar-papeis é idempotente e recusa rodar sem senha definida', () => {
    const env = {
      DATABASE_URL: banco.urlAdmin,
      DB_APP_PASSWORD: 'senha-app-teste',
      DB_AUTH_PASSWORD: 'senha-auth-teste',
    };
    expect(rodarNoPacote('node', ['scripts/configurar-papeis.mjs'], env)).toContain(
      'Papel ebisu_auth: LOGIN e senha definidos',
    );
    expect(() =>
      rodarNoPacote('node', ['scripts/configurar-papeis.mjs'], { ...env, DB_APP_PASSWORD: '' }),
    ).toThrow(/DB_APP_PASSWORD não definido/);
  });
});
