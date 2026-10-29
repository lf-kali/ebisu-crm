import type { Papel } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';

// Acesso a membro, atribuicao_papel e papel (plano docs/planos/f3-4b1-membros-papeis.md). Tudo
// pelo `tx` do comando, sob o RLS da conta: membro, papel e empresa de outra conta não aparecem.

export const PAPEL_DONO = 'OWNER';

const CAMPOS = {
  id: true,
  usuario_id: true,
  status: true,
  cargo: true,
  created_at: true,
  atribuicoes: {
    select: {
      id: true,
      empresa_id: true,
      papel: { select: { id: true, chave: true, nome: true } },
    },
    orderBy: { id: 'asc' },
  },
} as const satisfies Prisma.MembroSelect;

export type LinhaMembro = Prisma.MembroGetPayload<{ select: typeof CAMPOS }>;

/** O membro é dono: OWNER atribuído a todas as empresas. */
export const temPapelDeDono = (membro: Pick<LinhaMembro, 'atribuicoes'>) =>
  membro.atribuicoes.some((a) => a.papel.chave === PAPEL_DONO && a.empresa_id === null);

/** Uma página por id (UUID v7, em ordem de criação). */
export async function listarMembros(
  tx: Prisma.TransactionClient,
  { limite, aposId }: { limite: number; aposId?: string },
) {
  const linhas = await tx.membro.findMany({
    where: aposId ? { id: { gt: aposId } } : {},
    orderBy: { id: 'asc' },
    take: limite + 1,
    select: CAMPOS,
  });
  return { membros: linhas.slice(0, limite), haMais: linhas.length > limite };
}

export const buscarMembro = (tx: Prisma.TransactionClient, id: string) =>
  tx.membro.findUnique({ where: { id }, select: CAMPOS });

export async function editarMembro(
  tx: Prisma.TransactionClient,
  id: string,
  dados: { cargo?: string | null; status?: 'ATIVO' | 'SUSPENSO' },
) {
  await tx.membro.update({ where: { id }, data: dados });
}

/**
 * Trava os donos da conta até o fim da transação. Toda mudança de status ou de atribuições passa
 * por aqui: duas mudanças simultâneas viram fila, e a segunda já vê a primeira (a conta não fica
 * sem dono ativo).
 */
export async function travarDonos(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`donos:${tenantId}`}, 0))`;
}

/** Donos ativos da conta, sem contar `exceto`. */
export const contarDonosAtivos = (tx: Prisma.TransactionClient, exceto: string) =>
  tx.membro.count({
    where: {
      id: { not: exceto },
      status: 'ATIVO',
      atribuicoes: { some: { empresa_id: null, papel: { chave: PAPEL_DONO } } },
    },
  });

export async function ehDono(tx: Prisma.TransactionClient, membroId: string) {
  const membro = await buscarMembro(tx, membroId);
  return !!membro && membro.status === 'ATIVO' && temPapelDeDono(membro);
}

/** Os papéis da conta entre os ids pedidos (os de outra conta não aparecem). */
export const papeisDaConta = (tx: Prisma.TransactionClient, ids: string[]) =>
  tx.papel.findMany({ where: { id: { in: ids } }, select: { id: true, chave: true } });

/** As empresas ativas da conta entre os ids pedidos. */
export async function empresasAtivas(tx: Prisma.TransactionClient, ids: string[]) {
  const empresas = await tx.empresa.findMany({
    where: { id: { in: ids }, ativo: true, deleted_at: null },
    select: { id: true },
  });
  return new Set(empresas.map((e) => e.id));
}

/** Apaga as atribuições que saíram e cria as que entraram; as que ficam não mudam. */
export async function trocarAtribuicoes(
  tx: Prisma.TransactionClient,
  { tenantId, membroId }: { tenantId: string; membroId: string },
  {
    remover,
    criar,
  }: { remover: string[]; criar: Array<{ papel_id: string; empresa_id: string | null }> },
) {
  if (remover.length) await tx.atribuicaoPapel.deleteMany({ where: { id: { in: remover } } });
  if (criar.length)
    await tx.atribuicaoPapel.createMany({
      data: criar.map((a) => ({ tenant_id: tenantId, membro_id: membroId, ...a })),
    });
}

export async function listarPapeis(tx: Prisma.TransactionClient): Promise<Papel[]> {
  const papeis = await tx.papel.findMany({
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: { permissoes: { orderBy: { permissao_chave: 'asc' } } },
  });
  return papeis.map((p) => ({
    id: p.id,
    chave: p.chave,
    nome: p.nome,
    descricao: p.descricao,
    sistema: p.sistema,
    permissoes: Object.fromEntries(p.permissoes.map((x) => [x.permissao_chave, x.escopo])),
  }));
}
