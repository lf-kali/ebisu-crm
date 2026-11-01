import { CHAVES_PERMISSAO } from '@ebisu/db';

// Marcas de acesso (plano docs/planos/f3-2-contexto-rbac.md, decisão 1). Toda rota declara
// exatamente uma: o guard global (GuardaContexto) recusa a rota sem marca ou com mais de uma.

export const CHAVE_ACESSO = 'ebisu:acesso';

export type Acesso =
  | { tipo: 'publica' }
  | { tipo: 'autenticado' }
  | { tipo: 'permissao'; chave: string; apiKey: boolean }
  | { tipo: 'conta'; chave: string }
  | { tipo: 'publica_api_key'; chave: string };

/** Onde moram as rotas da chave de navegador (o CORS só vale aqui). */
export const PREFIXO_ROTAS_PUBLICAS = '/v1/publico/';

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
 *
 * `{ apiKey: true }` (plano f3-5, decisões 1 e 2): a rota também aceita `X-Api-Key` de servidor
 * com esse escopo; a empresa é a da chave e o comando roda sem membro. Sem a opção, a chave não
 * autentica.
 */
export function Permissao(chave: string, opcoes: { apiKey?: true } = {}): MethodDecorator {
  if (!CHAVES_PERMISSAO.has(chave))
    throw new Error(`@Permissao com chave fora do catálogo: ${chave}`);
  return marcar({ tipo: 'permissao', chave, apiKey: opcoes.apiKey === true });
}

/**
 * Rota pública da chave de navegador (plano f3-5, decisão 2), sempre sob `/v1/publico/`: exige
 * `X-Api-Key` de navegador com o escopo e um `Origin` cadastrado nela; sem Bearer.
 */
export function ApiKeyPublica(chave: string): MethodDecorator {
  if (!CHAVES_PERMISSAO.has(chave))
    throw new Error(`@ApiKeyPublica com chave fora do catálogo: ${chave}`);
  return marcar({ tipo: 'publica_api_key', chave });
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
