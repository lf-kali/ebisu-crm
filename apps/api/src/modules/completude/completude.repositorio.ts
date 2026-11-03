import type { Prisma } from '@ebisu/db';

// Leitura e escrita da completude (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisão 10).
// Único lugar que grava `negocio.completude`, `contato.completude_perfil` e
// `contato.campos_faltantes` (CRM-6). Sempre pela empresa do contexto, sob o RLS da conta.

const CAMPOS_REQUISITO = {
  id: true,
  tipo: true,
  chave: true,
  descricao: true,
  obrigatorio: true,
  ordem: true,
} as const;

/** Etapas do funil padrão, em ordem, com os requisitos. */
export const etapasDoFunilPadrao = (tx: Prisma.TransactionClient, empresaId: string) =>
  tx.etapaFunil.findMany({
    where: { funil: { empresa_id: empresaId, padrao: true } },
    orderBy: { ordem: 'asc' },
    select: {
      id: true,
      ordem: true,
      tipo: true,
      requisitos: { orderBy: [{ ordem: 'asc' }, { id: 'asc' }], select: CAMPOS_REQUISITO },
    },
  });
export type EtapaComRequisitos = Awaited<ReturnType<typeof etapasDoFunilPadrao>>[number];

const CAMPOS_CONTATO = {
  id: true,
  nome: true,
  email: true,
  telefone_e164: true,
  whatsapp_e164: true,
  documento: true,
  canal_preferido: true,
  data_nascimento: true,
  endereco: true,
  origem_id: true,
  completude_perfil: true,
  campos_faltantes: true,
  consentimentos: {
    orderBy: [{ coletado_em: 'desc' }, { id: 'desc' }],
    select: { canal: true, finalidade: true, concedido: true },
  },
} as const satisfies Prisma.ContatoSelect;

/** Contatos não excluídos da empresa, em ordem de id (lotes: `aposId`). */
export const contatos = (
  tx: Prisma.TransactionClient,
  empresaId: string,
  { ids, aposId, limite }: { ids?: string[]; aposId?: string; limite: number },
) =>
  tx.contato.findMany({
    where: {
      empresa_id: empresaId,
      deleted_at: null,
      ...(ids ? { id: { in: ids } } : {}),
      ...(aposId ? { id: { gt: aposId } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limite,
    select: CAMPOS_CONTATO,
  });
export type ContatoLido = Awaited<ReturnType<typeof contatos>>[number];

const CAMPOS_NEGOCIO = {
  id: true,
  etapa_id: true,
  tipo_dispositivo: true,
  dispositivo_id: true,
  descricao_problema: true,
  urgencia: true,
  valor_estimado: true,
  previsao_fechamento: true,
  responsavel_id: true,
  nba_adiada_ate: true,
  completude: true,
  contato: { select: CAMPOS_CONTATO },
  tarefas: {
    where: { status: 'CONCLUIDA', requisito_id: { not: null } },
    select: { requisito_id: true },
  },
} as const satisfies Prisma.NegocioSelect;

/** Negócios não excluídos da empresa, com o contato e as tarefas de requisito concluídas. */
export const negocios = (
  tx: Prisma.TransactionClient,
  empresaId: string,
  {
    ids,
    contatoId,
    abertos,
    aposId,
    limite,
  }: { ids?: string[]; contatoId?: string; abertos?: boolean; aposId?: string; limite: number },
) =>
  tx.negocio.findMany({
    where: {
      empresa_id: empresaId,
      deleted_at: null,
      ...(ids ? { id: { in: ids } } : {}),
      ...(contatoId ? { contato_id: contatoId } : {}),
      ...(abertos ? { status: { in: ['ABERTO', 'NUTRICAO'] as const } } : {}),
      ...(aposId ? { id: { gt: aposId } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limite,
    select: CAMPOS_NEGOCIO,
  });
export type NegocioLido = Awaited<ReturnType<typeof negocios>>[number];

/** Requisitos (ids) com tarefa concluída neste negócio. */
export const tarefasConcluidas = async (tx: Prisma.TransactionClient, negocioId: string) =>
  new Set(
    (
      await tx.tarefa.findMany({
        where: { negocio_id: negocioId, status: 'CONCLUIDA', requisito_id: { not: null } },
        select: { requisito_id: true },
      })
    ).map((t) => t.requisito_id!),
  );

export const gravarNegocio = (tx: Prisma.TransactionClient, id: string, completude: number) =>
  tx.negocio.update({ where: { id }, data: { completude }, select: { id: true } });

export const gravarContato = (
  tx: Prisma.TransactionClient,
  id: string,
  dados: { completude_perfil: number; campos_faltantes: string[] },
) => tx.contato.update({ where: { id }, data: dados, select: { id: true } });
