export { Prisma, PrismaClient } from '@prisma/client';
export {
  clienteDoTenant,
  comTenant,
  TenantInvalidoError,
  TransacaoNoClienteDoTenantError,
  type ClienteDoTenant,
  type OpcoesTransacao,
} from './tenancy.js';
export * from './seeds/index.js';
