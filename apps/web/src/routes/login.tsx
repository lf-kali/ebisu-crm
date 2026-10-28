import { EntradaLogin } from '@ebisu/contracts';
import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import { Button } from '@ebisu/ui/components/ui/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErroApi } from '../api/erro-api';
import { destinoSeguro } from '../auth/destino';
import { ErroDaApi } from '../componentes/erro-da-api';
import { TelaDeEntrada } from '../componentes/tela-de-entrada';
import { aplicarErrosDaApi, Campo } from '../formularios/campo';

export interface BuscaEntrada {
  redirect?: string;
}

export const validarBuscaEntrada = (busca: Record<string, unknown>): BuscaEntrada =>
  typeof busca.redirect === 'string' ? { redirect: busca.redirect } : {};

export const Route = createFileRoute('/login')({
  validateSearch: validarBuscaEntrada,
  beforeLoad: async ({ context, search }) => {
    // Já logado (ex.: F5 na tela de login): segue direto. Falha de rede aqui não impede o login.
    const sessao = await context.sessao.garantir().catch(() => null);
    if (sessao) throw redirect({ href: destinoSeguro(search.redirect) });
  },
  component: Login,
});

function Login() {
  const { sessao, queryClient } = Route.useRouteContext();
  const { redirect: destino } = Route.useSearch();
  const navigate = useNavigate();
  const [erro, setErro] = useState<unknown>(null);
  const form = useForm<EntradaLogin>({
    resolver: zodResolver(EntradaLogin),
    defaultValues: { email: '', senha: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function enviar(dados: EntradaLogin) {
    setErro(null);
    try {
      // Dados de outra sessão não podem aparecer para quem entra: limpa antes de a sessão nova
      // existir, sem janela em que ela conviva com o cache anterior.
      queryClient.clear();
      const nova = await sessao.entrar(dados);
      if (nova.contas.length > 1)
        await navigate({ to: '/escolher-conta', search: { redirect: destino } });
      else await navigate({ href: destinoSeguro(destino) });
    } catch (e) {
      if (!aplicarErrosDaApi(e, form.setError, ['email', 'senha'])) setErro(e);
    }
  }

  return (
    <TelaDeEntrada titulo="Entrar" descricao="Use o e-mail e a senha da sua conta.">
      <form noValidate onSubmit={form.handleSubmit(enviar)} className="flex flex-col gap-4">
        {erro instanceof ErroApi && erro.status === 401 ? (
          <Alert variant="destructive">
            <AlertDescription>E-mail ou senha incorretos.</AlertDescription>
          </Alert>
        ) : erro ? (
          <ErroDaApi erro={erro} />
        ) : null}
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          autoFocus
          erro={errors.email?.message}
          {...form.register('email')}
        />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          erro={errors.senha?.message}
          {...form.register('senha')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </TelaDeEntrada>
  );
}
