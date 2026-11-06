import type { Etapa, Negocio } from '@ebisu/contracts';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useAcesso } from '../auth/acesso';
import { consultaContato, consultaResponsaveis } from '../contatos/consultas';
import { formatarDinheiro, tempoDesde } from './formatacao';
import { MoverNegocio } from './mover';

// Cartão do quadro (plano docs/planos/f4-web-2-negocios.md, decisão 2): título (link para a ficha),
// contato, valor, responsável, tempo na etapa, completude e o "Mover para…".

const rotaApp = getRouteApi('/_app');

/** Nome do contato; sem acesso a ele (PROPRIO de outra pessoa), só "Contato". */
export function NomeDoContato({ contatoId }: { contatoId: string }) {
  const { cliente } = rotaApp.useRouteContext();
  const contato = useQuery({ ...consultaContato(cliente, contatoId), retry: false });
  return <>{contato.data?.nome ?? 'Contato'}</>;
}

export function BarraCompletude({ valor }: { valor: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${valor}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{valor}% completo</span>
    </div>
  );
}

export function CartaoNegocio({ negocio, etapas }: { negocio: Negocio; etapas: readonly Etapa[] }) {
  const { cliente } = rotaApp.useRouteContext();
  const { pode } = useAcesso();
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const responsavel = responsaveis.data?.dados.find((r) => r.id === negocio.responsavel_id);
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs">
      <Link
        to="/negocios/$id"
        params={{ id: negocio.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {negocio.titulo}
      </Link>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">Contato</dt>
        <dd>
          <NomeDoContato contatoId={negocio.contato_id} />
        </dd>
        <dt className="text-muted-foreground">Valor</dt>
        <dd className="tabular-nums">{formatarDinheiro(negocio.valor_estimado)}</dd>
        <dt className="text-muted-foreground">Responsável</dt>
        <dd>{responsavel?.nome ?? '—'}</dd>
        <dt className="text-muted-foreground">Na etapa</dt>
        <dd>{tempoDesde(negocio.entrou_etapa_em)}</dd>
      </dl>
      <BarraCompletude valor={negocio.completude} />
      {pode('negocio.update') ? <MoverNegocio negocio={negocio} etapas={etapas} /> : null}
    </li>
  );
}
