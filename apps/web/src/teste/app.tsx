import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { criarQueryClient, criarRouter } from '../router';

/** Monta o app inteiro (roteador + TanStack Query) num caminho, sem navegador. */
export function renderizarApp(caminho = '/') {
  const queryClient = criarQueryClient();
  // Mesma política de repetição do app, sem a espera entre tentativas.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  });
  const router = criarRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [caminho] }),
  });
  return { router, queryClient, ...render(<RouterProvider router={router} />) };
}
