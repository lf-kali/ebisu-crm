import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ambiente do E2E (plano docs/planos/f3-web-1-cadastro-convite.md, decisão 7): parte do .env da
// raiz (o mesmo do docker compose) e troca o que precisa ficar separado do `pnpm dev`: banco
// próprio, banco lógico 15 do Redis e portas próprias.

export const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const ENV_RAIZ = `${RAIZ}.env`;
if (existsSync(ENV_RAIZ)) process.loadEnvFile(ENV_RAIZ);

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não definido (copie .env.example para .env)`);
  return valor;
}

export const BANCO_E2E = 'ebisu_e2e';
const PORTA_API = 3101;
const PORTA_WEB = 5181;

/** A mesma URL de Postgres, apontando para outro banco. */
function noBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}

function redisNoBanco(url: string, indice: number): string {
  const u = new URL(url);
  u.pathname = `/${indice}`;
  return u.toString();
}

export const URL_WEB = `http://localhost:${PORTA_WEB}`;
export const URL_API = `http://localhost:${PORTA_API}`;
export const URL_MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;

/**
 * O setup apaga e recria o banco `ebisu_e2e`: só num Postgres local, salvo pedido explícito
 * (E2E_BANCO_REMOTO=1), para um .env apontado para um servidor compartilhado não o derrubar lá.
 */
const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostDoBanco = new URL(obrigatoria('DATABASE_URL')).hostname;
if (!LOCAIS.has(hostDoBanco) && process.env.E2E_BANCO_REMOTO !== '1')
  throw new Error(
    `DATABASE_URL aponta para ${hostDoBanco}: o E2E recria o banco ${'ebisu_e2e'} e só roda num ` +
      'Postgres local (ou com E2E_BANCO_REMOTO=1)',
  );

/** Superusuário/migrador no banco do E2E e no banco `postgres` (para recriar o do E2E). */
export const URL_MIGRADOR = noBanco(obrigatoria('DATABASE_URL'), BANCO_E2E);
export const URL_ADMIN = noBanco(obrigatoria('DATABASE_URL'), 'postgres');
export const URL_REDIS = redisNoBanco(obrigatoria('REDIS_URL'), 15);

/** Chave do access token só desta rodada: o E2E não depende das chaves do .env. */
const chaveJwt = generateKeyPairSync('ed25519')
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

/** Variáveis da API e do worker do E2E (por cima do .env, que o --env-file não sobrescreve). */
export const ENV_PROCESSOS: Record<string, string> = {
  DATABASE_URL: URL_MIGRADOR,
  DATABASE_URL_APP: noBanco(obrigatoria('DATABASE_URL_APP'), BANCO_E2E),
  DATABASE_URL_AUTH: noBanco(obrigatoria('DATABASE_URL_AUTH'), BANCO_E2E),
  REDIS_URL: URL_REDIS,
  API_PORT: String(PORTA_API),
  WEB_ORIGENS: URL_WEB,
  AUTH_JWT_CHAVE_PRIVADA: chaveJwt,
  AUTH_JWT_KID: 'e2e',
  WEB_URL: URL_WEB,
  EMAIL_INTERVALO_MS: '500',
  VITE_API_PROXY: URL_API,
  VITE_API_SIMULADA: '',
};

export const PORTAS = { api: PORTA_API, web: PORTA_WEB };
