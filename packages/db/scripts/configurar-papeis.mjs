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
    const { rows } = await cliente.query(
      `SELECT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
               OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)) AS inseguro
         FROM pg_roles r WHERE r.rolname = $1`,
      [nome],
    );
    if (rows.length !== 1) {
      throw new Error(`Papel ${nome} não existe; rode as migrações antes (prisma migrate deploy)`);
    }
    // Mesma checagem da migração: o papel pode ter sido alterado depois dela.
    if (rows[0].inseguro) {
      throw new Error(
        `Papel ${nome} tem SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION ou é membro de outro papel; corrija antes de liberar o LOGIN`,
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
