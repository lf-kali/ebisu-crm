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
import { useAcesso } from '../auth/acesso';
import { consultaEu } from '../auth/consultas';
import { ErroDaApi } from '../componentes/erro-da-api';
import { AppShell, estaAtivo } from '../layout/app-shell';
import { MenuUsuario } from '../layout/menu-usuario';
import { NAVEGACAO } from '../layout/navegacao';
import { SeletorEmpresa } from '../layout/seletor-empresa';

// Layout das páginas protegidas: sem sessão, vai para o login e volta para cá depois.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const sessao = await context.sessao.garantir();
    if (!sessao) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: async ({ context, location }) => {
    try {
      const eu = await context.queryClient.ensureQueryData(consultaEu(context.cliente));
      // Antes das páginas: os dados de domínio já saem com o X-Empresa-Id certo.
      context.empresa.resolver(eu.conta.tenant_id, eu.empresas);
      return eu;
    } catch (erro) {
      // A sessão caiu entre o beforeLoad e o loader (401 e refresh recusado): login, não erro.
      // Se o refresh falhou por rede, a sessão continua e o erro aparece como "sem conexão".
      if (erro instanceof ErroApi && erro.status === 401 && !context.sessao.obter())
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
  const { sessao, queryClient, empresa } = Route.useRouteContext();
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

  const { eu, empresas, pode } = useAcesso();
  // O /v1/eu mudou (ex.: perdeu acesso à empresa atual): escolhe de novo entre as que restam.
  useEffect(() => {
    if (eu) empresa.resolver(eu.conta.tenant_id, eu.empresas);
  }, [eu, empresa]);

  if (!atual) return null;
  // Menu e páginas por permissão da empresa atual. A URL direta de um módulo oculto mostra
  // "sem acesso" (a API negaria os dados de qualquer jeito).
  const itens = NAVEGACAO.filter((item) => !item.permissao || pode(item.permissao));
  const modulo = NAVEGACAO.find(
    (item) => item.caminho !== '/' && estaAtivo(item.caminho, caminhoAtual),
  );
  const conteudo =
    empresas.length === 0 ? (
      <EstadoVazio
        titulo="Nenhuma empresa disponível"
        descricao="Seu acesso ainda não inclui nenhuma empresa desta conta. Fale com um administrador."
      />
    ) : modulo?.permissao && !pode(modulo.permissao) ? (
      <EstadoVazio
        titulo="Sem acesso a este módulo"
        descricao="Seu papel nesta empresa não inclui este módulo. Fale com um administrador ou troque de empresa."
      />
    ) : (
      <Outlet />
    );
  return (
    <AppShell
      caminhoAtual={caminhoAtual}
      itens={itens}
      cabecalho={
        <>
          <SeletorEmpresa />
          <MenuUsuario />
        </>
      }
    >
      {conteudo}
    </AppShell>
  );
}
