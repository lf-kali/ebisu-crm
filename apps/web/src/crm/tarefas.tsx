import {
  ListaTarefas,
  Prioridade,
  ROTAS_TAREFAS,
  Tarefa,
  type Tarefa as TipoTarefa,
} from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ebisu/ui/components/ui/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useAcesso } from '../auth/acesso';
import { ErroDaApi } from '../componentes/erro-da-api';
import { AvisoDeErro, dataCurta } from '../configuracoes/aviso';
import { Confirmar } from '../configuracoes/confirmacao';
import { consultaResponsaveis } from '../contatos/consultas';
import { Campo } from '../formularios/campo';
import { Selecao } from '../formularios/selecao';
import { atualizarCrm, CHAVE_CRM } from '../negocios/consultas';
import { deLocal } from '../negocios/formatacao';

// Tarefas na ficha do negócio e na do contato (plano docs/planos/f4-web-2-negocios.md, decisão 6).
// As abertas em ordem de vencimento; concluídas e canceladas em "mostrar todas".

const rotaApp = getRouteApi('/_app');

export type Vinculo = { negocio_id: string } | { contato_id: string };

const PRIORIDADE = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' } as const;
const SITUACAO = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
} as const;
const aberta = (t: TipoTarefa) => t.status === 'PENDENTE' || t.status === 'EM_ANDAMENTO';

/** O filtro da lista para o vínculo dado. */
export const filtroDo = (vinculo: Vinculo) =>
  'negocio_id' in vinculo
    ? { 'filtro[negocio_id]': vinculo.negocio_id }
    : { 'filtro[contato_id]': vinculo.contato_id };

export function SecaoTarefas({ vinculo }: { vinculo: Vinculo }) {
  const { cliente } = rotaApp.useRouteContext();
  const { pode } = useAcesso();
  const titulo = useId();
  const [todas, setTodas] = useState(false);
  const [criando, setCriando] = useState(false);
  const tarefas = useQuery({
    queryKey: [...CHAVE_CRM, 'tarefas', vinculo],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_TAREFAS.tarefas, {
        resposta: ListaTarefas,
        query: { ...filtroDo(vinculo), limit: 100 },
        sinal: signal,
      }),
  });
  const lista = tarefas.data?.dados.filter((t) => todas || aberta(t)) ?? [];

  return (
    <section aria-labelledby={titulo} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titulo} className="text-lg font-semibold">
          Tarefas
        </h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setTodas((v) => !v)}>
            {todas ? 'Só as abertas' : 'Mostrar todas'}
          </Button>
          {pode('tarefa.create') ? (
            <Button variant="outline" size="sm" onClick={() => setCriando(true)}>
              Nova tarefa
            </Button>
          ) : null}
        </div>
      </div>
      {tarefas.isPending ? (
        <Carregando />
      ) : tarefas.isError ? (
        <ErroDaApi erro={tarefas.error} />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {todas ? 'Nenhuma tarefa.' : 'Nenhuma tarefa aberta.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {lista.map((t) => (
            <ItemTarefa key={t.id} tarefa={t} />
          ))}
        </ul>
      )}
      {criando ? <DialogoTarefa vinculo={vinculo} aoFechar={() => setCriando(false)} /> : null}
    </section>
  );
}

