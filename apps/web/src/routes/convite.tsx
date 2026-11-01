import {
  ConsultaConvite,
  type ConsultaConvite as TipoConsulta,
  EntradaTokenConvite,
  ROTAS_CONVITES,
} from '@ebisu/contracts';
import { Carregando, EstadoVazio } from '@ebisu/ui/components/estados';
import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import { Button } from '@ebisu/ui/components/ui/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { criarClienteApi } from '../api/cliente';
import { ErroApi } from '../api/erro-api';
import { ErroDaApi } from '../componentes/erro-da-api';
import { LimiteExcedido, REGRA_SENHA } from '../componentes/entrada';
import { TelaDeEntrada } from '../componentes/tela-de-entrada';
import { aplicarErrosDaApi, Campo } from '../formularios/campo';

// Aceite do convite (plano docs/planos/f3-web-1-cadastro-convite.md, decisões 3 e 4). O token
// chega no fragmento do link (`/convite#token=…`), que o navegador não manda ao servidor. A tela o
// guarda só em memória e o tira da barra de endereço na hora.

export const Route = createFileRoute('/convite')({ component: Convite });

/** Rotas públicas: sem Bearer nem X-Empresa-Id. */
const publico = criarClienteApi();

const tokenDoFragmento = (hash: string) => {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
  return EntradaTokenConvite.safeParse({ token }).success ? token : null;
};

const ehLinkInvalido = (erro: unknown) => erro instanceof ErroApi && erro.status === 410;

function Convite() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  // Lido uma vez, na abertura: depois a URL já não tem o token.
  const [token] = useState(() => tokenDoFragmento(hash));

  useEffect(() => {
    if (hash) void navigate({ to: '/convite', hash: '', replace: true });
  }, [hash, navigate]);

  const consulta = useQuery({
    queryKey: ['convite', token],
    queryFn: () =>
      publico.post(ROTAS_CONVITES.consultar, { resposta: ConsultaConvite, corpo: { token } }),
    enabled: token !== null,
    retry: false,
    gcTime: 0,
    // Uma consulta só: refazê-la gastaria o limite por IP e, se falhasse, levaria o formulário
    // preenchido (o token só existe em memória; não há como abrir de novo sem o e-mail).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!token) return <SemConvite titulo="Abra de novo o link do e-mail" />;
  // Já consultado: um erro posterior (ex.: refetch forçado) não troca o formulário pelo erro.
  if (consulta.data) return <Aceite token={token} convite={consulta.data} />;
  if (consulta.isPending)
    return (
      <TelaDeEntrada titulo="Convite">
        <Carregando titulo="Conferindo o convite…" />
      </TelaDeEntrada>
    );
  if (ehLinkInvalido(consulta.error)) return <SemConvite titulo="Este convite não vale mais" />;
  if (consulta.isError)
    return (
      <TelaDeEntrada titulo="Convite">
        <ErroDaApi erro={consulta.error} />
      </TelaDeEntrada>
    );
  return null;
}

function SemConvite({ titulo }: { titulo: string }) {
  return (
    <TelaDeEntrada titulo="Convite">
      <EstadoVazio
        titulo={titulo}
        descricao={
          titulo === 'Este convite não vale mais'
            ? 'Ele venceu, já foi usado ou foi cancelado. Peça um novo a quem convidou.'
            : 'Por segurança, o endereço do convite não fica salvo. Use o link que chegou por e-mail.'
        }
        acao={
          <Button asChild variant="outline">
            <Link to="/login">Ir para o login</Link>
          </Button>
        }
      />
    </TelaDeEntrada>
  );
}

const TEXTOS: Record<TipoConsulta['acao'], { descricao: string; rotuloSenha: string }> = {
  CRIAR_ACESSO: {
    descricao: 'Crie seu acesso para entrar.',
    rotuloSenha: 'Crie uma senha',
  },
  SENHA_ATUAL: {
    descricao: 'Você já tem acesso ao ebisuCRM. Confirme com a senha que você usa.',
    rotuloSenha: 'Sua senha',
  },
  NOVA_SENHA: {
    descricao:
      'Defina uma senha nova. Por segurança, outras sessões abertas com este e-mail serão encerradas.',
    rotuloSenha: 'Nova senha',
  },
};

function formularioDa(acao: TipoConsulta['acao']) {
  const senhaNova = z.string().min(12).max(128);
  return z.object({
    nome: acao === 'CRIAR_ACESSO' ? z.string().trim().min(1).max(120) : z.string(),
    senha: acao === 'SENHA_ATUAL' ? z.string().min(1).max(256) : senhaNova,
  });
}
type Formulario = { nome: string; senha: string };

function Aceite({ token, convite }: { token: string; convite: TipoConsulta }) {
  const { sessao, queryClient, empresa } = Route.useRouteContext();
  const navigate = useNavigate();
  const [erro, setErro] = useState<unknown>(null);
  const esquema = useMemo(() => formularioDa(convite.acao), [convite.acao]);
  const form = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: { nome: '', senha: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const textos = TEXTOS[convite.acao];

  async function enviar({ nome, senha }: Formulario) {
    setErro(null);
    try {
      queryClient.clear();
      empresa.limpar();
      await sessao.aceitarConvite({
        token,
        senha,
        ...(convite.acao === 'CRIAR_ACESSO' ? { nome } : {}),
      });
      await navigate({ to: '/' });
    } catch (e) {
      if (!aplicarErrosDaApi(e, form.setError, ['nome', 'senha'])) setErro(e);
    }
  }

  if (ehLinkInvalido(erro)) return <SemConvite titulo="Este convite não vale mais" />;
  return (
    <TelaDeEntrada titulo={`Convite de ${convite.conta.nome}`} descricao={textos.descricao}>
      <form noValidate onSubmit={form.handleSubmit(enviar)} className="flex flex-col gap-4">
        <ErroDoAceite erro={erro} />
        <p className="text-sm">
          <span className="text-muted-foreground">E-mail: </span>
          <span className="font-medium break-all">{convite.email}</span>
        </p>
        {convite.acao === 'CRIAR_ACESSO' ? (
          <Campo
            rotulo="Seu nome"
            autoComplete="name"
            autoFocus
            erro={errors.nome?.message}
            {...form.register('nome')}
          />
        ) : null}
        <Campo
          rotulo={textos.rotuloSenha}
          type="password"
          autoComplete={convite.acao === 'SENHA_ATUAL' ? 'current-password' : 'new-password'}
          autoFocus={convite.acao !== 'CRIAR_ACESSO'}
          dica={convite.acao === 'SENHA_ATUAL' ? undefined : REGRA_SENHA}
          erro={errors.senha?.message}
          {...form.register('senha')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Aceitar e entrar'}
        </Button>
      </form>
    </TelaDeEntrada>
  );
}

function ErroDoAceite({ erro }: { erro: unknown }) {
  if (!erro) return null;
  if (erro instanceof ErroApi && erro.status === 401)
    return (
      <Alert variant="destructive">
        <AlertDescription>Senha incorreta.</AlertDescription>
      </Alert>
    );
  if (erro instanceof ErroApi && erro.codigo === 'duplicado')
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Você já é membro desta conta.{' '}
          <Link to="/login" className="font-medium underline underline-offset-4">
            Entrar
          </Link>
        </AlertDescription>
      </Alert>
    );
  if (erro instanceof ErroApi && erro.status === 429) return <LimiteExcedido erro={erro} />;
  return <ErroDaApi erro={erro} />;
}
