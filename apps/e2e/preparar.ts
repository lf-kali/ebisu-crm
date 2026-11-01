import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { Redis } from 'ioredis';
import pg from 'pg';
import {
  BANCO_E2E,
  ENV_PROCESSOS,
  PORTAS,
  RAIZ,
  URL_ADMIN,
  URL_API,
  URL_REDIS,
  URL_WEB,
} from './ambiente';

// Setup global do Playwright: banco do E2E do zero (migrado, com os papéis e o catálogo de
// permissões), Redis do E2E vazio, e API, worker e web compilados em processos filhos. Cada
// processo roda no seu grupo, encerrado inteiro no fim (kill pelo PGID).

const env = { ...process.env, ...ENV_PROCESSOS };

function exigirBuild() {
  const faltando = [
    'apps/api/dist/main.js',
    'apps/worker/dist/main.js',
    'apps/web/dist/index.html',
    'packages/db/dist/seeds/cli.js',
  ].filter((arquivo) => !existsSync(`${RAIZ}${arquivo}`));
  if (faltando.length) throw new Error(`Compile antes (pnpm build): falta ${faltando.join(', ')}`);
}

const portaOcupada = (porta: number) =>
  new Promise<boolean>((resolver) => {
    const conexao = createConnection({ port: porta, host: '127.0.0.1' });
    conexao.once('connect', () => (conexao.destroy(), resolver(true)));
    conexao.once('error', () => resolver(false));
  });

async function recriarBanco() {
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${BANCO_E2E} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${BANCO_E2E}`);
  } finally {
    await admin.end();
  }
  const rodar = (comando: string, args: string[]) =>
    execFileSync(comando, args, { cwd: RAIZ, env, stdio: ['ignore', 'ignore', 'inherit'] });
  rodar('pnpm', ['--filter', '@ebisu/db', 'exec', 'prisma', 'migrate', 'deploy']);
  rodar('node', ['packages/db/scripts/configurar-papeis.mjs']);
  rodar('node', ['packages/db/dist/seeds/cli.js', 'catalogo']);
}

async function esvaziarRedis() {
  const redis = new Redis(URL_REDIS);
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

function iniciar(nome: string, comando: string, args: string[], pasta: string): ChildProcess {
  const filho = spawn(comando, args, {
    cwd: `${RAIZ}${pasta}`,
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  filho.once('exit', (codigo) => {
    if (codigo) process.stderr.write(`[e2e] ${nome} saiu com código ${codigo}\n`);
  });
  return filho;
}

async function esperarResposta(url: string, prazoMs = 60_000) {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Ainda subindo.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} não respondeu em ${prazoMs / 1000} s`);
}

export default async function preparar() {
  exigirBuild();
  for (const porta of [PORTAS.api, PORTAS.web])
    if (await portaOcupada(porta))
      throw new Error(`Porta ${porta} ocupada: o E2E precisa dela livre`);
  await recriarBanco();
  await esvaziarRedis();

  const processos = [
    iniciar('API', 'node', ['--env-file-if-exists=../../.env', 'dist/main.js'], 'apps/api'),
    iniciar('worker', 'node', ['--env-file-if-exists=../../.env', 'dist/main.js'], 'apps/worker'),
    iniciar(
      'web',
      'pnpm',
      ['exec', 'vite', 'preview', '--port', String(PORTAS.web), '--strictPort'],
      'apps/web',
    ),
  ];
  const encerrar = async () => {
    for (const filho of processos)
      if (filho.pid && filho.exitCode === null) {
        try {
          process.kill(-filho.pid, 'SIGTERM');
        } catch {
          // Já tinha saído.
        }
      }
  };
  try {
    await esperarResposta(`${URL_API}/v1/saude`);
    // Pelo proxy do preview: o navegador fala só com a origem do web.
    await esperarResposta(`${URL_WEB}/v1/saude`);
  } catch (erro) {
    await encerrar();
    throw erro;
  }
  return encerrar;
}
