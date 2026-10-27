import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Com prisma.config.ts o Prisma não carrega .env sozinho; usamos o .env da raiz do monorepo.
const ENV_RAIZ = new URL('../../.env', import.meta.url);
if (existsSync(ENV_RAIZ)) process.loadEnvFile(ENV_RAIZ);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
});
