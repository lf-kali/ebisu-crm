import { createHash, randomBytes } from 'node:crypto';

// Token do convite (F3-4b2; plano docs/planos/f3-4b2-convites.md, decisão 3): o worker gera no
// envio e só o hash vai para o banco; a API confere o token do link pelo hash. Fica aqui porque
// a API e o worker usam os dois.

export const VALIDADE_CONVITE_DIAS = 7;

/** 32 bytes aleatórios em base64url (43 caracteres). */
export const gerarTokenConvite = () => randomBytes(32).toString('base64url');

/** SHA-256 em hex: o que vai em convite.token_hash. */
export const hashDoTokenConvite = (token: string) =>
  createHash('sha256').update(token).digest('hex');
