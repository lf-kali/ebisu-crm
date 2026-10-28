import { EstadoVazio } from '@ebisu/ui/components/estados';
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import { ErroApi } from '../api/erro-api';
import { consultaEu } from '../auth/consultas';
import { ErroDaApi } from '../componentes/erro-da-api';
import { AppShell } from '../layout/app-shell';
import { MenuUsuario } from '../layout/menu-usuario';

// Layout das páginas protegidas: sem sessão, vai para o login e volta para cá depois.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const sessao = await context.sessao.garantir();
    if (!sessao) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: async ({ context, location }) => {
    try {
      return await context.queryClient.ensureQueryData(consultaEu(context.cliente));
    } catch (erro) {
      // A sessão caiu entre o beforeLoad e o loader (401 e refresh recusado): login, não erro.
      if (erro instanceof ErroApi && erro.status === 401)
        throw redirect({ to: '/login', search: { redirect: location.href } });
      throw erro;
    }
  },
  component: LayoutApp,
  notFoundComponent: () => (
    <EstadoVazio titulo="Página não encontrada" descricao="Confira o endereço ou use o menu." />
  ),
  errorComponent: ({ error }) => (
    <main className="p-6">
      <ErroDaApi erro={error} />
    </main>
  ),
});

function LayoutApp() {
  const { sessao, queryClient } = Route.useRouteContext();
  const router = useRouter();
  const atual = useSyncExternalStore(sessao.assinar, sessao.obter);
  const caminhoAtual = useRouterState({ select: (estado) => estado.location.pathname });

  // A sessão caiu (sair, refresh recusado): vai uma vez para o login, que volta para cá depois.
  // Reage à mudança da sessão, não a cada render: um <Navigate> no render repetia a navegação
  // e aninhava o ?redirect= sem fim.
  useEffect(
    () =>
      sessao.assinar(() => {
        if (sessao.obter()) return;
        const { href } = router.state.location;
        void router
          .navigate({ to: '/login', search: { redirect: href }, replace: true })
          // Dados da sessão encerrada não podem sobrar para o próximo login.
          .then(() => queryClient.clear());
      }),
    [sessao, router, queryClient],
  );

  if (!atual) return null;
  return (
    <AppShell caminhoAtual={caminhoAtual} cabecalho={<MenuUsuario />}>
      <Outlet />
    </AppShell>
  );
}
