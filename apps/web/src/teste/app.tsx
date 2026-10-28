import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { criarQueryClient, criarRouter, criarSessaoECliente } from '../router';
import { simulada } from './servidor';

interface OpcoesApp {
  /** E-mail de quem já tem sessão (cookie de refresh simulado); null = ninguém logado. */
  logado?: string | null;
  tenantId?: string;
}

/** Monta o app inteiro (roteador + TanStack Query + sessão) num caminho, sem navegador. */
export function renderizarApp(
  caminho = '/',
  { logado = 'ana@demo.test', tenantId }: OpcoesApp = {},
) {
  if (logado) simulada.jaLogado(logado, tenantId);
  const queryClient = criarQueryClient();
  // Mesma política de repetição do app, sem a espera entre tentativas.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  });
  const { sessao, cliente } = criarSessaoECliente();
  const router = criarRouter({
    queryClient,
    sessao,
    cliente,
    history: createMemoryHistory({ initialEntries: [caminho] }),
  });
  return { router, queryClient, sessao, ...render(<RouterProvider router={router} />) };
}
