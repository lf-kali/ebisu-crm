import { ListaNegocios, ROTAS_NEGOCIOS } from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useAcesso } from '../auth/acesso';
import { ErroDaApi } from '../componentes/erro-da-api';
import { BarraCompletude } from './cartao';
import { CHAVE_NEGOCIOS, consultaFunil } from './consultas';
import { DialogoNegocio } from './dialogos';
import { formatarDinheiro, STATUS } from './formatacao';

// Negócios na ficha do contato (plano docs/planos/f4-web-2-negocios.md, decisões 1 e 5): os dele,
// com a etapa e a completude, e "Novo negócio" com o contato já escolhido.

const rotaApp = getRouteApi('/_app');

export function NegociosDoContato({ contatoId }: { contatoId: string }) {
  const { cliente } = rotaApp.useRouteContext();
  const { pode } = useAcesso();
  const titulo = useId();
  const [criando, setCriando] = useState(false);
  const funil = useQuery(consultaFunil(cliente));
  const negocios = useQuery({
    queryKey: [...CHAVE_NEGOCIOS, 'do-contato', contatoId],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_NEGOCIOS.negocios, {
        resposta: ListaNegocios,
        query: { 'filtro[contato_id]': contatoId, limit: 50 },
        sinal: signal,
      }),
  });
  const nomeDaEtapa = (id: string) => funil.data?.etapas.find((e) => e.id === id)?.nome ?? '…';

  return (
    <section aria-labelledby={titulo} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titulo} className="text-lg font-semibold">
          Negócios
        </h2>
        {pode('negocio.create') ? (
          <Button variant="outline" size="sm" onClick={() => setCriando(true)}>
            Novo negócio
          </Button>
        ) : null}
      </div>
      {negocios.isPending ? (
        <Carregando />
      ) : negocios.isError ? (
        <ErroDaApi erro={negocios.error} />
      ) : negocios.data.dados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum negócio deste contato.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {negocios.data.dados.map((n) => (
            <li key={n.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/negocios/$id"
                  params={{ id: n.id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {n.titulo}
                </Link>
                <Badge variant="secondary">{nomeDaEtapa(n.etapa_id)}</Badge>
                {n.status !== 'ABERTO' ? <Badge variant="outline">{STATUS[n.status]}</Badge> : null}
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatarDinheiro(n.valor_estimado)}
                </span>
              </div>
              <BarraCompletude valor={n.completude} />
            </li>
          ))}
        </ul>
      )}
      {criando ? <DialogoNegocio contatoId={contatoId} aoFechar={() => setCriando(false)} /> : null}
    </section>
  );
}
