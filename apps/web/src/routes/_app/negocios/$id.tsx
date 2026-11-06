import { type NegocioDetalhado, ROTAS_NEGOCIOS } from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Check, Circle } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useAcesso } from '../../../auth/acesso';
import { ErroDaApi } from '../../../componentes/erro-da-api';
import { AvisoDeErro, dataCurta } from '../../../configuracoes/aviso';
import { Confirmar } from '../../../configuracoes/confirmacao';
import { consultaResponsaveis } from '../../../contatos/consultas';
import { formatarData } from '../../../contatos/formatacao';
import { CabecalhoContatos } from '../../../contatos/pagina';
import { SecaoTarefas } from '../../../crm/tarefas';
import { SecaoTimeline } from '../../../crm/timeline';
import { BarraCompletude, NomeDoContato } from '../../../negocios/cartao';
import { atualizarCrm, consultaFunil, consultaNegocio } from '../../../negocios/consultas';
import { DialogoNegocio, DialogoNutrir, DialogoPerder } from '../../../negocios/dialogos';
import {
  formatarDinheiro,
  INTERESSE,
  STATUS,
  TIPO_DISPOSITIVO,
  tempoDesde,
  URGENCIA,
} from '../../../negocios/formatacao';
import { MoverNegocio } from '../../../negocios/mover';

// Ficha do negócio (plano docs/planos/f4-web-2-negocios.md, decisão 4): o "o que falta" da etapa,
// as ações conforme a permissão, as tarefas e a timeline. Perdido e ganho ficam só para leitura.

export const Route = createFileRoute('/_app/negocios/$id')({ component: FichaNegocio });

const VOLTAR = { link: { to: '/negocios' }, rotulo: 'Negócios' } as const;
type Dialogo = 'editar' | 'perder' | 'nutrir' | null;

function FichaNegocio() {
  const { id } = Route.useParams();
  const { cliente } = Route.useRouteContext();
  const negocio = useQuery(consultaNegocio(cliente, id));
  if (negocio.isPending) return <Carregando />;
  if (negocio.isError)
    return (
      <>
        <CabecalhoContatos titulo="Negócio" voltar={VOLTAR} />
        <ErroDaApi erro={negocio.error} />
      </>
    );
  return <Ficha negocio={negocio.data} />;
}

function Ficha({ negocio }: { negocio: NegocioDetalhado }) {
  const { cliente } = Route.useRouteContext();
  const { pode } = useAcesso();
  const funil = useQuery(consultaFunil(cliente));
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const etapa = funil.data?.etapas.find((e) => e.id === negocio.etapa_id);
  const aberto = negocio.status === 'ABERTO' || negocio.status === 'NUTRICAO';
  const responsavel = responsaveis.data?.dados.find((r) => r.id === negocio.responsavel_id);

  return (
    <>
      <CabecalhoContatos
        titulo={negocio.titulo}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{etapa?.nome ?? '…'}</Badge>
            <Badge variant="outline">{STATUS[negocio.status]}</Badge>
            <span>na etapa {tempoDesde(negocio.entrou_etapa_em)}</span>
          </span>
        }
        voltar={VOLTAR}
        acoes={
          (aberto && pode('negocio.update')) || pode('negocio.delete') ? (
            <Acoes
              negocio={negocio}
              editavel={aberto && pode('negocio.update')}
              abrir={setDialogo}
            />
          ) : null
        }
      />
      <div className="flex max-w-4xl flex-col gap-8">
        {aberto && pode('negocio.update') && funil.data ? (
          <MoverNegocio negocio={negocio} etapas={funil.data.etapas} />
        ) : null}
        <OQueFalta negocio={negocio} />
        <section aria-labelledby="titulo-dados-negocio">
          <h2 id="titulo-dados-negocio" className="mb-3 text-lg font-semibold">
            Dados
          </h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item rotulo="Contato">
              <Link
                to="/contatos/$id"
                params={{ id: negocio.contato_id }}
                className="underline underline-offset-4"
              >
                <NomeDoContato contatoId={negocio.contato_id} />
              </Link>
            </Item>
            <Item rotulo="Responsável">{responsavel?.nome ?? '—'}</Item>
            <Item rotulo="Interesse">{INTERESSE[negocio.interesse]}</Item>
            <Item rotulo="Tipo de dispositivo">
              {negocio.tipo_dispositivo ? TIPO_DISPOSITIVO[negocio.tipo_dispositivo] : '—'}
            </Item>
            <Item rotulo="Urgência">{negocio.urgencia ? URGENCIA[negocio.urgencia] : '—'}</Item>
            <Item rotulo="Valor estimado">{formatarDinheiro(negocio.valor_estimado)}</Item>
            <Item rotulo="Previsão de fechamento">{formatarData(negocio.previsao_fechamento)}</Item>
            {negocio.status === 'NUTRICAO' ? (
              <Item rotulo="Reativar em">{dataCurta(negocio.nba_adiada_ate)}</Item>
            ) : null}
            {negocio.fechado_em ? (
              <Item rotulo="Fechado em">{dataCurta(negocio.fechado_em)}</Item>
            ) : null}
            <Item rotulo="Problema ou interesse">
              <span className="whitespace-pre-line">{negocio.descricao_problema ?? '—'}</span>
            </Item>
          </dl>
        </section>
        {pode('tarefa.read') ? <SecaoTarefas vinculo={{ negocio_id: negocio.id }} /> : null}
        {pode('atividade.read') ? <SecaoTimeline vinculo={{ negocio_id: negocio.id }} /> : null}
      </div>
      {dialogo === 'editar' ? (
        <DialogoNegocio negocio={negocio} aoFechar={() => setDialogo(null)} />
      ) : null}
      {dialogo === 'perder' ? (
        <DialogoPerder negocio={negocio} aoFechar={() => setDialogo(null)} />
      ) : null}
      {dialogo === 'nutrir' ? (
        <DialogoNutrir negocio={negocio} aoFechar={() => setDialogo(null)} />
      ) : null}
    </>
  );
}

