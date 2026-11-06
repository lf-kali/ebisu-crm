import {
  Funil,
  ListaMotivosPerda,
  NegocioDetalhado,
  ROTAS_FUNIL,
  ROTAS_NEGOCIOS,
  ROTAS_ORIGENS,
} from '@ebisu/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import type { ClienteApi } from '../api/cliente';
import { CHAVE_CONTATOS } from '../contatos/consultas';

// Consultas das telas de negócios (TanStack Query). Tudo sob ['negocios'] e ['crm']: trocar de
// empresa limpa o cache (routes/_app.tsx).

export const CHAVE_NEGOCIOS = ['negocios'] as const;
/** Tarefas e atividades, mostradas nas fichas do negócio e do contato. */
export const CHAVE_CRM = ['crm'] as const;

export const consultaFunil = (cliente: ClienteApi) =>
  queryOptions({
    queryKey: [...CHAVE_NEGOCIOS, 'funil'],
    queryFn: ({ signal }) => cliente.get(ROTAS_FUNIL.funil, { resposta: Funil, sinal: signal }),
    staleTime: 5 * 60_000,
  });

export const consultaNegocio = (cliente: ClienteApi, id: string) =>
  queryOptions({
    queryKey: [...CHAVE_NEGOCIOS, 'ficha', id],
    queryFn: ({ signal }) =>
      cliente.get(`${ROTAS_NEGOCIOS.negocios}/${id}`, {
        resposta: NegocioDetalhado,
        sinal: signal,
      }),
  });

export const consultaMotivos = (cliente: ClienteApi) =>
  queryOptions({
    queryKey: [...CHAVE_NEGOCIOS, 'motivos'],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_ORIGENS.motivosPerda, { resposta: ListaMotivosPerda, sinal: signal }),
    staleTime: 5 * 60_000,
  });

/**
 * Depois de mudar um negócio, uma tarefa ou uma atividade: o quadro, as fichas e as listas das
 * duas fichas (a completude e o "o que falta" dependem das tarefas). Os contatos também: mover
 * pode qualificar o contato (CRM-2) e as conversas mudam a última interação. As listas de opções
 * (funil, motivos, origens, responsáveis) ficam.
 */
export const atualizarCrm = (queryClient: QueryClient) => {
  const semOpcoes = (q: { queryKey: readonly unknown[] }) =>
    !['funil', 'motivos', 'origens', 'responsaveis'].includes(String(q.queryKey[1]));
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAVE_NEGOCIOS, predicate: semOpcoes }),
    queryClient.invalidateQueries({ queryKey: CHAVE_CONTATOS, predicate: semOpcoes }),
    queryClient.invalidateQueries({ queryKey: CHAVE_CRM }),
  ]);
};
