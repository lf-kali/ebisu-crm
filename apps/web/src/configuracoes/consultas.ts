import { ListaPapeis, Membro, ROTAS_MEMBROS } from '@ebisu/contracts';
import { queryOptions } from '@tanstack/react-query';
import type { ClienteApi } from '../api/cliente';

// Consultas das Configurações (TanStack Query). As listas paginadas usam usePaginacaoCursor.

export const CHAVE_MEMBROS = ['configuracoes', 'membros'] as const;
export const CHAVE_CONVITES = ['configuracoes', 'convites'] as const;

export const consultaPapeis = (cliente: ClienteApi) =>
  queryOptions({
    queryKey: ['configuracoes', 'papeis'],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_MEMBROS.papeis, { resposta: ListaPapeis, sinal: signal }),
    staleTime: 5 * 60_000,
  });

export const consultaMembro = (cliente: ClienteApi, id: string) =>
  queryOptions({
    queryKey: [...CHAVE_MEMBROS, id],
    queryFn: ({ signal }) =>
      cliente.get(`${ROTAS_MEMBROS.membros}/${id}`, { resposta: Membro, sinal: signal }),
  });
