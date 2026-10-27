import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clienteDoTenant, comTenant, TenantInvalidoError } from '../src/tenancy.js';
import { type BancoDeTeste, criarBancoDeTeste } from './banco-de-teste.js';

// Dois tenants, uma empresa cada; T1 com 2 contatos e T2 com 1.
const T1 = randomUUID();
const T2 = randomUUID();
const EMPRESA = { [T1]: randomUUID(), [T2]: randomUUID() };
const CONTATOS = { [T1]: [randomUUID(), randomUUID()], [T2]: [randomUUID()] };

function urlComPool(url: string, conexoes: number) {
  const u = new URL(url);
  u.searchParams.set('connection_limit', String(conexoes));
  return u.toString();
}

describe('tenancy (comTenant e clienteDoTenant) — SEG-1, SEG-6', () => {
  let banco: BancoDeTeste;
  let admin: pg.Client;
  /** ebisu_app com pool de 1 conexão: toda transação reaproveita a mesma conexão. */
  let app: PrismaClient;
  /** ebisu_app com pool de 4 conexões, para concorrência. */
  let appPool: PrismaClient;

  beforeAll(async () => {
    banco = await criarBancoDeTeste();
    admin = await banco.conectar(banco.urlAdmin);
    for (const tenantId of [T1, T2]) {
      await admin.query(
        `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', $2, now())`,
        [tenantId, `t-${tenantId}`],
      );
      await admin.query(
        `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, updated_at)
         VALUES ($1, $2, 'Empresa', 'E', now())`,
        [EMPRESA[tenantId], tenantId],
      );
      for (const contatoId of CONTATOS[tenantId]!) {
        await admin.query(
          `INSERT INTO contato (id, tenant_id, empresa_id, nome, email, email_normalizado, updated_at)
           VALUES ($1, $2, $3, 'Pessoa', $4, $4, now())`,
          [contatoId, tenantId, EMPRESA[tenantId], `${contatoId}@teste.local`],
        );
      }
    }
    const urlApp = banco.urlDoPapel('ebisu_app');
    app = new PrismaClient({ datasourceUrl: urlComPool(urlApp, 1) });
    appPool = new PrismaClient({ datasourceUrl: urlComPool(urlApp, 4) });
  });

  afterAll(async () => {
    await Promise.all([app?.$disconnect(), appPool?.$disconnect(), admin?.end()]);
    await banco?.container.stop();
  });

  const lerContexto = async (cliente: PrismaClient) => {
    const [linha] = await cliente.$queryRaw<Array<{ pid: number; tenant: string | null }>>`
      SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.tenant_id', true), '') AS tenant`;
    return linha!;
  };

  it('SEG-1: sem contexto, nenhuma linha é visível (model e SQL cru)', async () => {
    expect(await app.contato.count()).toBe(0);
    expect(await app.tenant.findMany()).toEqual([]);
    const [linha] = await app.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM contato`;
    expect(linha!.n).toBe(0);
  });

  it('SEG-1: comTenant enxerga só os dados do próprio tenant', async () => {
    for (const tenantId of [T1, T2]) {
      const contatos = await comTenant(app, tenantId, (tx) =>
        tx.contato.findMany({ select: { id: true, tenant_id: true }, orderBy: { id: 'asc' } }),
      );
      expect(contatos.map((c) => c.id)).toEqual([...CONTATOS[tenantId]!].sort());
      expect(new Set(contatos.map((c) => c.tenant_id))).toEqual(new Set([tenantId]));
    }
  });

  it('SEG-6: o contexto não vaza para a próxima transação na mesma conexão do pool', async () => {
    const dentro = await comTenant(
      app,
      T1,
      (tx) =>
        tx.$queryRaw<Array<{ pid: number; tenant: string }>>`
        SELECT pg_backend_pid() AS pid, current_setting('app.tenant_id', true) AS tenant`,
    );
    const depois = await lerContexto(app);

    expect(dentro[0]!.tenant).toBe(T1);
    expect(depois.pid).toBe(dentro[0]!.pid); // mesma conexão física
    expect(depois.tenant).toBeNull();
    expect(await app.contato.count()).toBe(0);
  });

  it('SEG-6: o contexto também some quando a transação falha (rollback)', async () => {
    await expect(
      comTenant(app, T1, async () => {
        throw new Error('falha no meio do comando');
      }),
    ).rejects.toThrow('falha no meio do comando');

    expect((await lerContexto(app)).tenant).toBeNull();
    expect(await app.contato.count()).toBe(0);
  });

  it('SEG-1: transações concorrentes de tenants diferentes não se misturam', async () => {
    const rodadas = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? T1 : T2));
    const resultados = await Promise.all(
      rodadas.map((tenantId) =>
        comTenant(appPool, tenantId, async (tx) => {
          // Força a sobreposição entre as transações nas 4 conexões do pool.
          await tx.$executeRaw`SELECT pg_sleep(0.02)`;
          const contatos = await tx.contato.findMany({ select: { tenant_id: true } });
          return { tenantId, vistos: contatos.map((c) => c.tenant_id) };
        }),
      ),
    );
    for (const { tenantId, vistos } of resultados) {
      expect(vistos).toHaveLength(CONTATOS[tenantId]!.length);
      expect(new Set(vistos)).toEqual(new Set([tenantId]));
    }
  });

  it('SEG-1: clienteDoTenant aplica o contexto a cada operação avulsa', async () => {
    const t1 = clienteDoTenant(app, T1);
    expect(await t1.contato.count()).toBe(2);
    expect(await t1.contato.findUnique({ where: { id: CONTATOS[T2]![0]! } })).toBeNull();
    // Atualizar um contato de outro tenant não afeta nada.
    const { count } = await t1.contato.updateMany({
      where: { id: CONTATOS[T2]![0]! },
      data: { nome: 'invadido' },
    });
    expect(count).toBe(0);
    // E o cliente base continua sem contexto.
    expect(await app.contato.count()).toBe(0);
  });

  it('SEG-1: o RLS recusa gravar linha de outro tenant (WITH CHECK)', async () => {
    const t1 = clienteDoTenant(app, T1);
    await expect(
      t1.contato.create({
        data: {
          id: randomUUID(),
          tenant_id: T2,
          empresa_id: EMPRESA[T2]!,
          nome: 'Intruso',
          email: 'intruso@teste.local',
          email_normalizado: 'intruso@teste.local',
        },
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('clienteDoTenant grava no próprio tenant', async () => {
    const t1 = clienteDoTenant(app, T1);
    const id = randomUUID();
    await t1.contato.create({
      data: {
        id,
        tenant_id: T1,
        empresa_id: EMPRESA[T1]!,
        nome: 'Nova',
        email: 'nova@teste.local',
        email_normalizado: 'nova@teste.local',
      },
    });
    expect(await t1.contato.count()).toBe(3);
    await t1.contato.delete({ where: { id } });
    expect(await t1.contato.count()).toBe(2);
  });

  it.each(['', 'nao-e-uuid', `${T1}'; SELECT 1; --`, '00000000-0000-0000-0000-00000000000g'])(
    'recusa tenant_id inválido antes de ir ao banco: %j',
    async (invalido) => {
      expect(() => clienteDoTenant(app, invalido)).toThrow(TenantInvalidoError);
      await expect(comTenant(app, invalido, async () => 1)).rejects.toThrow(TenantInvalidoError);
    },
  );
});
