import { CicloVida, type Contato, ListaContatos, ROTAS_CONTATOS, Uuid } from '@ebisu/contracts';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAcesso } from '../../../auth/acesso';
import { type Coluna, TabelaCursor, usePaginacaoCursor } from '../../../componentes/tabela-cursor';
import { CHAVE_CONTATOS, consultaOrigens, consultaResponsaveis } from '../../../contatos/consultas';
import { CICLO_VIDA, telefonePrincipal } from '../../../contatos/formatacao';
import { CabecalhoContatos } from '../../../contatos/pagina';
import { Campo } from '../../../formularios/campo';
import { Selecao } from '../../../formularios/selecao';

// Lista de contatos (plano docs/planos/f4-web-1-contatos.md, decisões 1 e 2). Busca e filtros na
// URL: dá para voltar, recarregar e compartilhar a lista filtrada.

export interface BuscaContatos {
  q?: string;
  origem?: string;
  responsavel?: string;
  ciclo?: CicloVida;
}

/** Só o que a API aceita; o resto da URL é ignorado. O roteador lê "123" como número. */
export function validarBuscaContatos(busca: Record<string, unknown>): BuscaContatos {
  const q =
    typeof busca.q === 'string' || typeof busca.q === 'number' ? String(busca.q).trim() : '';
  const uuid = (valor: unknown) => (Uuid.safeParse(valor).success ? (valor as string) : undefined);
  const ciclo = CicloVida.safeParse(busca.ciclo);
  const resultado: BuscaContatos = {
    q: q.length >= 2 ? q.slice(0, 100) : undefined,
    origem: uuid(busca.origem),
    responsavel: uuid(busca.responsavel),
    ciclo: ciclo.success ? ciclo.data : undefined,
  };
  return Object.fromEntries(
    Object.entries(resultado).filter(([, v]) => v !== undefined),
  ) as BuscaContatos;
}

export const Route = createFileRoute('/_app/contatos/')({
  validateSearch: validarBuscaContatos,
  component: Contatos,
});

/** Espera depois da digitação antes de consultar (decisão 2). */
const ESPERA_BUSCA_MS = 300;

function Contatos() {
  const { cliente } = Route.useRouteContext();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const { pode } = useAcesso();
  const origens = useQuery(consultaOrigens(cliente));
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const filtrar = (mudanca: Partial<BuscaContatos>) =>
    void navigate({
      search: (atual) => validarBuscaContatos({ ...atual, ...mudanca }),
      replace: true,
    });

  const paginacao = usePaginacaoCursor({
    chave: [...CHAVE_CONTATOS, 'lista'],
    filtros: busca,
    buscar: ({ filtros, cursor, limit, signal }) =>
      cliente.get(ROTAS_CONTATOS.contatos, {
        resposta: ListaContatos,
        query: {
          cursor,
          limit,
          q: filtros.q,
          'filtro[origem_id]': filtros.origem,
          'filtro[responsavel_id]': filtros.responsavel,
          'filtro[ciclo_vida]': filtros.ciclo,
        },
        sinal: signal,
      }),
  });

  const nomeDaOrigem = new Map(origens.data?.dados.map((o) => [o.id, o.nome]));
  const nomeDoResponsavel = new Map(responsaveis.data?.dados.map((r) => [r.id, r.nome]));
  const colunas: Coluna<Contato>[] = [
    {
      id: 'nome',
      cabecalho: 'Nome',
      celula: (k) => (
        <Link
          to="/contatos/$id"
          params={{ id: k.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {k.nome}
        </Link>
      ),
    },
    { id: 'email', cabecalho: 'E-mail', celula: (k) => k.email ?? '—' },
    {
      id: 'telefone',
      cabecalho: 'Telefone',
      celula: (k) => <span className="tabular-nums">{telefonePrincipal(k)}</span>,
    },
    {
      id: 'origem',
      cabecalho: 'Origem',
      celula: (k) => (k.origem_id ? (nomeDaOrigem.get(k.origem_id) ?? '—') : '—'),
    },
    {
      id: 'responsavel',
      cabecalho: 'Responsável',
      celula: (k) => (k.responsavel_id ? (nomeDoResponsavel.get(k.responsavel_id) ?? '—') : '—'),
    },
    {
      id: 'ciclo',
      cabecalho: 'Ciclo de vida',
      celula: (k) => <Badge variant="secondary">{CICLO_VIDA[k.ciclo_vida]}</Badge>,
    },
  ];
  const filtrado = Object.keys(busca).length > 0;

  return (
    <>
      <CabecalhoContatos
        titulo="Contatos"
        descricao="Leads e clientes da empresa."
        acoes={
          pode('contato.create') ? (
            <Button asChild>
              <Link to="/contatos/novo">Novo contato</Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CampoBusca inicial={busca.q ?? ''} />
        <Selecao
          rotulo="Origem"
          value={busca.origem ?? ''}
          onChange={(e) => filtrar({ origem: e.target.value || undefined })}
        >
          <option value="">Todas</option>
          {origens.data?.dados.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </Selecao>
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
        <Selecao
          rotulo="Ciclo de vida"
          value={busca.ciclo ?? ''}
          onChange={(e) => filtrar({ ciclo: (e.target.value || undefined) as CicloVida })}
        >
          <option value="">Todos</option>
          {CicloVida.options.map((ciclo) => (
            <option key={ciclo} value={ciclo}>
              {CICLO_VIDA[ciclo]}
            </option>
          ))}
        </Selecao>
      </div>
      <TabelaCursor
        paginacao={paginacao}
        colunas={colunas}
        rotulo="Contatos da empresa"
        chaveLinha={(k) => k.id}
        vazio={
          filtrado
            ? {
                titulo: 'Nenhum contato encontrado',
                descricao: 'Mude a busca ou limpe os filtros.',
              }
            : { titulo: 'Nenhum contato ainda', descricao: 'Cadastre o primeiro contato.' }
        }
      />
    </>
  );
}

/** Busca com espera: só consulta com 2 caracteres ou mais (o mínimo do contrato). */
function CampoBusca({ inicial }: { inicial: string }) {
  const navigate = Route.useNavigate();
  const [texto, setTexto] = useState(inicial);
  useEffect(() => {
    const q = texto.trim().length >= 2 ? texto.trim() : undefined;
    if (q === (inicial || undefined)) return;
    const espera = setTimeout(
      () =>
        void navigate({
          search: (atual) => validarBuscaContatos({ ...atual, q }),
          replace: true,
        }),
      ESPERA_BUSCA_MS,
    );
    return () => clearTimeout(espera);
  }, [texto, inicial, navigate]);
  return (
    <Campo
      rotulo="Buscar"
      type="search"
      placeholder="Nome, e-mail ou telefone"
      dica="Ao menos 2 caracteres."
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
    />
  );
}
