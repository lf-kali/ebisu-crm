import {
  createPrivateKey,
  createPublicKey,
  createHash,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Config } from '../../core/config/config.js';

// Access token JWT EdDSA (Ed25519) de 15 min (D-T05; decisão do usuário, 2026-10-28). A chave
// pública sai da privada; o `kid` permite rodar a chave sem derrubar tokens em voo.

export const ACESSO_SEGUNDOS = 900;
const EMISSOR = 'ebisu-api';
const PUBLICO = 'ebisu';

export interface Identidade {
  usuarioId: string;
  tenantId: string;
  membroId: string;
}

const Reivindicacoes = z.object({ sub: z.uuid(), tid: z.uuid(), mid: z.uuid() });

export class ChaveJwtInvalidaError extends Error {
  constructor() {
    super('AUTH_JWT_CHAVE_PRIVADA precisa ser uma chave privada Ed25519 (PKCS#8 PEM)');
    this.name = 'ChaveJwtInvalidaError';
  }
}

export function criarTokensDeAcesso(
  config: Pick<Config, 'AUTH_JWT_CHAVE_PRIVADA' | 'AUTH_JWT_KID'>,
) {
  let privada: KeyObject;
  try {
    privada = createPrivateKey(config.AUTH_JWT_CHAVE_PRIVADA);
  } catch {
    throw new ChaveJwtInvalidaError();
  }
  if (privada.asymmetricKeyType !== 'ed25519') throw new ChaveJwtInvalidaError();
  const publica = createPublicKey(privada);

  return {
    emitir: (identidade: Identidade) =>
      new SignJWT({ tid: identidade.tenantId, mid: identidade.membroId })
        .setProtectedHeader({ alg: 'EdDSA', kid: config.AUTH_JWT_KID, typ: 'JWT' })
        .setSubject(identidade.usuarioId)
        .setIssuer(EMISSOR)
        .setAudience(PUBLICO)
        .setIssuedAt()
        .setExpirationTime(`${ACESSO_SEGUNDOS}s`)
        .sign(privada),

    /** Identidade do token, ou null se inválido, vencido, de outro emissor ou outro algoritmo. */
    async verificar(token: string): Promise<Identidade | null> {
      try {
        const { payload } = await jwtVerify(token, publica, {
          algorithms: ['EdDSA'],
          issuer: EMISSOR,
          audience: PUBLICO,
        });
        const claims = Reivindicacoes.parse(payload);
        return { usuarioId: claims.sub, tenantId: claims.tid, membroId: claims.mid };
      } catch {
        return null;
      }
    },
  };
}

export type TokensDeAcesso = ReturnType<typeof criarTokensDeAcesso>;
export const TOKENS_DE_ACESSO = Symbol('TOKENS_DE_ACESSO');

/** Refresh token opaco: 256 bits aleatórios; o banco guarda só o hash (vazamento do banco não vira sessão). */
export const gerarRefreshToken = () => randomBytes(32).toString('base64url');
export const hashDoRefresh = (token: string) => createHash('sha256').update(token).digest('hex');
