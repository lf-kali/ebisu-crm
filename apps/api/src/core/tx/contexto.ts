import type { EscopoPermissao } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';

// Contrato interno dos comandos de domínio (spec §5.4).

/** O que o guard (ou o job) já validou: quem age, em qual conta e empresa, e com que permissões. */
export interface ContextoDaRequisicao {
  tenantId: string;
  empresaId: string;
  /** null quando a origem é API key ou job. */
  membroId: string | null;
  /** Sempre null até as API keys (F3, PR 5). */
  apiKeyId: string | null;
  /** Permissões efetivas na empresa, com o escopo de cada uma (SEG-4). */
  permissoes: ReadonlyMap<string, EscopoPermissao>;
  requestId: string;
}

export interface TxContext extends ContextoDaRequisicao {
  /** Transação com `app.tenant_id` já definido (RLS, SEG-1). */
  tx: Prisma.TransactionClient;
}

/** Forma de todo comando. */
export type Comando<Entrada, Saida> = (ctx: TxContext, entrada: Entrada) => Promise<Saida>;
