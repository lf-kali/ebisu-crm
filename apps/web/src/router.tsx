import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { ErroApi } from './api/erro-api';
import { routeTree } from './routeTree.gen';

/** Repete só falha de rede e erro do servidor; erro do cliente (4xx) não melhora repetindo. */
export function criarQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (tentativas, erro) =>
          tentativas < 2 && (!(erro instanceof ErroApi) || erro.status === 0 || erro.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}

export function criarRouter(opcoes: { queryClient?: QueryClient; history?: RouterHistory } = {}) {
  const queryClient = opcoes.queryClient ?? criarQueryClient();
  return createRouter({
    routeTree,
    history: opcoes.history,
    context: { queryClient },
    // O TanStack Query cuida do cache; o roteador não guarda dados por conta própria.
    defaultPreloadStaleTime: 0,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof criarRouter>;
  }
}
