import type { ResumoConta } from '@ebisu/contracts';
import { Button } from '@ebisu/ui/components/ui/button';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { destinoSeguro } from '../auth/destino';
import { ErroDaApi } from '../componentes/erro-da-api';
import { TelaDeEntrada } from '../componentes/tela-de-entrada';
import { validarBuscaEntrada } from './login';

export const Route = createFileRoute('/escolher-conta')({
  validateSearch: validarBuscaEntrada,
  beforeLoad: async ({ context, location }) => {
    if (!(await context.sessao.garantir()))
      throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  component: EscolherConta,
});

function EscolherConta() {
  const { sessao, queryClient, empresa } = Route.useRouteContext();
  const { redirect: destino } = Route.useSearch();
  const navigate = useNavigate();
  const atual = useSyncExternalStore(sessao.assinar, sessao.obter);

  const escolher = useMutation({
    mutationFn: async (conta: ResumoConta) => {
      if (conta.tenant_id !== sessao.obter()?.conta.tenant_id) {
        // Outra conta = outros dados: limpa antes de a sessão da conta nova existir.
        // A empresa também é da conta: o X-Empresa-Id antigo não pode ir com o token novo.
        queryClient.clear();
        empresa.limpar();
        await sessao.trocarConta(conta.tenant_id);
      }
    },
    onSuccess: () => navigate({ href: destinoSeguro(destino) }),
  });

  if (!atual) return null;
  return (
    <TelaDeEntrada titulo="Escolha a conta" descricao="Você tem acesso a mais de uma conta.">
      <div className="flex flex-col gap-3">
        {escolher.isError ? <ErroDaApi erro={escolher.error} /> : null}
        <ul className="flex flex-col gap-2">
          {atual.contas.map((conta) => {
            const daSessao = conta.tenant_id === atual.conta.tenant_id;
            return (
              <li key={conta.tenant_id}>
                <Button
                  variant="outline"
                  className="w-full justify-between px-4 has-[>svg]:px-4"
                  disabled={escolher.isPending}
                  aria-current={daSessao ? 'true' : undefined}
                  onClick={() => escolher.mutate(conta)}
                >
                  {conta.nome}
                  {daSessao ? <Check aria-label="conta atual" /> : null}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </TelaDeEntrada>
  );
}
