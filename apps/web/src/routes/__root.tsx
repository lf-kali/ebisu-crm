import { EstadoVazio } from '@ebisu/ui/components/estados';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { ErroDaApi } from '../componentes/erro-da-api';
import type { ContextoRoteador } from '../router';

// Raiz sem layout: as telas de entrada (login, escolha de conta) ficam fora do AppShell; as
// páginas protegidas ficam sob o layout `_app`, que exige sessão.
export const Route = createRootRouteWithContext<ContextoRoteador>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="p-6">
      <EstadoVazio titulo="Página não encontrada" descricao="Confira o endereço." />
    </main>
  ),
  errorComponent: ({ error }) => (
    <main className="p-6">
      <ErroDaApi erro={error} />
    </main>
  ),
});
