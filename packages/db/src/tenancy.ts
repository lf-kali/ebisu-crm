import { Prisma, type PrismaClient } from '@prisma/client';

// Contexto de tenant (D-A05, SEG-1, SEG-6): o RLS do banco filtra por app_tenant_id(),
// que lê `app.tenant_id`. Ele é definido com set_config(..., true), ou seja, LOCAL à
// transação: some no COMMIT/ROLLBACK e nunca vaza para a próxima transação da mesma
// conexão do pool. Sem contexto, nenhuma linha é visível (falha fechada).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantInvalidoError extends Error {
  constructor(tenantId: unknown) {
    super(`tenant_id inválido: ${JSON.stringify(tenantId)}`);
    this.name = 'TenantInvalidoError';
  }
}

function validarTenantId(tenantId: string): string {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) throw new TenantInvalidoError(tenantId);
  return tenantId;
}

function definirTenant(cliente: Pick<PrismaClient, '$executeRaw'>, tenantId: string) {
  return cliente.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

export interface OpcoesTransacao {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
}

/**
 * Abre uma transação interativa com o tenant definido antes de qualquer consulta.
 * Base do `executarComando` (spec §5.4): tudo dentro de `fn` deve usar o `tx` recebido.
 */
export async function comTenant<T>(
  cliente: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opcoes?: OpcoesTransacao,
): Promise<T> {
  const id = validarTenantId(tenantId);
  return cliente.$transaction(async (tx) => {
    await definirTenant(tx, id);
    return fn(tx);
  }, opcoes);
}

/**
 * Cliente para leituras/escritas avulsas de um tenant: cada operação de model roda numa
 * transação em lote `[set_config, operação]`. Não use dentro de `comTenant` (lá, use o `tx`)
 * e não cobre `$queryRaw`/`$executeRaw`, que rodam sem contexto e portanto não veem linhas.
 */
export function clienteDoTenant(cliente: PrismaClient, tenantId: string) {
  const id = validarTenantId(tenantId);
  return cliente.$extends({
    name: 'tenancy',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, resultado] = await cliente.$transaction([
            definirTenant(cliente, id),
            query(args),
          ]);
          return resultado;
        },
      },
    },
  });
}

export type ClienteDoTenant = ReturnType<typeof clienteDoTenant>;