/** Editar, nutrir e perder com `negocio.update` (só aberto); excluir com `negocio.delete`. */
function Acoes({
  negocio,
  editavel,
  abrir,
}: {
  negocio: NegocioDetalhado;
  editavel: boolean;
  abrir: (d: Dialogo) => void;
}) {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pode } = useAcesso();
  const excluir = useMutation({
    mutationFn: () =>
      cliente.delete(`${ROTAS_NEGOCIOS.negocios}/${negocio.id}`, { resposta: null }),
    onSuccess: async () => {
      await navigate({ to: '/negocios' });
      await atualizarCrm(queryClient);
    },
  });
  return (
    <>
      {editavel ? (
        <>
          <Button variant="outline" onClick={() => abrir('editar')}>
            Editar
          </Button>
          {negocio.status === 'ABERTO' ? (
            <Button variant="outline" onClick={() => abrir('nutrir')}>
              Nutrir
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => abrir('perder')}>
            Perder
          </Button>
        </>
      ) : null}
      {pode('negocio.delete') ? (
        <Confirmar
          gatilho={<Button variant="ghost">Excluir</Button>}
          titulo={`Excluir ${negocio.titulo}?`}
          descricao="O negócio sai do quadro e as tarefas abertas dele são canceladas."
          confirmar="Excluir"
          aoConfirmar={() => excluir.mutate()}
        />
      ) : null}
      <AvisoDeErro erro={excluir.error} />
    </>
  );
}

/** Os requisitos da etapa atual: atendidos e pendentes (o que falta para avançar). */
function OQueFalta({ negocio }: { negocio: NegocioDetalhado }) {
  const pendentes = negocio.requisitos.filter((r) => !r.atendido);
  return (
    <section aria-labelledby="titulo-o-que-falta" className="flex flex-col gap-3">
      <h2 id="titulo-o-que-falta" className="text-lg font-semibold">
        O que falta
      </h2>
      <BarraCompletude valor={negocio.completude} />
      {negocio.requisitos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta etapa não tem requisitos.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {negocio.requisitos.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              {r.atendido ? (
                <Check className="size-4 text-primary" aria-hidden />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span>{r.descricao}</span>
              <span className="sr-only">{r.atendido ? '(feito)' : '(pendente)'}</span>
              {!r.obrigatorio ? <Badge variant="outline">opcional</Badge> : null}
              {!r.atendido && r.tipo === 'TAREFA' ? (
                <span className="text-muted-foreground">: conclua a tarefa abaixo</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {pendentes.length === 0 && negocio.requisitos.length > 0 ? (
        <p className="text-sm text-muted-foreground">Tudo pronto para avançar.</p>
      ) : null}
    </section>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
