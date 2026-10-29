import { CHAVES_PERMISSAO } from '@ebisu/db';

// Marcas de acesso (plano docs/planos/f3-2-contexto-rbac.md, decisão 1). Toda rota declara
// exatamente uma: o guard global (GuardaContexto) recusa a rota sem marca ou com mais de uma.

export const CHAVE_ACESSO = 'ebisu:acesso';

export type Acesso =
  | { tipo: 'publica' }
  | { tipo: 'autenticado' }
  | { tipo: 'permissao'; chave: string }
  | { tipo: 'conta'; chave: string };

function marcar(acesso: Acesso): MethodDecorator {
  return (_alvo, _nome, descritor) => {
    const handler = descritor.value as object;
    const atuais = (Reflect.getMetadata(CHAVE_ACESSO, handler) as Acesso[] | undefined) ?? [];
    Reflect.defineMetadata(CHAVE_ACESSO, [...atuais, acesso], handler);
  };
}

/** Rota sem login (saúde, login, refresh, logout). */
export const Publica = (): MethodDecorator => marcar({ tipo: 'publica' });

/** Exige access token válido e sessão ativa, sem empresa (ex.: `/v1/eu`, troca de conta). */
export const SoAutenticado = (): MethodDecorator => marcar({ tipo: 'autenticado' });

/**
 * Rota de domínio: exige `X-Empresa-Id` atribuída ao membro e a permissão `recurso.acao` nessa
 * empresa. Chave fora do catálogo derruba a subida da API (erro de programação).
 */
export function Permissao(chave: string): MethodDecorator {
  if (!CHAVES_PERMISSAO.has(chave))
    throw new Error(`@Permissao com chave fora do catálogo: ${chave}`);
  return marcar({ tipo: 'permissao', chave });
}

/**
 * Rota da conta, sem empresa (ex.: `/v1/empresas`; plano f3-4a, decisão 8): não lê
 * `X-Empresa-Id` e exige a permissão com escopo TENANT num papel atribuído a todas as empresas.
 */
export function PermissaoNaConta(chave: string): MethodDecorator {
  if (!CHAVES_PERMISSAO.has(chave))
    throw new Error(`@PermissaoNaConta com chave fora do catálogo: ${chave}`);
  return marcar({ tipo: 'conta', chave });
}

/** As marcas declaradas no handler (vazio se nenhuma). */
export const marcasDe = (handler: object): Acesso[] =>
  (Reflect.getMetadata(CHAVE_ACESSO, handler) as Acesso[] | undefined) ?? [];
