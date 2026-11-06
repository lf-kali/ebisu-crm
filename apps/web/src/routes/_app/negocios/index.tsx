import {
  type Etapa,
  ListaNegocios,
  type Negocio,
  ROTAS_NEGOCIOS,
  type StatusNegocio,
  Uuid,
} from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Button } from '@ebisu/ui/components/ui/button';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useAcesso } from '../../../auth/acesso';
import { ErroDaApi } from '../../../componentes/erro-da-api';
import { type Coluna, TabelaCursor, usePaginacaoCursor } from '../../../componentes/tabela-cursor';
import { dataCurta } from '../../../configuracoes/aviso';
import { consultaResponsaveis } from '../../../contatos/consultas';
import { CabecalhoContatos } from '../../../contatos/pagina';
import { Campo } from '../../../formularios/campo';
import { Selecao } from '../../../formularios/selecao';
import { CartaoNegocio, NomeDoContato } from '../../../negocios/cartao';
import { CHAVE_NEGOCIOS, consultaFunil } from '../../../negocios/consultas';
import { DialogoNegocio } from '../../../negocios/dialogos';
import { formatarDinheiro } from '../../../negocios/formatacao';

// Quadro de negócios (plano docs/planos/f4-web-2-negocios.md, decisões 1 e 2): uma coluna por etapa
// aberta, com "Carregar mais"; Nutrição, Perdidos e Ganhos em abas, como lista. Filtros na URL.

const ABAS = ['NUTRICAO', 'PERDIDO', 'GANHO'] as const satisfies readonly StatusNegocio[];
type Aba = (typeof ABAS)[number];
const ROTULO_ABA: Record<Aba, string> = {
  NUTRICAO: 'Nutrição',
  PERDIDO: 'Perdidos',
  GANHO: 'Ganhos',
};

export interface BuscaNegocios {
  q?: string;
  responsavel?: string;
  aba?: Aba;
}

/** Só o que a API aceita; o resto da URL é ignorado. */
export function validarBuscaNegocios(busca: Record<string, unknown>): BuscaNegocios {
  const q =
    typeof busca.q === 'string' || typeof busca.q === 'number' ? String(busca.q).trim() : '';
  const resultado: BuscaNegocios = {
    q: q.length >= 2 ? q.slice(0, 100) : undefined,
    responsavel: Uuid.safeParse(busca.responsavel).success
      ? (busca.responsavel as string)
      : undefined,
    aba: ABAS.includes(busca.aba as Aba) ? (busca.aba as Aba) : undefined,
  };
  return Object.fromEntries(
    Object.entries(resultado).filter(([, v]) => v !== undefined),
  ) as BuscaNegocios;
}

export const Route = createFileRoute('/_app/negocios/')({
  validateSearch: validarBuscaNegocios,
  component: Quadro,
});

