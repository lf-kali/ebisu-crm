import type { Tarefa } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';

// Acesso a `tarefa` (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisão 9). Sempre pela
// empresa do contexto, sob o RLS da conta. Tarefa não é apagada: cancelar muda o status.

const CAMPOS = {
  id: true,
  empresa_id: true,
  contato_id: true,
  negocio_id: true,
  titulo: true,
  descricao: true,
  status: true,
  prioridade: true,
  origem: true,
  requisito_id: true,
  vence_em: true,
  responsavel_id: true,
  concluida_em: true,
  created_at: true,
  updated_at: true,
} as const satisfies Prisma.TarefaSelect;

type Linha = Prisma.TarefaGetPayload<{ select: typeof CAMPOS }>;

const paraContrato = (linha: Linha): Tarefa => ({
  ...linha,
  vence_em: linha.vence_em?.toISOString() ?? null,
  concluida_em: linha.concluida_em?.toISOString() ?? null,
  created_at: linha.created_at.toISOString(),
  updated_at: linha.updated_at.toISOString(),
});

export interface FiltrosTarefa {
  status?: Tarefa['status'];
  responsavel_id?: string;
  negocio_id?: string;
  contato_id?: string;
  vence_ate?: Date;
}

/** Posição na ordem de vencimento (sem vencimento por último), desempatada pelo id. */
export interface PosicaoTarefa {
  vence_em: string | null;
  id: string;
}

function depoisDe({ vence_em, id }: PosicaoTarefa): Prisma.TarefaWhereInput {
  if (vence_em === null) return { vence_em: null, id: { gt: id } };
  const data = new Date(vence_em);
  return {
    OR: [{ vence_em: { gt: data } }, { vence_em: data, id: { gt: id } }, { vence_em: null }],
  };
}

export async function listarTarefas(
  tx: Prisma.TransactionClient,
  empresaId: string,
  escopo: Prisma.TarefaWhereInput,
  { limite, apos, filtros }: { limite: number; apos?: PosicaoTarefa; filtros: FiltrosTarefa },
) {
  const { vence_ate, ...iguais } = filtros;
  const linhas = await tx.tarefa.findMany({
    where: {
      empresa_id: empresaId,
      // Em AND: o filtro do cliente não substitui o escopo PROPRIO (SEG-4).
      AND: [
        escopo,
        Object.fromEntries(Object.entries(iguais).filter(([, v]) => v !== undefined)),
        vence_ate ? { vence_em: { lte: vence_ate } } : {},
        apos ? depoisDe(apos) : {},
      ],
    },
    orderBy: [{ vence_em: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    take: limite + 1,
    select: CAMPOS,
  });
  return { tarefas: linhas.slice(0, limite).map(paraContrato), haMais: linhas.length > limite };
}

export async function buscarTarefa(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.TarefaWhereInput = {},
) {
  const linha = await tx.tarefa.findFirst({
    where: { id, empresa_id: empresaId, ...escopo },
    select: CAMPOS,
  });
  return linha ? paraContrato(linha) : null;
}

export async function criarTarefa(
  tx: Prisma.TransactionClient,
  dados: Prisma.TarefaUncheckedCreateInput,
) {
  return paraContrato(await tx.tarefa.create({ data: dados, select: CAMPOS }));
}

/** Só muda tarefa ainda aberta: concluída ou cancelada não muda mais (decisão 9). */
export async function editarTarefaAberta(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  dados: Prisma.TarefaUncheckedUpdateManyInput,
) {
  const { count } = await tx.tarefa.updateMany({
    where: { id, empresa_id: empresaId, status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
    data: dados,
  });
  return count > 0;
}

/** Negócio não excluído, no escopo de leitura de negócios de quem age. */
export const negocioVisivel = (
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.NegocioWhereInput,
) =>
  tx.negocio.findFirst({
    where: { id, empresa_id: empresaId, deleted_at: null, ...escopo },
    select: { id: true, contato_id: true },
  });

/** Contato não excluído, no escopo de leitura de contatos de quem age. */
export const contatoVisivel = async (
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.ContatoWhereInput,
) =>
  (await tx.contato.count({ where: { id, empresa_id: empresaId, deleted_at: null, ...escopo } })) >
  0;
