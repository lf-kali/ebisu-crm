import type { Negocio } from '@ebisu/contracts';
import { Prisma } from '@ebisu/db';

// Acesso a `negocio`, `historico_etapa_negocio` e às tarefas criadas pelo funil (plano
// docs/planos/f4-2a-funil-negocios-tarefas.md). Sempre pela empresa do contexto, sob o RLS da
// conta; excluídos (deleted_at) não aparecem. A completude é gravada só pelo serviço de completude.

const CAMPOS = {
  id: true,
  empresa_id: true,
  contato_id: true,
  funil_id: true,
  etapa_id: true,
  titulo: true,
  interesse: true,
  tipo_dispositivo: true,
  dispositivo_id: true,
  descricao_problema: true,
  urgencia: true,
  valor_estimado: true,
  previsao_fechamento: true,
  status: true,
  motivo_perda_id: true,
  responsavel_id: true,
  entrou_etapa_em: true,
  fechado_em: true,
  completude: true,
  nba_adiada_ate: true,
  versao_registro: true,
  created_at: true,
  updated_at: true,
} as const satisfies Prisma.NegocioSelect;

type Linha = Prisma.NegocioGetPayload<{ select: typeof CAMPOS }>;

const VISIVEL = { deleted_at: null };

const iso = (data: Date | null) => data?.toISOString() ?? null;

export const paraContrato = (linha: Linha): Negocio => ({
  ...linha,
  valor_estimado: linha.valor_estimado?.toFixed(2) ?? null,
  previsao_fechamento: linha.previsao_fechamento?.toISOString().slice(0, 10) ?? null,
  entrou_etapa_em: linha.entrou_etapa_em.toISOString(),
  fechado_em: iso(linha.fechado_em),
  nba_adiada_ate: iso(linha.nba_adiada_ate),
  created_at: linha.created_at.toISOString(),
  updated_at: linha.updated_at.toISOString(),
});

/** Campos editáveis, já na forma do banco. */
export type DadosNegocio = Partial<
  Pick<
    Prisma.NegocioUncheckedUpdateInput,
    | 'titulo'
    | 'interesse'
    | 'tipo_dispositivo'
    | 'dispositivo_id'
    | 'descricao_problema'
    | 'urgencia'
    | 'valor_estimado'
    | 'previsao_fechamento'
    | 'responsavel_id'
  >
>;

/** `%`, `_` e `\` são curingas do LIKE: na busca, valem como texto. */
const literal = (texto: string) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface FiltrosNegocio {
  q?: string;
  etapa_id?: string;
  status?: Negocio['status'];
  responsavel_id?: string;
  contato_id?: string;
}

