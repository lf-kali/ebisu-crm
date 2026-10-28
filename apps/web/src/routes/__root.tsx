import { EstadoVazio } from '@ebisu/ui/components/estados';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import { ErroDaApi } from '../componentes/erro-da-api';
import { AppShell } from '../layout/app-shell';

function Layout() {
  const caminhoAtual = useRouterState({ select: (estado) => estado.location.pathname });
  return (
    <AppShell caminhoAtual={caminhoAtual}>
      <Outlet />
    </AppShell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Layout,
  notFoundComponent: () => (
    <EstadoVazio titulo="Página não encontrada" descricao="Confira o endereço ou use o menu." />
  ),
  errorComponent: ({ error }) => <ErroDaApi erro={error} />,
});
