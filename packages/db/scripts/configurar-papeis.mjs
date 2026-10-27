// Liga LOGIN e define a senha dos papéis ebisu_app e ebisu_auth (criados NOLOGIN pela migração).
// Roda depois de `prisma migrate deploy`, com DATABASE_URL de um papel com CREATEROLE.
// Idempotente: pode rodar a cada deploy (também serve para rotacionar senhas).
import { existsSync } from 'node:fs';
import pg from 'pg';

const ENV_RAIZ = new URL('../../../.env', import.meta.url);
if (existsSync(ENV_RAIZ)) process.loadEnvFile(ENV_RAIZ);

function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não definido`);
  return valor;
}

const papeis = [
  { nome: 'ebisu_app', senha: obrigatoria('DB_APP_PASSWORD') },
  { nome: 'ebisu_auth', senha: obrigatoria('DB_AUTH_PASSWORD') },
];

const cliente = new pg.Client({ connectionString: obrigatoria('DATABASE_URL') });
await cliente.connect();
try {
  for (const { nome, senha } of papeis) {
    const existe = await cliente.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [nome]);
    if (existe.rowCount !== 1) {
      throw new Error(`Papel ${nome} não existe; rode as migrações antes (prisma migrate deploy)`);
    }
    // Configurações por papel (ALTER ROLE ... SET) não fazem parte do desenho: descarta.
    const banco = cliente.escapeIdentifier(
      (await cliente.query('SELECT current_database() AS d')).rows[0].d,
    );
    await cliente.query(`ALTER ROLE ${nome} RESET ALL`);
    await cliente.query(`ALTER ROLE ${nome} IN DATABASE ${banco} RESET ALL`);
    // Mesma regra da migração (função motivo_papel_inseguro): o papel pode ter mudado depois dela.
    const { rows } = await cliente.query('SELECT motivo_papel_inseguro($1) AS motivo', [nome]);
    if (rows[0].motivo) {
      throw new Error(
        `Papel ${nome} inseguro (${rows[0].motivo}): corrija antes de liberar o LOGIN`,
      );
    }
    // ALTER ROLE não aceita parâmetros: nome é constante e a senha vai como literal escapado.
    // A senha trafega no statement: não rode com log_statement = 'ddl'/'all' no servidor.
    await cliente.query(`ALTER ROLE ${nome} WITH LOGIN PASSWORD ${cliente.escapeLiteral(senha)}`);
    console.log(`Papel ${nome}: LOGIN e senha definidos`);
  }
} finally {
  await cliente.end();
}