/** Uma página, do mais recente ao mais antigo (ids UUID v7 em ordem de criação). */
export async function listarNegocios(
  tx: Prisma.TransactionClient,
  empresaId: string,
  escopo: Prisma.NegocioWhereInput,
  { limite, antesDe, filtros }: { limite: number; antesDe?: string; filtros: FiltrosNegocio },
) {
  const { q, ...iguais } = filtros;
  const linhas = await tx.negocio.findMany({
    where: {
      empresa_id: empresaId,
      ...VISIVEL,
      // Em AND: o filtro do cliente não substitui o escopo PROPRIO, que vem do servidor (SEG-4).
      AND: [
        escopo,
        Object.fromEntries(Object.entries(iguais).filter(([, v]) => v !== undefined)),
        q ? { titulo: { contains: literal(q.trim()), mode: 'insensitive' } } : {},
      ],
      ...(antesDe ? { id: { lt: antesDe } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limite + 1,
    select: CAMPOS,
  });
  return { negocios: linhas.slice(0, limite).map(paraContrato), haMais: linhas.length > limite };
}

export async function buscarNegocio(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.NegocioWhereInput = {},
) {
  const linha = await tx.negocio.findFirst({
    where: { id, empresa_id: empresaId, ...VISIVEL, ...escopo },
    select: CAMPOS,
  });
  return linha ? paraContrato(linha) : null;
}

/** Etapas do funil padrão, em ordem, com os requisitos TAREFA (para criar as tarefas). */
export const etapasDoFunil = (tx: Prisma.TransactionClient, empresaId: string) =>
  tx.etapaFunil.findMany({
    where: { funil: { empresa_id: empresaId, padrao: true } },
    orderBy: { ordem: 'asc' },
    select: {
      id: true,
      funil_id: true,
      nome: true,
      ordem: true,
      tipo: true,
      requisitos: {
        where: { tipo: 'TAREFA' },
        orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
        select: { id: true, titulo_tarefa: true, descricao: true },
      },
    },
  });
export type EtapaDoFunil = Awaited<ReturnType<typeof etapasDoFunil>>[number];

export async function criarNegocio(
  tx: Prisma.TransactionClient,
  dados: DadosNegocio & {
    tenant_id: string;
    empresa_id: string;
    contato_id: string;
    funil_id: string;
    etapa_id: string;
    titulo: string;
    completude: number;
  },
) {
  return paraContrato(
    await tx.negocio.create({ data: dados as Prisma.NegocioUncheckedCreateInput, select: CAMPOS }),
  );
}

/**
 * Grava só se a versão ainda é a lida (D-A08) e a incrementa. Devolve false se outro pedido mudou
 * o negócio no meio do caminho.
 */
export async function gravarComVersao(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  versao: number,
  dados: Prisma.NegocioUncheckedUpdateManyInput,
) {
  const { count } = await tx.negocio.updateMany({
    where: { id, empresa_id: empresaId, ...VISIVEL, versao_registro: versao },
    data: { ...dados, versao_registro: { increment: 1 } },
  });
  return count > 0;
}

export const registrarHistorico = (
  tx: Prisma.TransactionClient,
  dados: {
    negocio_id: string;
    de_etapa_id: string | null;
    para_etapa_id: string;
    membro_id: string | null;
    segundos_na_etapa: number | null;
  },
) => tx.historicoEtapaNegocio.create({ data: dados, select: { id: true } });

/**
 * Cria as tarefas dos requisitos TAREFA da etapa, sem repetir uma do mesmo requisito que já esteja
 * pendente, em andamento ou concluída neste negócio (decisão 5).
 */
export async function criarTarefasDaEtapa(
  tx: Prisma.TransactionClient,
  negocio: Pick<Negocio, 'id' | 'empresa_id' | 'contato_id' | 'responsavel_id'> & {
    tenant_id: string;
  },
  requisitos: EtapaDoFunil['requisitos'],
) {
  if (requisitos.length === 0) return;
  const existentes = await tx.tarefa.findMany({
    where: {
      negocio_id: negocio.id,
      requisito_id: { in: requisitos.map((r) => r.id) },
      status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA'] },
    },
    select: { requisito_id: true },
  });
  const ja = new Set(existentes.map((t) => t.requisito_id));
  const novas = requisitos.filter((r) => !ja.has(r.id));
  if (novas.length === 0) return;
  await tx.tarefa.createMany({
    data: novas.map((r) => ({
      tenant_id: negocio.tenant_id,
      empresa_id: negocio.empresa_id,
      contato_id: negocio.contato_id,
      negocio_id: negocio.id,
      titulo: r.titulo_tarefa ?? r.descricao,
      origem: 'REQUISITO_ETAPA' as const,
      requisito_id: r.id,
      responsavel_id: negocio.responsavel_id,
    })),
  });
}

/** Cancela as tarefas abertas do negócio (todas, ou só as de requisito). */
export const cancelarTarefas = (
  tx: Prisma.TransactionClient,
  negocioId: string,
  { soDeRequisito = false }: { soDeRequisito?: boolean } = {},
) =>
  tx.tarefa.updateMany({
    where: {
      negocio_id: negocioId,
      status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
      ...(soDeRequisito ? { origem: 'REQUISITO_ETAPA' as const } : {}),
    },
    data: { status: 'CANCELADA' },
  });

/** Contato não excluído da empresa, dentro do escopo de leitura de contatos de quem age. */
export const contatoVisivel = (
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.ContatoWhereInput,
) =>
  tx.contato.findFirst({
    where: { id, empresa_id: empresaId, deleted_at: null, ...escopo },
    select: { id: true, ciclo_vida: true },
  });

/** CRM-2, primeiro passo: LEAD vira LEAD_QUALIFICADO (decisão 6). */
export const qualificarContato = (tx: Prisma.TransactionClient, empresaId: string, id: string) =>
  tx.contato.updateMany({
    where: { id, empresa_id: empresaId, ciclo_vida: 'LEAD' },
    data: { ciclo_vida: 'LEAD_QUALIFICADO' },
  });

export const dispositivoDaEmpresa = async (
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
) => (await tx.dispositivo.count({ where: { id, empresa_id: empresaId, deleted_at: null } })) > 0;

export const motivoAtivo = async (tx: Prisma.TransactionClient, empresaId: string, id: string) =>
  (await tx.motivoPerda.count({ where: { id, empresa_id: empresaId, ativo: true } })) > 0;

/** Soft delete; devolve false se não havia negócio visível no escopo. */
export async function excluirNegocio(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.NegocioWhereInput,
) {
  const { count } = await tx.negocio.updateMany({
    where: { id, empresa_id: empresaId, ...VISIVEL, ...escopo },
    data: { deleted_at: new Date() },
  });
  return count > 0;
}

/** Valor em reais (string do contrato) para o Decimal do banco. */
export const decimal = (valor: string | null) =>
  valor === null ? null : new Prisma.Decimal(valor);
