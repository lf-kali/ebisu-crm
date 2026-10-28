import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { type ClienteApi, criarClienteApi } from './api/cliente';
import { ErroApi } from './api/erro-api';
import { criarSessao, type GerenciadorSessao } from './auth/sessao';
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

export interface ContextoRoteador {
  queryClient: QueryClient;
  sessao: GerenciadorSessao;
  /** Cliente autenticado: manda o Bearer da sessão e renova a sessão num 401. */
  cliente: ClienteApi;
}

/** Sessão + cliente autenticado. As rotas de auth usam um cliente sem Bearer (o refresh é por cookie). */
export function criarSessaoECliente(opcoes: { fetch?: typeof fetch } = {}) {
  const sessao = criarSessao({ cliente: criarClienteApi({ fetch: opcoes.fetch }) });
  const cliente = criarClienteApi({
    fetch: opcoes.fetch,
    cabecalhos: (): Record<string, string> => {
      const atual = sessao.obter();
      return atual ? { Authorization: `Bearer ${atual.accessToken}` } : {};
    },
    aoNaoAutenticado: async (usados) => {
      // O 401 chegou depois de outra requisição já ter renovado: só repete com o token novo.
      const atual = sessao.obter();
      if (atual && usados.Authorization !== `Bearer ${atual.accessToken}`) return true;
      return (await sessao.renovar().catch(() => null)) !== null;
    },
  });
  return { sessao, cliente };
}

export function criarRouter(opcoes: Partial<ContextoRoteador> & { history?: RouterHistory } = {}) {
  const queryClient = opcoes.queryClient ?? criarQueryClient();
  const padrao = opcoes.sessao && opcoes.cliente ? null : criarSessaoECliente();
  const contexto: ContextoRoteador = {
    queryClient,
    sessao: opcoes.sessao ?? padrao!.sessao,
    cliente: opcoes.cliente ?? padrao!.cliente,
  };
  return createRouter({
    routeTree,
    history: opcoes.history,
    context: contexto,
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
