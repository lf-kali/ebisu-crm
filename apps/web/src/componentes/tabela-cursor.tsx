import { Carregando, EstadoVazio } from '@ebisu/ui/components/estados';
import { Button } from '@ebisu/ui/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ebisu/ui/components/ui/table';
import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ErroDaApi } from './erro-da-api';

// Tabela com paginação por cursor (spec §5.1, §4 F12): a API só sabe ir para a frente
// (`proximo_cursor`); voltar usa a pilha dos cursores já visitados nesta sessão da tela.

export interface Pagina<T> {
  dados: T[];
  proximo_cursor: string | null;
}

export interface ParametrosBusca<F> {
  filtros: F;
  cursor?: string;
  limit: number;
  signal: AbortSignal;
}

export interface OpcoesPaginacao<T, F> {
  /** Prefixo da chave no cache (ex.: ['contatos']); filtros, limite e cursor entram depois. */
  chave: QueryKey;
  filtros: F;
  buscar: (parametros: ParametrosBusca<F>) => Promise<Pagina<T>>;
  limite?: number;
}

export function usePaginacaoCursor<T, F>({
  chave,
  filtros,
  buscar,
  limite = 25,
}: OpcoesPaginacao<T, F>) {
  // Filtros novos começam da primeira página: a pilha vale só para os filtros em que foi montada.
  const chaveFiltros = JSON.stringify(filtros);
  const [estado, setEstado] = useState<{ chaveFiltros: string; pilha: (string | undefined)[] }>({
    chaveFiltros,
    pilha: [undefined],
  });
  const pilha = estado.chaveFiltros === chaveFiltros ? estado.pilha : [undefined];
  const cursor = pilha.at(-1);

  const consulta = useQuery({
    queryKey: [...chave, filtros, limite, cursor ?? null],
    queryFn: ({ signal }) => buscar({ filtros, cursor, limit: limite, signal }),
    // Mantém a página anterior na tela enquanto a próxima carrega (sem piscar o "carregando").
    placeholderData: keepPreviousData,
  });

  const proximoCursor = consulta.isPlaceholderData ? null : (consulta.data?.proximo_cursor ?? null);
  return {
    consulta,
    pagina: pilha.length,
    temAnterior: pilha.length > 1,
    temProxima: proximoCursor !== null,
    proxima: () => {
      if (proximoCursor !== null) setEstado({ chaveFiltros, pilha: [...pilha, proximoCursor] });
    },
    anterior: () => {
      if (pilha.length > 1) setEstado({ chaveFiltros, pilha: pilha.slice(0, -1) });
    },
  };
}

export interface Coluna<T> {
  id: string;
  cabecalho: ReactNode;
  celula: (item: T) => ReactNode;
  className?: string;
}

interface PropsTabelaCursor<T> {
  paginacao: ReturnType<typeof usePaginacaoCursor<T, unknown>>;
  colunas: readonly Coluna<T>[];
  /** Descrição da tabela para leitores de tela (vai no <caption>). */
  rotulo: string;
  chaveLinha: (item: T) => string;
  vazio?: { titulo: string; descricao?: string; acao?: ReactNode };
}

export function TabelaCursor<T>({
  paginacao,
  colunas,
  rotulo,
  chaveLinha,
  vazio = { titulo: 'Nenhum registro encontrado' },
}: PropsTabelaCursor<T>) {
  const { consulta, pagina, temAnterior, temProxima, proxima, anterior } = paginacao;

  if (consulta.isPending) return <Carregando />;
  if (consulta.isError) {
    return (
      <ErroDaApi
        erro={consulta.error}
        acao={
          <div className="flex gap-2">
            {temAnterior ? (
              <Button variant="ghost" onClick={anterior}>
                Voltar à página anterior
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void consulta.refetch()}>
              Tentar de novo
            </Button>
          </div>
        }
      />
    );
  }
  if (consulta.data.dados.length === 0 && pagina === 1) return <EstadoVazio {...vazio} />;

  return (
    <div className="flex flex-col gap-3">
      <Table aria-busy={consulta.isFetching || undefined}>
        <TableCaption className="sr-only">{rotulo}</TableCaption>
        <TableHeader>
          <TableRow>
            {colunas.map((coluna) => (
              <TableHead key={coluna.id} scope="col" className={coluna.className}>
                {coluna.cabecalho}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {consulta.data.dados.map((item) => (
            <TableRow key={chaveLinha(item)}>
              {colunas.map((coluna) => (
                <TableCell key={coluna.id} className={coluna.className}>
                  {coluna.celula(item)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <nav aria-label="Paginação" className="flex items-center justify-end gap-2">
        <span aria-live="polite" className="mr-auto text-sm text-muted-foreground">
          Página {pagina}
        </span>
        <Button variant="outline" size="sm" disabled={!temAnterior} onClick={anterior}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={!temProxima} onClick={proxima}>
          Próxima
        </Button>
      </nav>
    </div>
  );
}