function Quadro() {
  const { cliente } = Route.useRouteContext();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const { pode } = useAcesso();
  const funil = useQuery(consultaFunil(cliente));
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const [criando, setCriando] = useState(false);
  const filtros = { q: busca.q, responsavel: busca.responsavel };
  const filtrar = (mudanca: Partial<BuscaNegocios>) =>
    void navigate({
      search: (atual) => validarBuscaNegocios({ ...atual, ...mudanca }),
      replace: true,
    });

  return (
    <>
      <CabecalhoContatos
        titulo="Negócios"
        descricao="Os negócios abertos por etapa do funil."
        acoes={
          pode('negocio.create') && pode('contato.read') ? (
            <Button onClick={() => setCriando(true)}>Novo negócio</Button>
          ) : null
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CampoBusca inicial={busca.q ?? ''} />
        <Selecao
          rotulo="Responsável"
          value={busca.responsavel ?? ''}
          onChange={(e) => filtrar({ responsavel: e.target.value || undefined })}
        >
          <option value="">Todos</option>
          {responsaveis.data?.dados.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </Selecao>
      </div>
      {funil.isPending ? (
        <Carregando />
      ) : funil.isError ? (
        <ErroDaApi erro={funil.error} />
      ) : (
        <>
          <div className="mb-8 flex gap-4 overflow-x-auto pb-2">
            {funil.data.etapas
              .filter((e) => e.tipo === 'ABERTA')
              .map((etapa) => (
                <ColunaEtapa
                  key={etapa.id}
                  etapa={etapa}
                  etapas={funil.data.etapas}
                  filtros={filtros}
                />
              ))}
          </div>
          <Abas
            aba={busca.aba ?? 'NUTRICAO'}
            aoTrocar={(aba) => filtrar({ aba })}
            filtros={filtros}
          />
        </>
      )}
      {criando ? <DialogoNegocio aoFechar={() => setCriando(false)} /> : null}
    </>
  );
}

interface FiltrosQuadro {
  q?: string | undefined;
  responsavel?: string | undefined;
}

const queryDosFiltros = (filtros: FiltrosQuadro) => ({
  q: filtros.q,
  'filtro[responsavel_id]': filtros.responsavel,
});

function ColunaEtapa({
  etapa,
  etapas,
  filtros,
}: {
  etapa: Etapa;
  etapas: readonly Etapa[];
  filtros: FiltrosQuadro;
}) {
  const { cliente } = Route.useRouteContext();
  const titulo = useId();
  const negocios = useInfiniteQuery({
    queryKey: [...CHAVE_NEGOCIOS, 'coluna', etapa.id, filtros],
    queryFn: ({ signal, pageParam }) =>
      cliente.get(ROTAS_NEGOCIOS.negocios, {
        resposta: ListaNegocios,
        query: {
          ...queryDosFiltros(filtros),
          'filtro[etapa_id]': etapa.id,
          'filtro[status]': 'ABERTO',
          limit: 25,
          cursor: pageParam,
        },
        sinal: signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => ultima.proximo_cursor ?? undefined,
  });
  const lista = negocios.data?.pages.flatMap((p) => p.dados) ?? [];

  return (
    <section
      aria-labelledby={titulo}
      className="flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <h2 id={titulo} className="flex items-center justify-between text-sm font-semibold">
        {etapa.nome}
        {negocios.isSuccess ? (
          <span className="text-muted-foreground tabular-nums">
            {lista.length}
            {negocios.hasNextPage ? '+' : ''}
          </span>
        ) : null}
      </h2>
      {negocios.isPending ? (
        <Carregando />
      ) : negocios.isError ? (
        <ErroDaApi erro={negocios.error} />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum negócio.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((n) => (
            <CartaoNegocio key={n.id} negocio={n} etapas={etapas} />
          ))}
        </ul>
      )}
      {negocios.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={negocios.isFetchingNextPage}
          onClick={() => void negocios.fetchNextPage()}
        >
          Carregar mais <span className="sr-only">em {etapa.nome}</span>
        </Button>
      ) : null}
    </section>
  );
}

/** Nutrição, Perdidos e Ganhos: o negócio não está numa etapa aberta, então vai em lista. */
function Abas({
  aba,
  aoTrocar,
  filtros,
}: {
  aba: Aba;
  aoTrocar: (aba: Aba) => void;
  filtros: FiltrosQuadro;
}) {
  const base = useId();
  return (
    <section className="flex flex-col gap-3">
      <div role="tablist" aria-label="Negócios fora do quadro" className="flex gap-1 border-b">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            id={`${base}-${a}`}
            aria-selected={a === aba}
            aria-controls={`${base}-painel`}
            tabIndex={a === aba ? 0 : -1}
            onClick={() => aoTrocar(a)}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground aria-selected:border-primary aria-selected:text-foreground"
          >
            {ROTULO_ABA[a]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-painel`} aria-labelledby={`${base}-${aba}`}>
        <ListaPorStatus key={aba} status={aba} filtros={filtros} />
      </div>
    </section>
  );
}

function ListaPorStatus({ status, filtros }: { status: Aba; filtros: FiltrosQuadro }) {
  const { cliente } = Route.useRouteContext();
  const paginacao = usePaginacaoCursor({
    chave: [...CHAVE_NEGOCIOS, 'lista', status],
    filtros,
    buscar: ({ filtros: f, cursor, limit, signal }) =>
      cliente.get(ROTAS_NEGOCIOS.negocios, {
        resposta: ListaNegocios,
        query: { ...queryDosFiltros(f), 'filtro[status]': status, cursor, limit },
        sinal: signal,
      }),
  });
  const colunas: Coluna<Negocio>[] = [
    {
      id: 'titulo',
      cabecalho: 'Negócio',
      celula: (n) => (
        <Link
          to="/negocios/$id"
          params={{ id: n.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {n.titulo}
        </Link>
      ),
    },
    {
      id: 'contato',
      cabecalho: 'Contato',
      celula: (n) => <NomeDoContato contatoId={n.contato_id} />,
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      celula: (n) => <span className="tabular-nums">{formatarDinheiro(n.valor_estimado)}</span>,
    },
    {
      id: 'data',
      cabecalho: status === 'NUTRICAO' ? 'Reativar em' : 'Fechado em',
      celula: (n) => dataCurta(status === 'NUTRICAO' ? n.nba_adiada_ate : n.fechado_em),
    },
  ];
  return (
    <TabelaCursor
      paginacao={paginacao}
      colunas={colunas}
      rotulo={`Negócios: ${ROTULO_ABA[status]}`}
      chaveLinha={(n) => n.id}
      vazio={{ titulo: 'Nenhum negócio aqui' }}
    />
  );
}

/** Busca no título com espera: só com 2 caracteres ou mais (o mínimo do contrato). */
function CampoBusca({ inicial }: { inicial: string }) {
  const navigate = Route.useNavigate();
  const [texto, setTexto] = useState(inicial);
  useEffect(() => {
    const q = texto.trim().length >= 2 ? texto.trim() : undefined;
    if (q === (inicial || undefined)) return;
    const espera = setTimeout(
      () =>
        void navigate({ search: (atual) => validarBuscaNegocios({ ...atual, q }), replace: true }),
      300,
    );
    return () => clearTimeout(espera);
  }, [texto, inicial, navigate]);
  return (
    <Campo
      rotulo="Buscar"
      type="search"
      placeholder="Título do negócio"
      dica="Ao menos 2 caracteres."
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
    />
  );
}
