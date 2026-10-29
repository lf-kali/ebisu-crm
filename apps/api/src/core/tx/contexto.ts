import type { EscopoPermissao } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';
import type { Idempotencia } from '../idempotencia/idempotencia.js';

// Contrato interno dos comandos de domínio (spec §5.4).

/** O que o guard (ou o job) já validou: quem age, em qual conta e empresa, e com que permissões. */
export interface ContextoDaRequisicao extends ContextoBase {
  empresaId: string;
  /** Permissões efetivas na empresa, com o escopo de cada uma (SEG-4). */
  permissoes: ReadonlyMap<string, EscopoPermissao>;
}

/** Rota da conta (`@PermissaoNaConta`): sem empresa. */
export interface ContextoDaConta extends ContextoBase {
  empresaId: null;
  /** Só as permissões com escopo TENANT em papéis atribuídos a todas as empresas. */
  permissoes: ReadonlyMap<string, 'TENANT'>;
}

interface ContextoBase {
  tenantId: string;
  /** null quando a origem é API key ou job. */
  membroId: string | null;
  /** Sempre null até as API keys (F3, PR 5). */
  apiKeyId: string | null;
  requestId: string;
  /** IP do cliente (audit log). */
  ip: string | null;
  /** POST de domínio: a Idempotency-Key e o hash do pedido (o executarComando a aplica). */
  idempotencia?: Idempotencia;
}

/** O contexto que o comando recebe: o da requisição, sem a idempotência, e a transação. */
export type ComTransacao<C extends ContextoDaRequisicao | ContextoDaConta> = Omit<
  C,
  'idempotencia'
> & {
  /** Transação com `app.tenant_id` já definido (RLS, SEG-1). */
  tx: Prisma.TransactionClient;
};

export type TxContext = ComTransacao<ContextoDaRequisicao>;
export type TxContextDaConta = ComTransacao<ContextoDaConta>;

/** Forma de todo comando. */
export type Comando<Entrada, Saida> = (ctx: TxContext, entrada: Entrada) => Promise<Saida>;
/** Comando de uma rota da conta. */
export type ComandoDaConta<Entrada, Saida> = (
  ctx: TxContextDaConta,
  entrada: Entrada,
) => Promise<Saida>;
