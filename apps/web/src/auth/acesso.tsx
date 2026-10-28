import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { type ReactNode, useSyncExternalStore } from 'react';
import { consultaEu } from './consultas';

const rotaApp = getRouteApi('/_app');

/** hasOwn: "toString" e afins vêm do protótipo e não são permissão. */
export const temPermissao = (permissoes: Record<string, unknown>, chave: string) =>
  Object.hasOwn(permissoes, chave);

/**
 * O que o membro pode na empresa atual (permissões do /v1/eu). Serve só para esconder menus e
 * ações: quem nega de fato é a API (403 sem_permissao).
 */
export function useAcesso() {
  const { cliente, empresa: empresaAtual } = rotaApp.useRouteContext();
  const eu = useQuery(consultaEu(cliente));
  const empresaId = useSyncExternalStore(empresaAtual.assinar, empresaAtual.obter);
  const empresas = eu.data?.empresas ?? [];
  const empresa = empresas.find((e) => e.id === empresaId) ?? null;
  const permissoes = empresa?.permissoes ?? {};
  return {
    eu: eu.data,
    empresa,
    empresas,
    pode: (chave: string) => temPermissao(permissoes, chave),
    escopo: (chave: string) => (temPermissao(permissoes, chave) ? permissoes[chave] : undefined),
  };
}

/** Mostra o conteúdo só com a permissão na empresa atual (ex.: botão "Novo contato"). */
export function SePermitido({ permissao, children }: { permissao: string; children: ReactNode }) {
  return useAcesso().pode(permissao) ? children : null;
}
