// `pnpm db:seed` (catálogo de permissões) e `pnpm db:seed:demo` (tenant de demonstração).
// Rodam com DATABASE_URL, o papel migrador. Idempotentes.
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { semearDemo } from './demo.js';
import { semearCatalogoPermissoes } from './semear.js';

const ENV_RAIZ = new URL('../../../../.env', import.meta.url);
if (existsSync(ENV_RAIZ)) process.loadEnvFile(ENV_RAIZ);

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definido');

const comandos: Record<string, (cliente: PrismaClient) => Promise<string>> = {
  async catalogo(cliente) {
    return `Catálogo de permissões: ${await semearCatalogoPermissoes(cliente)} permissões`;
  },
  async demo(cliente) {
    // Grava uma senha conhecida (SENHA_DEMO): nunca num ambiente de produção.
    if (process.env.NODE_ENV === 'production')
      throw new Error('seed de demonstração recusado com NODE_ENV=production');
    const resultado = await semearDemo(cliente);
    return resultado.criado
      ? `Tenant de demonstração criado (${resultado.tenantId}): ${resultado.empresas} empresas, ${resultado.contatos} contatos`
      : `Tenant de demonstração já existe (${resultado.tenantId}); só as senhas demo foram regravadas`;
  },
};

const nome = process.argv[2] ?? '';
const comando = comandos[nome];
if (!comando) throw new Error(`Uso: cli.js <${Object.keys(comandos).join('|')}>`);

const cliente = new PrismaClient({ datasourceUrl: url });
try {
  process.stdout.write(`${await comando(cliente)}\n`);
} finally {
  await cliente.$disconnect();
}
