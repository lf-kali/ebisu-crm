import type { EdicaoEtapa, EntradaRequisito, Funil } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';

// Acesso a `funil`, `etapa_funil` e `requisito_etapa` (plano
// docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 1 e 2). Sempre o funil padrão da empresa
// do contexto (CRM-5), sob o RLS da conta.

const CAMPOS = {
  id: true,
  nome: true,
  etapas: {
    orderBy: { ordem: 'asc' },
    select: {
      id: true,
      nome: true,
      ordem: true,
      tipo: true,
      probabilidade: true,
      sla_horas: true,
      cor: true,
      requisitos: {
        orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          tipo: true,
          chave: true,
          descricao: true,
          obrigatorio: true,
          ordem: true,
          titulo_tarefa: true,
        },
      },
    },
  },
} as const satisfies Prisma.FunilSelect;

export const buscarFunil = (
  tx: Prisma.TransactionClient,
  empresaId: string,
): Promise<Funil | null> =>
  tx.funil.findFirst({ where: { empresa_id: empresaId, padrao: true }, select: CAMPOS });

export const renomearFunil = (tx: Prisma.TransactionClient, id: string, nome: string) =>
  tx.funil.update({ where: { id }, data: { nome }, select: { id: true } });

/**
 * Grava as etapas. A ordem é única por funil: primeiro todas vão para posições provisórias (acima
 * de qualquer ordem válida), depois para as definitivas, sem colidir no meio do caminho.
 */
export async function gravarEtapas(
  tx: Prisma.TransactionClient,
  funilId: string,
  etapas: readonly EdicaoEtapa[],
) {
  for (const [i, etapa] of etapas.entries())
    await tx.etapaFunil.update({
      where: { id: etapa.id, funil_id: funilId },
      data: { ordem: 1000 + i },
    });
  for (const { id, nome, ordem, probabilidade, sla_horas, cor } of etapas)
    await tx.etapaFunil.update({
      where: { id, funil_id: funilId },
      data: { nome, ordem, probabilidade, sla_horas, cor },
    });
}

/** Troca a lista de requisitos da etapa: apaga os ausentes, edita os com id, cria os novos. */
export async function trocarRequisitos(
  tx: Prisma.TransactionClient,
  etapaId: string,
  requisitos: readonly EntradaRequisito[],
) {
  const manter = requisitos.flatMap((r) => (r.id ? [r.id] : []));
  // Tarefas de um requisito apagado continuam, sem o vínculo (onDelete: SetNull).
  await tx.requisitoEtapa.deleteMany({ where: { etapa_id: etapaId, id: { notIn: manter } } });
  for (const [ordem, { id, titulo_tarefa, ...dados }] of requisitos.entries()) {
    const linha = { ...dados, ordem, titulo_tarefa: titulo_tarefa ?? null };
    if (id) await tx.requisitoEtapa.update({ where: { id, etapa_id: etapaId }, data: linha });
    else await tx.requisitoEtapa.create({ data: { ...linha, etapa_id: etapaId } });
  }
}
