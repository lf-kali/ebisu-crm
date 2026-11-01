import { EstadoVazio } from '@ebisu/ui/components/estados';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAcesso } from '../auth/acesso';
import { podeVerSecao, type Secao } from './secoes';

/** Cabeçalho das páginas de Configurações: volta ao índice, título, descrição e ações. */
export function CabecalhoConfiguracao({
  titulo,
  descricao,
  acoes,
  voltar = { para: '/configuracoes', rotulo: 'Configurações' },
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
  voltar?: { para: '/configuracoes' | '/configuracoes/membros'; rotulo: string };
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      <Link
        to={voltar.para}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {voltar.rotulo}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          {descricao ? <p className="text-sm text-muted-foreground">{descricao}</p> : null}
        </div>
        {acoes ? <div className="flex flex-wrap gap-2">{acoes}</div> : null}
      </div>
    </header>
  );
}

/** A página só aparece para quem pode ver a seção; quem nega de fato é a API. */
export function SePodeVer({
  secao,
  children,
}: {
  secao: Pick<Secao, 'permissao' | 'daConta'>;
  children: ReactNode;
}) {
  const { escopo } = useAcesso();
  if (podeVerSecao(secao, escopo)) return children;
  return (
    <EstadoVazio
      titulo="Sem acesso a esta seção"
      descricao={
        secao.daConta
          ? 'Esta configuração vale para a conta inteira e pede um papel em todas as empresas.'
          : 'Seu papel nesta empresa não inclui esta configuração.'
      }
    />
  );
}
