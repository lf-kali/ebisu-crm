import type { Atividade } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';

// Acesso a `atividade` (plano docs/planos/f4-2b-atividades.md). Sempre pela empresa do contexto,
// sob o RLS da conta. A timeline vai da mais recente à mais antiga (`ocorreu_em`, depois o id).

const CAMPOS = {
  id: true,
  empresa_id: true,
  contato_id: true,
  negocio_id: true,
  tipo: true,
  direcao: true,
  assunto: true,
  conteudo: true,
  resultado: true,
  membro_id: true,
  ocorreu_em: true,
  registrada_em: true,
} as const satisfies Prisma.AtividadeSelect;

type Linha = Prisma.AtividadeGetPayload<{ select: typeof CAMPOS }>;

const paraContrato = (linha: Linha): Atividade => ({
  ...linha,
  ocorreu_em: linha.ocorreu_em.toISOString(),
  registrada_em: linha.registrada_em.toISOString(),
});

export interface FiltrosAtividade {
  contato_id?: string;
  negocio_id?: string;
  tipo?: Atividade['tipo'];
}

/** Posição na timeline: `ocorreu_em` e o id que desempata. */
export interface PosicaoAtividade {
  ocorreu_em: string;
  id: string;
}

function antesDe({ ocorreu_em, id }: PosicaoAtividade): Prisma.AtividadeWhereInput {
  const data = new Date(ocorreu_em);
  return { OR: [{ ocorreu_em: { lt: data } }, { ocorreu_em: data, id: { lt: id } }] };
}

export async function listarAtividades(
  tx: Prisma.TransactionClient,
  empresaId: string,
  escopo: Prisma.AtividadeWhereInput,
  { limite, apos, filtros }: { limite: number; apos?: PosicaoAtividade; filtros: FiltrosAtividade },
) {
  const linhas = await tx.atividade.findMany({
    where: {
      empresa_id: empresaId,
      // Em AND: o filtro do cliente não substitui o escopo PROPRIO (SEG-4).
      AND: [
        escopo,
        Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined)),
        apos ? antesDe(apos) : {},
      ],
    },
    orderBy: [{ ocorreu_em: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: CAMPOS,
  });
  return {
    atividades: linhas.slice(0, limite).map(paraContrato),
    haMais: linhas.length > limite,
  };
}

export async function buscarAtividade(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.AtividadeWhereInput = {},
) {
  const linha = await tx.atividade.findFirst({
    where: { id, empresa_id: empresaId, ...escopo },
    select: CAMPOS,
  });
  return linha ? paraContrato(linha) : null;
}

export async function criarAtividade(
  tx: Prisma.TransactionClient,
  dados: Prisma.AtividadeUncheckedCreateInput,
) {
  return paraContrato(await tx.atividade.create({ data: dados, select: CAMPOS }));
}

export const editarAtividade = (
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  dados: Prisma.AtividadeUncheckedUpdateManyInput,
) => tx.atividade.updateMany({ where: { id, empresa_id: empresaId }, data: dados });

export const apagarAtividade = (tx: Prisma.TransactionClient, empresaId: string, id: string) =>
  tx.atividade.deleteMany({ where: { id, empresa_id: empresaId } });

/**
 * `contato.ultima_interacao_em` é a maior `ocorreu_em` das conversas (ENTRADA ou SAIDA) com o
 * contato; a nota interna não conta (decisão 6). Recalculado a cada mudança.
 */
export async function recalcularUltimaInteracao(
  tx: Prisma.TransactionClient,
  empresaId: string,
  contatoId: string,
) {
  const { _max } = await tx.atividade.aggregate({
    where: { empresa_id: empresaId, contato_id: contatoId, direcao: { in: ['ENTRADA', 'SAIDA'] } },
    _max: { ocorreu_em: true },
  });
  await tx.contato.updateMany({
    where: { id: contatoId, empresa_id: empresaId },
    data: { ultima_interacao_em: _max.ocorreu_em },
  });
}
