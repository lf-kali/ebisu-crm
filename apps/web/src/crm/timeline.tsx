import {
  Atividade,
  type Atividade as TipoAtividade,
  ListaAtividades,
  ROTAS_ATIVIDADES,
  TipoAtividadeManual,
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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useAcesso } from '../auth/acesso';
import { ErroDaApi } from '../componentes/erro-da-api';
import { AvisoDeErro, dataCurta } from '../configuracoes/aviso';
import { Confirmar } from '../configuracoes/confirmacao';
import { consultaResponsaveis } from '../contatos/consultas';
import { AreaDeTexto } from '../contatos/formulario';
import { Campo } from '../formularios/campo';
import { Selecao } from '../formularios/selecao';
import { atualizarCrm, CHAVE_CRM } from '../negocios/consultas';
import { deLocal, paraLocal } from '../negocios/formatacao';
import { filtroDo, type Vinculo } from './tarefas';

// Timeline na ficha do negócio e na do contato (plano docs/planos/f4-web-2-negocios.md, decisão 7):
// da atividade mais recente à mais antiga. "Corrigir" e "Apagar" só aparecem quando a API
// permitiria; quem decide de fato é ela.

const rotaApp = getRouteApi('/_app');

export const TIPO_ATIVIDADE: Record<TipoAtividade['tipo'], string> = {
  LIGACAO: 'Ligação',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  SMS: 'SMS',
  VISITA_LOJA: 'Visita à loja',
  REUNIAO: 'Reunião',
  NOTA: 'Nota',
  NOTA_TECNICA: 'Nota técnica',
  FORMULARIO: 'Formulário',
  SISTEMA: 'Sistema',
};
const DIRECAO = { ENTRADA: 'Recebida', SAIDA: 'Feita', INTERNA: 'Interna' } as const;
const PRAZO_MS = 24 * 60 * 60 * 1000;

/** Espelha a regra da API (decisão 4 do PR 2b): PROPRIO só nas próprias e em 24 h. */
function useCorrigivel() {
  const { pode, escopo, eu } = useAcesso();
  return (a: TipoAtividade, chave: 'atividade.update' | 'atividade.delete') => {
    if (a.tipo === 'SISTEMA' || a.tipo === 'FORMULARIO' || !pode(chave)) return false;
    if (escopo(chave) !== 'PROPRIO') return true;
    const recente = Date.now() - new Date(a.registrada_em).getTime() <= PRAZO_MS;
    return a.membro_id === eu?.membro.id && recente;
  };
}

export function SecaoTimeline({ vinculo }: { vinculo: Vinculo }) {
  const { cliente } = rotaApp.useRouteContext();
  const { pode } = useAcesso();
  const titulo = useId();
  const [editando, setEditando] = useState<TipoAtividade | 'nova' | null>(null);
  const atividades = useInfiniteQuery({
    queryKey: [...CHAVE_CRM, 'atividades', vinculo],
    queryFn: ({ signal, pageParam }) =>
      cliente.get(ROTAS_ATIVIDADES.atividades, {
        resposta: ListaAtividades,
        query: { ...filtroDo(vinculo), limit: 20, cursor: pageParam },
        sinal: signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => ultima.proximo_cursor ?? undefined,
  });
  const lista = atividades.data?.pages.flatMap((p) => p.dados) ?? [];

  return (
    <section aria-labelledby={titulo} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titulo} className="text-lg font-semibold">
          Timeline
        </h2>
        {pode('atividade.create') ? (
          <Button variant="outline" size="sm" onClick={() => setEditando('nova')}>
            Registrar atividade
          </Button>
        ) : null}
      </div>
      {atividades.isPending ? (
        <Carregando />
      ) : atividades.isError ? (
        <ErroDaApi erro={atividades.error} />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
      ) : (
        <ol className="flex flex-col gap-3 border-l pl-4">
          {lista.map((a) => (
            <ItemAtividade key={a.id} atividade={a} aoCorrigir={() => setEditando(a)} />
          ))}
        </ol>
      )}
      {atividades.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={atividades.isFetchingNextPage}
          onClick={() => void atividades.fetchNextPage()}
        >
          Carregar mais
        </Button>
      ) : null}
      {editando ? (
        <DialogoAtividade
          vinculo={vinculo}
          atividade={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      ) : null}
    </section>
  );
}

function ItemAtividade({
  atividade: a,
  aoCorrigir,
}: {
  atividade: TipoAtividade;
  aoCorrigir: () => void;
}) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const corrigivel = useCorrigivel();
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const apagar = useMutation({
    mutationFn: () => cliente.delete(`${ROTAS_ATIVIDADES.atividades}/${a.id}`, { resposta: null }),
    onSuccess: () => atualizarCrm(queryClient),
  });
  const autor = responsaveis.data?.dados.find((r) => r.id === a.membro_id)?.nome;
  const rotulo = `${TIPO_ATIVIDADE[a.tipo]} de ${dataCurta(a.ocorreu_em)}`;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{TIPO_ATIVIDADE[a.tipo]}</span>
        {a.direcao !== 'INTERNA' ? <Badge variant="outline">{DIRECAO[a.direcao]}</Badge> : null}
        <span className="text-sm text-muted-foreground">
          {dataCurta(a.ocorreu_em)}
          {autor ? ` · ${autor}` : ''}
        </span>
      </div>
      {a.assunto ? <p className="font-medium">{a.assunto}</p> : null}
      {a.conteudo ? <p className="text-sm whitespace-pre-line">{a.conteudo}</p> : null}
      {a.resultado ? (
        <p className="text-sm text-muted-foreground">Resultado: {a.resultado}</p>
      ) : null}
      <div className="flex gap-2">
        {corrigivel(a, 'atividade.update') ? (
          <Button size="sm" variant="ghost" onClick={aoCorrigir}>
            Corrigir <span className="sr-only">{rotulo}</span>
          </Button>
        ) : null}
        {corrigivel(a, 'atividade.delete') ? (
          <Confirmar
            gatilho={
              <Button size="sm" variant="ghost">
                Apagar <span className="sr-only">{rotulo}</span>
              </Button>
            }
            titulo={`Apagar ${rotulo}?`}
            descricao="A atividade sai da timeline."
            confirmar="Apagar"
            aoConfirmar={() => apagar.mutate()}
          />
        ) : null}
      </div>
      <AvisoDeErro erro={apagar.error} />
    </li>
  );
}

