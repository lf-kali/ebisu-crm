import { Cnpj, EntradaEmpresa, EntradaRegistro } from '@ebisu/contracts';
import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import { Button } from '@ebisu/ui/components/ui/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErroApi } from '../api/erro-api';
import { ErroDaApi } from '../componentes/erro-da-api';
import { LimiteExcedido, REGRA_SENHA } from '../componentes/entrada';
import { TelaDeEntrada } from '../componentes/tela-de-entrada';
import { aplicarErrosDaApi, Campo } from '../formularios/campo';

// Cadastro (plano docs/planos/f3-web-1-cadastro-convite.md, decisões 1 e 2): cria a conta, a
// primeira empresa e o dono, e já entra, como o login.

/** CNPJ opcional: campo vazio não vai para a API. */
const Formulario = EntradaRegistro.extend({
  empresa: EntradaEmpresa.extend({
    cnpj: z
      .string()
      .trim()
      .transform((valor) => valor || undefined)
      .pipe(Cnpj.optional()),
  }),
});
type Entrada = z.input<typeof Formulario>;
type Saida = z.output<typeof Formulario>;

const CAMPOS = [
  'nome',
  'email',
  'senha',
  'conta.nome',
  'empresa.razao_social',
  'empresa.nome_fantasia',
  'empresa.cnpj',
] as const;

export const Route = createFileRoute('/cadastro')({
  beforeLoad: async ({ context }) => {
    // Já logado: vai para o Painel. Falha de rede aqui não impede o cadastro.
    const sessao = await context.sessao.garantir().catch(() => null);
    if (sessao) throw redirect({ to: '/' });
  },
  component: Cadastro,
});

function Cadastro() {
  const { sessao, queryClient, empresa } = Route.useRouteContext();
  const navigate = useNavigate();
  const [erro, setErro] = useState<unknown>(null);
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(Formulario),
    defaultValues: {
      nome: '',
      email: '',
      senha: '',
      conta: { nome: '' },
      empresa: { razao_social: '', nome_fantasia: '', cnpj: '' },
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function enviar(dados: Saida) {
    setErro(null);
    try {
      // Como no login: nada de uma sessão anterior desta aba aparece para a conta nova.
      queryClient.clear();
      empresa.limpar();
      await sessao.registrar(dados);
      await navigate({ to: '/' });
    } catch (e) {
      if (!aplicarErrosDaApi(e, form.setError, CAMPOS)) setErro(e);
    }
  }

  return (
    <TelaDeEntrada titulo="Criar conta" descricao="Cadastre sua empresa e comece a usar.">
      <form noValidate onSubmit={form.handleSubmit(enviar)} className="flex flex-col gap-6">
        <ErroDoCadastro erro={erro} />
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Você</legend>
          <Campo
            rotulo="Seu nome"
            autoComplete="name"
            autoFocus
            erro={errors.nome?.message}
            {...form.register('nome')}
          />
          <Campo
            rotulo="E-mail"
            type="email"
            autoComplete="email"
            erro={errors.email?.message}
            {...form.register('email')}
          />
          <Campo
            rotulo="Senha"
            type="password"
            autoComplete="new-password"
            dica={REGRA_SENHA}
            erro={errors.senha?.message}
            {...form.register('senha')}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Sua empresa</legend>
          <Campo
            rotulo="Nome da conta"
            dica="Como sua empresa aparece para a equipe. Dá para ter várias lojas na mesma conta."
            erro={errors.conta?.nome?.message}
            {...form.register('conta.nome')}
          />
          <Campo
            rotulo="Razão social"
            autoComplete="organization"
            erro={errors.empresa?.razao_social?.message}
            {...form.register('empresa.razao_social')}
          />
          <Campo
            rotulo="Nome fantasia"
            erro={errors.empresa?.nome_fantasia?.message}
            {...form.register('empresa.nome_fantasia')}
          />
          <Campo
            rotulo="CNPJ (opcional)"
            inputMode="text"
            erro={errors.empresa?.cnpj?.message}
            {...form.register('empresa.cnpj')}
          />
        </fieldset>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Criando…' : 'Criar conta'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </TelaDeEntrada>
  );
}

function ErroDoCadastro({ erro }: { erro: unknown }) {
  if (!erro) return null;
  if (erro instanceof ErroApi && erro.status === 401)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Este e-mail já tem cadastro. Use a senha dele para criar outra conta, ou{' '}
          <Link to="/login" className="font-medium underline underline-offset-4">
            entre
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  if (erro instanceof ErroApi && erro.status === 429) return <LimiteExcedido erro={erro} />;
  return <ErroDaApi erro={erro} />;
}
