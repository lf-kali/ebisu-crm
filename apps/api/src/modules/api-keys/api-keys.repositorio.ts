import type { ApiKey, ApiKeyCriada } from '@ebisu/contracts';
import { CHAVES_PERMISSAO, gerarApiKey, type Prisma } from '@ebisu/db';

// Acesso a `api_key` (plano docs/planos/f3-5-api-keys-cors.md). Tudo pelo `tx` do comando, sob o
// RLS da conta, e sempre filtrado pela empresa do contexto. O hash nunca sai daqui.

const CAMPOS = {
  id: true,
  nome: true,
  tipo: true,
  prefixo: true,
  escopos: true,
  origens_cors: true,
  expira_em: true,
  revogada_em: true,
  ultimo_uso: true,
  criado_por: true,
  created_at: true,
} as const satisfies Prisma.ApiKeySelect;

type Linha = Prisma.ApiKeyGetPayload<{ select: typeof CAMPOS }>;

const iso = (data: Date | null) => data?.toISOString() ?? null;

const paraContrato = (linha: Linha): ApiKey => ({
  ...linha,
  expira_em: iso(linha.expira_em),
  revogada_em: iso(linha.revogada_em),
  ultimo_uso: iso(linha.ultimo_uso),
  created_at: linha.created_at.toISOString(),
});

/** Uma página por id (UUID v7, em ordem de criação), revogadas incluídas. */
export async function listarApiKeys(
  tx: Prisma.TransactionClient,
  empresaId: string,
  { limite, aposId }: { limite: number; aposId?: string },
) {
  const linhas = await tx.apiKey.findMany({
    where: { empresa_id: empresaId, ...(aposId ? { id: { gt: aposId } } : {}) },
    orderBy: { id: 'asc' },
    take: limite + 1,
    select: CAMPOS,
  });
  return { chaves: linhas.slice(0, limite).map(paraContrato), haMais: linhas.length > limite };
}

export async function buscarApiKey(tx: Prisma.TransactionClient, empresaId: string, id: string) {
  const linha = await tx.apiKey.findFirst({ where: { id, empresa_id: empresaId }, select: CAMPOS });
  return linha ? paraContrato(linha) : null;
}

export interface NovaApiKey {
  tenantId: string;
  empresaId: string;
  criadoPor: string | null;
  nome: string;
  tipo: 'SERVIDOR' | 'NAVEGADOR';
  escopos: string[];
  origens: string[];
  expiraEm: Date | null;
}

/** Permissão do catálogo fixo (`recurso.acao`). */
export const noCatalogo = (chave: string) => CHAVES_PERMISSAO.has(chave);

/** Grava a chave com um token novo; o token só sai daqui, nesta resposta (decisão 6). */
export async function criarApiKey(
  tx: Prisma.TransactionClient,
  nova: NovaApiKey,
): Promise<ApiKeyCriada> {
  const { token, prefixo, hash } = gerarApiKey();
  const linha = await tx.apiKey.create({
    data: {
      tenant_id: nova.tenantId,
      empresa_id: nova.empresaId,
      criado_por: nova.criadoPor,
      nome: nova.nome,
      tipo: nova.tipo,
      escopos: nova.escopos,
      origens_cors: nova.origens,
      expira_em: nova.expiraEm,
      prefixo,
      hash,
    },
    select: CAMPOS,
  });
  return { ...paraContrato(linha), token };
}

export async function editarApiKey(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  dados: { nome?: string; escopos?: string[]; origens_cors?: string[] },
) {
  await tx.apiKey.updateMany({ where: { id, empresa_id: empresaId }, data: dados });
  return buscarApiKey(tx, empresaId, id);
}

/** Revoga se ainda não foi; devolve se a chave existe na empresa. */
export async function revogarApiKey(tx: Prisma.TransactionClient, empresaId: string, id: string) {
  await tx.apiKey.updateMany({
    where: { id, empresa_id: empresaId, revogada_em: null },
    data: { revogada_em: new Date() },
  });
  return (await tx.apiKey.count({ where: { id, empresa_id: empresaId } })) > 0;
}
