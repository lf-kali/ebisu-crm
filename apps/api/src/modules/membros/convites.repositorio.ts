import type { Convite } from '@ebisu/contracts';
import { Prisma, VALIDADE_CONVITE_DIAS } from '@ebisu/db';
import { ErroDominio } from '../../core/erros/erro-dominio.js';

// Acesso a convite e email_saida (plano docs/planos/f3-4b2-convites.md). Tudo pelo `tx` do
// comando, sob o RLS da conta.

export interface AtribuicaoPedida {
  papel_id: string;
  empresa_id: string | null;
}

const CAMPOS = {
  id: true,
  email: true,
  atribuicoes: true,
  expira_em: true,
  aceito_em: true,
  revogado_em: true,
  created_at: true,
  emails: { select: { status: true }, orderBy: { created_at: 'desc' }, take: 1 },
} as const satisfies Prisma.ConviteSelect;

type LinhaConvite = Prisma.ConviteGetPayload<{ select: typeof CAMPOS }>;

const novaValidade = () => new Date(Date.now() + VALIDADE_CONVITE_DIAS * 24 * 60 * 60 * 1000);

/** Pendente: nem aceito nem revogado (vencido ainda pode ser reenviado). */
const PENDENTE = { aceito_em: null, revogado_em: null };

/** Convites com os papéis resolvidos (nome e chave), no formato do contrato. */
export async function paraContrato(
  tx: Prisma.TransactionClient,
  linhas: LinhaConvite[],
): Promise<Convite[]> {
  const ids = [
    ...new Set(
      linhas.flatMap((l) =>
        (l.atribuicoes as unknown as AtribuicaoPedida[]).map((a) => a.papel_id),
      ),
    ),
  ];
  const papeis = new Map(
    (
      await tx.papel.findMany({
        where: { id: { in: ids } },
        select: { id: true, chave: true, nome: true },
      })
    ).map((p) => [p.id, p]),
  );
  const agora = new Date();
  return linhas.map((l) => ({
    id: l.id,
    email: l.email,
    atribuicoes: (l.atribuicoes as unknown as AtribuicaoPedida[]).flatMap((a) => {
      const papel = papeis.get(a.papel_id);
      return papel ? [{ papel, empresa_id: a.empresa_id }] : [];
    }),
    expira_em: l.expira_em.toISOString(),
    expirado: l.expira_em <= agora,
    envio: l.emails[0]?.status ?? null,
    created_at: l.created_at.toISOString(),
  }));
}

export async function buscarConvite(tx: Prisma.TransactionClient, id: string) {
  return tx.convite.findUnique({ where: { id }, select: CAMPOS });
}

export async function listarPendentes(
  tx: Prisma.TransactionClient,
  { limite, aposId }: { limite: number; aposId?: string },
) {
  const linhas = await tx.convite.findMany({
    where: { ...PENDENTE, ...(aposId ? { id: { gt: aposId } } : {}) },
    orderBy: { id: 'asc' },
    take: limite + 1,
    select: CAMPOS,
  });
  return { linhas: linhas.slice(0, limite), haMais: linhas.length > limite };
}

/** O usuário já é membro desta conta (qualquer status). */
export async function jaEhMembro(tx: Prisma.TransactionClient, usuarioId: string) {
  return (await tx.membro.count({ where: { usuario_id: usuarioId } })) > 0;
}

/**
 * Convite pendente e ainda válido para o e-mail; os vencidos são revogados aqui, para não
 * ocuparem o lugar do convite novo (índice convite_pendente_uq).
 */
export async function pendenteValido(tx: Prisma.TransactionClient, email: string) {
  await tx.convite.updateMany({
    where: { email, ...PENDENTE, expira_em: { lte: new Date() } },
    data: { revogado_em: new Date(), token_hash: null },
  });
  return tx.convite.findFirst({ where: { email, ...PENDENTE }, select: { id: true } });
}

/** Convite novo e o e-mail dele no outbox, na mesma transação (decisão 4). */
export async function criarConvite(
  tx: Prisma.TransactionClient,
  dados: {
    tenantId: string;
    email: string;
    atribuicoes: AtribuicaoPedida[];
    convidadoPor: string | null;
  },
) {
  try {
    const { id } = await tx.convite.create({
      data: {
        tenant_id: dados.tenantId,
        email: dados.email,
        atribuicoes: dados.atribuicoes as unknown as Prisma.InputJsonValue,
        convidado_por: dados.convidadoPor,
        expira_em: novaValidade(),
      },
      select: { id: true },
    });
    await enfileirarEmail(tx, dados.tenantId, id);
    return id;
  } catch (erro) {
    // Corrida com outro convite para o mesmo e-mail (convite_pendente_uq).
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
      throw new ErroDominio('duplicado', { detail: 'Já há um convite pendente para este e-mail.' });
    throw erro;
  }
}

async function enfileirarEmail(tx: Prisma.TransactionClient, tenantId: string, conviteId: string) {
  // Um e-mail do convite por vez: os que ainda não saíram são cancelados.
  await tx.emailSaida.updateMany({
    where: { convite_id: conviteId, status: { in: ['PENDENTE', 'ENVIANDO'] } },
    data: { status: 'CANCELADO' },
  });
  await tx.emailSaida.create({
    data: { tenant_id: tenantId, tipo: 'CONVITE', convite_id: conviteId },
  });
}

/** Nova validade, token antigo invalidado (o worker gera outro no envio) e e-mail novo. */
export async function reenviarConvite(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  await tx.convite.update({
    where: { id },
    data: { expira_em: novaValidade(), token_hash: null },
  });
  await enfileirarEmail(tx, tenantId, id);
}

export async function revogarConvite(tx: Prisma.TransactionClient, id: string) {
  await tx.convite.update({ where: { id }, data: { revogado_em: new Date(), token_hash: null } });
  await tx.emailSaida.updateMany({
    where: { convite_id: id, status: { in: ['PENDENTE', 'ENVIANDO'] } },
    data: { status: 'CANCELADO' },
  });
}
