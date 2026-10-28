// Banco de teste (Testcontainers): Postgres efêmero com as migrações e os papéis aplicados.
// Exportado como `@ebisu/db/teste` para os testes de integração da API; não é usado em produção.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

// Funciona em src/teste (testes do pacote) e em dist/teste (outros pacotes via @ebisu/db/teste).
const PASTA_PACOTE = fileURLToPath(new URL('../..', import.meta.url));
export const IMAGEM_POSTGRES = 'postgres:16.15-alpine';
export const SENHA_APP = 'senha-app-teste';
export const SENHA_AUTH = 'senha-auth-teste';

export interface BancoDeTeste {
  container: StartedPostgreSqlContainer;
  /** URL do superusuário (dono das tabelas), como a usada pelas migrações. */
  urlAdmin: string;
  urlDoPapel(papel: 'ebisu_app' | 'ebisu_auth'): string;
  conectar(url: string): Promise<pg.Client>;
}

export function rodarNoPacote(
  comando: string,
  args: string[],
  env: Record<string, string>,
): string {
  // .env da raiz não interfere: prisma.config.ts e o script de papéis não sobrescrevem variáveis já definidas.
  return execFileSync(comando, args, {
    cwd: PASTA_PACOTE,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Sobe um Postgres vazio, aplica `prisma migrate deploy` e configura os papéis. */
export async function criarBancoDeTeste(): Promise<BancoDeTeste> {
  const container = await new PostgreSqlContainer(IMAGEM_POSTGRES).start();
  const urlAdmin = container.getConnectionUri();
  const env = { DATABASE_URL: urlAdmin, DB_APP_PASSWORD: SENHA_APP, DB_AUTH_PASSWORD: SENHA_AUTH };

  rodarNoPacote('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], env);
  rodarNoPacote('node', ['scripts/configurar-papeis.mjs'], env);

  const urlDoPapel = (papel: 'ebisu_app' | 'ebisu_auth') => {
    const url = new URL(urlAdmin);
    url.username = papel;
    url.password = papel === 'ebisu_app' ? SENHA_APP : SENHA_AUTH;
    return url.toString();
  };

  const conectar = async (url: string) => {
    const cliente = new pg.Client({ connectionString: url });
    await cliente.connect();
    return cliente;
  };

  return { container, urlAdmin, urlDoPapel, conectar };
}

/** Executa a consulta e devolve o código SQLSTATE do erro (ou null se não falhar). */
export async function codigoDoErro(cliente: pg.Client, sql: string, params: unknown[] = []) {
  try {
    await cliente.query(sql, params);
    return null;
  } catch (erro) {
    return (erro as { code?: string }).code ?? 'desconhecido';
  }
}
