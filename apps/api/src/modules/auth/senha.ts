import { type Algorithm, hash, verify } from '@node-rs/argon2';

// Senha com argon2id (D-T05), parâmetros mínimos da OWASP: 19 MiB, 2 iterações, 1 thread.
// `Algorithm` é um const enum ambiente: o valor vai literal (2 = Argon2id).
const ARGON2ID = 2 as Algorithm;
const PARAMETROS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const gerarHashSenha = (senha: string) => hash(senha, PARAMETROS);

let hashFicticio: Promise<string> | undefined;

/**
 * Confere a senha. Sem hash (e-mail inexistente ou usuário sem senha), confere contra um hash
 * fictício: o mesmo custo de CPU e de tempo, para a resposta não revelar se o e-mail existe.
 */
export async function verificarSenha(guardado: string | null | undefined, senha: string) {
  if (!guardado) {
    hashFicticio ??= gerarHashSenha('senha-ficticia-para-igualar-o-tempo');
    await verify(await hashFicticio, senha).catch(() => false);
    return false;
  }
  return verify(guardado, senha).catch(() => false);
}
