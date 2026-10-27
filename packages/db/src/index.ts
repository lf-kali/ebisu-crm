export { Prisma, PrismaClient } from '@prisma/client';
export {
  clienteDoTenant,
  comTenant,
  TenantInvalidoError,
  type ClienteDoTenant,
  type OpcoesTransacao,
} from './tenancy.js';
