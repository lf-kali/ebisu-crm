import type { MotivoPerda, Origem } from '@ebisu/contracts';
import { Prisma } from '@ebisu/db';
import { ErroDominio } from '../../core/erros/erro-dominio.js';

// Acesso a `origem_lead` e `motivo_perda` (plano docs/planos/f4-1-contatos.md, decisão 7). Sempre
// pela empresa do contexto, sob o RLS da conta.

const CAMPOS_ORIGEM = { id: true, nome: true, tipo: true, ativo: true } as const;
const CAMPOS_MOTIVO = { id: true, nome: true, ativo: true } as const;

const duplicado = (idExistente?: string) =>
  new ErroDominio('duplicado', {
    detail: 'Já existe um registro com este nome na empresa.',
    ...(idExistente ? { extras: { id_existente: idExistente } } : {}),
  });

/**
 * Confere o nome antes de gravar (409 com o id de quem já o tem). Depois de um erro a transação do
 * Postgres fica abortada, então a corrida com outra escrita só vira 409, sem o id.
 */
async function comNomeUnico<T>(existente: { id: string } | null, escrita: () => Promise<T>) {
  if (existente) throw duplicado(existente.id);
  try {
    return await escrita();
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
      throw duplicado();
    throw erro;
  }
}

const outroComNome = (
  achar: (args: { where: object; select: { id: true } }) => Promise<{ id: string } | null>,
  empresaId: string,
  nome: string | undefined,
  exceto?: string,
) =>
  nome
    ? achar({
        where: { empresa_id: empresaId, nome, ...(exceto ? { id: { not: exceto } } : {}) },
        select: { id: true },
      })
    : Promise.resolve(null);

export const listarOrigens = (tx: Prisma.TransactionClient, empresaId: string): Promise<Origem[]> =>
  tx.origemLead.findMany({
    where: { empresa_id: empresaId },
    orderBy: { nome: 'asc' },
    select: CAMPOS_ORIGEM,
  });

export const buscarOrigem = (tx: Prisma.TransactionClient, empresaId: string, id: string) =>
  tx.origemLead.findFirst({ where: { id, empresa_id: empresaId }, select: CAMPOS_ORIGEM });

export function criarOrigem(
  tx: Prisma.TransactionClient,
  tenantId: string,
  empresaId: string,
  dados: Pick<Origem, 'nome' | 'tipo'>,
) {
  const achar = (args: object) => tx.origemLead.findFirst(args);
  return outroComNome(achar, empresaId, dados.nome).then((existente) =>
    comNomeUnico(existente, () =>
      tx.origemLead.create({
        data: { tenant_id: tenantId, empresa_id: empresaId, ...dados },
        select: CAMPOS_ORIGEM,
      }),
    ),
  );
}

export async function editarOrigem(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  dados: Partial<Pick<Origem, 'nome' | 'tipo' | 'ativo'>>,
) {
  const existente = await outroComNome(
    (args) => tx.origemLead.findFirst(args),
    empresaId,
    dados.nome,
    id,
  );
  await comNomeUnico(existente, () =>
    tx.origemLead.updateMany({ where: { id, empresa_id: empresaId }, data: dados }),
  );
  return buscarOrigem(tx, empresaId, id);
}

export const listarMotivos = (
  tx: Prisma.TransactionClient,
  empresaId: string,
): Promise<MotivoPerda[]> =>
  tx.motivoPerda.findMany({
    where: { empresa_id: empresaId },
    orderBy: { nome: 'asc' },
    select: CAMPOS_MOTIVO,
  });

export const buscarMotivo = (tx: Prisma.TransactionClient, empresaId: string, id: string) =>
  tx.motivoPerda.findFirst({ where: { id, empresa_id: empresaId }, select: CAMPOS_MOTIVO });

export function criarMotivo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  empresaId: string,
  nome: string,
) {
  const achar = (args: object) => tx.motivoPerda.findFirst(args);
  return outroComNome(achar, empresaId, nome).then((existente) =>
    comNomeUnico(existente, () =>
      tx.motivoPerda.create({
        data: { tenant_id: tenantId, empresa_id: empresaId, nome },
        select: CAMPOS_MOTIVO,
      }),
    ),
  );
}

export async function editarMotivo(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  dados: Partial<Pick<MotivoPerda, 'nome' | 'ativo'>>,
) {
  const existente = await outroComNome(
    (args) => tx.motivoPerda.findFirst(args),
    empresaId,
    dados.nome,
    id,
  );
  await comNomeUnico(existente, () =>
    tx.motivoPerda.updateMany({ where: { id, empresa_id: empresaId }, data: dados }),
  );
  return buscarMotivo(tx, empresaId, id);
}
