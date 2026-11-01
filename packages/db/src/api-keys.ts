import { createHash, randomBytes } from 'node:crypto';

// API key (F3-5; plano docs/planos/f3-5-api-keys-cors.md, decisão 6): `ebk_live_` + 32 bytes
// aleatórios em base64url. O prefixo (`ebk_live_` + 8 caracteres) acha a chave; no banco fica só
// o SHA-256 do token inteiro. Com 256 bits de entropia, um hash lento não acrescenta nada.

export const PREFIXO_API_KEY = 'ebk_live_';
const TAMANHO_PREFIXO = PREFIXO_API_KEY.length + 8;
const FORMATO = /^ebk_live_[A-Za-z0-9_-]{43}$/;

/** SHA-256 em hex: o que vai em api_key.hash. */
export const hashDaApiKey = (token: string) => createHash('sha256').update(token).digest('hex');

/** Token novo, o prefixo exibido e o hash. O token só sai daqui na resposta da criação. */
export function gerarApiKey() {
  const token = PREFIXO_API_KEY + randomBytes(32).toString('base64url');
  return { token, prefixo: token.slice(0, TAMANHO_PREFIXO), hash: hashDaApiKey(token) };
}

/** O prefixo de um token bem formado, ou null (nem vale ir ao banco). */
export const prefixoDaApiKey = (token: string) =>
  FORMATO.test(token) ? token.slice(0, TAMANHO_PREFIXO) : null;