function ItemTarefa({ tarefa }: { tarefa: TipoTarefa }) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const { pode, escopo, eu } = useAcesso();
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const rota = `${ROTAS_TAREFAS.tarefas}/${tarefa.id}`;
  // Espelha a API: com PROPRIO, só nas tarefas de que a pessoa é a responsável.
  const podeMexer = (chave: 'tarefa.update' | 'tarefa.delete') =>
    pode(chave) && (escopo(chave) !== 'PROPRIO' || tarefa.responsavel_id === eu?.membro.id);
  const acao = useMutation({
    mutationFn: (tipo: 'iniciar' | 'concluir' | 'cancelar') =>
      tipo === 'concluir'
        ? cliente.post(`${rota}/concluir`, { resposta: Tarefa })
        : tipo === 'iniciar'
          ? cliente.patch(rota, { resposta: Tarefa, corpo: { status: 'EM_ANDAMENTO' } })
          : cliente.delete(rota, { resposta: null }),
    // Concluir uma tarefa do funil muda o "o que falta" do negócio (decisão 6).
    onSuccess: () => atualizarCrm(queryClient),
  });
  const responsavel = responsaveis.data?.dados.find((r) => r.id === tarefa.responsavel_id);

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{tarefa.titulo}</span>
        <Badge variant={aberta(tarefa) ? 'secondary' : 'outline'}>{SITUACAO[tarefa.status]}</Badge>
        {tarefa.origem === 'REQUISITO_ETAPA' ? <Badge variant="outline">Do funil</Badge> : null}
        {tarefa.prioridade !== 'NORMAL' ? (
          <Badge variant="outline">Prioridade {PRIORIDADE[tarefa.prioridade].toLowerCase()}</Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Vence: {dataCurta(tarefa.vence_em)} · Responsável: {responsavel?.nome ?? '—'}
      </p>
      {aberta(tarefa) && podeMexer('tarefa.update') ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={acao.isPending} onClick={() => acao.mutate('concluir')}>
            Concluir <span className="sr-only">{tarefa.titulo}</span>
          </Button>
          {tarefa.status === 'PENDENTE' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={acao.isPending}
              onClick={() => acao.mutate('iniciar')}
            >
              Iniciar <span className="sr-only">{tarefa.titulo}</span>
            </Button>
          ) : null}
          {podeMexer('tarefa.delete') ? (
            <Confirmar
              gatilho={
                <Button size="sm" variant="ghost">
                  Cancelar <span className="sr-only">{tarefa.titulo}</span>
                </Button>
              }
              titulo={`Cancelar ${tarefa.titulo}?`}
              descricao="A tarefa fica no histórico como cancelada."
              confirmar="Cancelar tarefa"
              aoConfirmar={() => acao.mutate('cancelar')}
            />
          ) : null}
        </div>
      ) : null}
      <AvisoDeErro erro={acao.error} />
    </li>
  );
}

function DialogoTarefa({ vinculo, aoFechar }: { vinculo: Vinculo; aoFechar: () => void }) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const { escopo } = useAcesso();
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const [titulo, setTitulo] = useState('');
  const [vence, setVence] = useState('');
  const [prioridade, setPrioridade] = useState<TipoTarefa['prioridade']>('NORMAL');
  const [responsavel, setResponsavel] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const semResponsavel = escopo('tarefa.create') === 'PROPRIO';

  async function criar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!titulo.trim()) return setErro(new Error('Informe o título.'));
    setEnviando(true);
    setErro(null);
    try {
      await cliente.post(ROTAS_TAREFAS.tarefas, {
        resposta: Tarefa,
        corpo: {
          ...vinculo,
          titulo: titulo.trim(),
          prioridade,
          ...(vence ? { vence_em: deLocal(vence) } : {}),
          ...(responsavel && !semResponsavel ? { responsavel_id: responsavel } : {}),
        },
      });
      await atualizarCrm(queryClient);
      aoFechar();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>Com prazo, ela aparece na ordem de vencimento.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={criar} className="flex flex-col gap-4">
          {erro instanceof Error && !('problema' in erro) ? (
            <p role="alert" className="text-sm text-destructive">
              {erro.message}
            </p>
          ) : (
            <AvisoDeErro erro={erro} />
          )}
          <Campo rotulo="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <Campo
            rotulo="Vence em (opcional)"
            type="datetime-local"
            value={vence}
            onChange={(e) => setVence(e.target.value)}
          />
          <Selecao
            rotulo="Prioridade"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value as TipoTarefa['prioridade'])}
          >
            {Prioridade.options.map((p) => (
              <option key={p} value={p}>
                {PRIORIDADE[p]}
              </option>
            ))}
          </Selecao>
          {semResponsavel ? null : (
            <Selecao
              rotulo="Responsável"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            >
              <option value="">Sem responsável</option>
              {responsaveis.data?.dados.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </Selecao>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? 'Salvando…' : 'Criar tarefa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
