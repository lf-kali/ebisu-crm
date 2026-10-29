import type { Empresa } from '@ebisu/contracts';
import { Prisma, semearPadroesEmpresa } from '@ebisu/db';
import { ErroDominio } from '../../core/erros/erro-dominio.js';

// Acesso a `empresa` (plano docs/planos/f3-4a-cadastro-empresas.md). Tudo pelo `tx` do comando,
// sob o RLS da conta: empresa de outra conta não aparece.

const CAMPOS = {
  id: true,
  razao_social: true,
  nome_fantasia: true,
  cnpj: true,
  ativo: true,
  created_at: true,
} as const satisfies Prisma.EmpresaSelect;

type Linha = Prisma.EmpresaGetPayload<{ select: typeof CAMPOS }>;

const paraContrato = (linha: Linha): Empresa => ({
  ...linha,
  created_at: linha.created_at.toISOString(),
});

/** Empresas excluídas de vez (deleted_at) não aparecem; desativadas, sim. */
const VISIVEL = { deleted_at: null };

export interface DadosEmpresa {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string | null;
}

/** CNPJ repetido numa corrida com outra escrita: o índice único (tenant_id, cnpj) barra. */
async function comCnpjUnico<T>(escrita: Promise<T>): Promise<T> {
  try {
    return await escrita;
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
      throw new ErroDominio('duplicado', { detail: 'Já existe uma empresa com este CNPJ.' });
    throw erro;
  }
}

/** Uma página por id (os ids são UUID v7, em ordem de criação). */
export async function listarEmpresas(
  tx: Prisma.TransactionClient,
  { limite, aposId }: { limite: number; aposId?: string },
) {
  const linhas = await tx.empresa.findMany({
    where: { ...VISIVEL, ...(aposId ? { id: { gt: aposId } } : {}) },
    orderBy: { id: 'asc' },
    take: limite + 1,
    select: CAMPOS,
  });
  return { empresas: linhas.slice(0, limite).map(paraContrato), haMais: linhas.length > limite };
}

export async function buscarEmpresa(tx: Prisma.TransactionClient, id: string) {
  const linha = await tx.empresa.findFirst({ where: { id, ...VISIVEL }, select: CAMPOS });
  return linha ? paraContrato(linha) : null;
}

/** Outra empresa da conta com o mesmo CNPJ, ativa ou não. */
export async function empresaComCnpj(
  tx: Prisma.TransactionClient,
  cnpj: string,
  excetoId?: string,
) {
  return tx.empresa.findFirst({
    where: { cnpj, ...(excetoId ? { id: { not: excetoId } } : {}) },
    select: { id: true },
  });
}

/** Cria a empresa com os padrões (funil, origens, motivos de perda, modelos de mensagem). */
export async function criarEmpresa(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dados: DadosEmpresa,
): Promise<Empresa> {
  const linha = await comCnpjUnico(
    tx.empresa.create({ data: { tenant_id: tenantId, ...dados }, select: CAMPOS }),
  );
  await semearPadroesEmpresa(tx, tenantId, linha.id);
  return paraContrato(linha);
}

export async function editarEmpresa(
  tx: Prisma.TransactionClient,
  id: string,
  dados: Partial<DadosEmpresa>,
) {
  const { count } = await comCnpjUnico(
    tx.empresa.updateMany({ where: { id, ...VISIVEL }, data: dados }),
  );
  return count === 0 ? null : buscarEmpresa(tx, id);
}

/**
 * Trava as empresas ativas da conta até o fim da transação e devolve os ids. Duas desativações
 * simultâneas viram fila: a segunda já vê a primeira e não deixa a conta sem empresa ativa.
 */
export async function travarEmpresasAtivas(tx: Prisma.TransactionClient): Promise<string[]> {
  const linhas = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM empresa WHERE ativo AND deleted_at IS NULL ORDER BY id FOR UPDATE`;
  return linhas.map((l) => l.id);
}

export async function desativarEmpresa(tx: Prisma.TransactionClient, id: string) {
  await tx.empresa.updateMany({ where: { id, ...VISIVEL }, data: { ativo: false } });
}