/** Registrar (tipo, direção, textos, quando) ou corrigir (tudo menos tipo e vínculo). */
function DialogoAtividade({
  vinculo,
  atividade,
  aoFechar,
}: {
  vinculo: Vinculo;
  atividade: TipoAtividade | null;
  aoFechar: () => void;
}) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<string>(atividade?.tipo ?? 'LIGACAO');
  const [direcao, setDirecao] = useState<string>(
    atividade && atividade.direcao !== 'INTERNA' ? atividade.direcao : 'SAIDA',
  );
  const [assunto, setAssunto] = useState(atividade?.assunto ?? '');
  const [conteudo, setConteudo] = useState(atividade?.conteudo ?? '');
  const [resultado, setResultado] = useState(atividade?.resultado ?? '');
  const [quando, setQuando] = useState(() =>
    paraLocal(atividade?.ocorreu_em ?? new Date().toISOString()),
  );
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const nota = tipo === 'NOTA' || atividade?.direcao === 'INTERNA';

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    const textos = {
      assunto: assunto.trim() || null,
      conteudo: conteudo.trim() || null,
      resultado: resultado.trim() || null,
      ocorreu_em: deLocal(quando),
      ...(nota ? {} : { direcao }),
    };
    try {
      if (atividade)
        await cliente.patch(`${ROTAS_ATIVIDADES.atividades}/${atividade.id}`, {
          resposta: Atividade,
          corpo: textos,
        });
      else
        await cliente.post(ROTAS_ATIVIDADES.atividades, {
          resposta: Atividade,
          corpo: {
            ...vinculo,
            tipo,
            ...Object.fromEntries(Object.entries(textos).filter(([, v]) => v !== null)),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{atividade ? 'Corrigir atividade' : 'Registrar atividade'}</DialogTitle>
          <DialogDescription>
            {atividade
              ? 'Tipo e vínculo não mudam. Quem só vê as próprias corrige em até 24 horas.'
              : 'Conversas atualizam a última interação do contato; a nota interna não.'}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={salvar} className="flex flex-col gap-4">
          <AvisoDeErro erro={erro} />
          {atividade ? null : (
            <Selecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TipoAtividadeManual.options.map((t) => (
                <option key={t} value={t}>
                  {TIPO_ATIVIDADE[t]}
                </option>
              ))}
            </Selecao>
          )}
          {nota ? null : (
            <Selecao rotulo="Direção" value={direcao} onChange={(e) => setDirecao(e.target.value)}>
              <option value="SAIDA">Feita (saída)</option>
              <option value="ENTRADA">Recebida (entrada)</option>
            </Selecao>
          )}
          <Campo
            rotulo="Assunto (opcional)"
            value={assunto}
            onChange={(e) => setAssunto(e.target.value)}
          />
          <AreaDeTexto
            rotulo="Conteúdo (opcional)"
            value={conteudo}
            onChange={(e) => setConteudo(e.target.value)}
          />
          <Campo
            rotulo="Resultado (opcional)"
            placeholder="Ex.: atendeu, não atendeu"
            value={resultado}
            onChange={(e) => setResultado(e.target.value)}
          />
          <Campo
            rotulo="Quando"
            type="datetime-local"
            value={quando}
            onChange={(e) => setQuando(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? 'Salvando…' : atividade ? 'Salvar' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
