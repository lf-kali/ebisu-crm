import {
  Contato,
  ListaConsentimentos,
  ListaOpcoesResponsavel,
  ListaOrigens,
  ROTAS_CONTATOS,
  ROTAS_MEMBROS,
  ROTAS_ORIGENS,
} from '@ebisu/contracts';
import { queryOptions } from '@tanstack/react-query';
import type { ClienteApi } from '../api/cliente';

// Consultas das telas de contatos (TanStack Query). A lista paginada usa usePaginacaoCursor. Tudo
// sob ['contatos']: trocar de empresa limpa o cache (routes/_app.tsx).

export const CHAVE_CONTATOS = ['contatos'] as const;

export const consultaContato = (cliente: ClienteApi, id: string) =>
  queryOptions({
    queryKey: [...CHAVE_CONTATOS, 'ficha', id],
    queryFn: ({ signal }) =>
      cliente.get(`${ROTAS_CONTATOS.contatos}/${id}`, { resposta: Contato, sinal: signal }),
  });

export const consultaConsentimentos = (cliente: ClienteApi, id: string) =>
  queryOptions({
    queryKey: [...CHAVE_CONTATOS, 'ficha', id, 'consentimentos'],
    queryFn: ({ signal }) =>
      cliente.get(`${ROTAS_CONTATOS.contatos}/${id}/consentimentos`, {
        resposta: ListaConsentimentos,
        sinal: signal,
      }),
  });

export const consultaOrigens = (cliente: ClienteApi) =>
  queryOptions({
    queryKey: [...CHAVE_CONTATOS, 'origens'],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_ORIGENS.origens, { resposta: ListaOrigens, sinal: signal }),
    staleTime: 5 * 60_000,
  });

export const consultaResponsaveis = (cliente: ClienteApi) =>
  queryOptions({
    queryKey: [...CHAVE_CONTATOS, 'responsaveis'],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_MEMBROS.opcoes, { resposta: ListaOpcoesResponsavel, sinal: signal }),
    staleTime: 5 * 60_000,
  });
