import { createHash } from 'node:crypto';
import { Uuid } from '@ebisu/contracts';
import { Prisma } from '@ebisu/db';
import type { Request } from 'express';
import { ErroDominio } from '../erros/erro-dominio.js';

// Idempotency-Key (spec §5.1, SEG-7; plano docs/planos/f3-3a-idempotencia.md). A resposta é
// gravada na mesma transação do comando, com a chave travada: efeito e resposta salva nunca se
// separam, e uma falha não deixa nada gravado.

export const CABECALHO_IDEMPOTENCIA = 'idempotency-key';
const VALIDADE_MS = 24 * 60 * 60 * 1000;

/** A chave do pedido e o hash do que ela representa (decisão 6 do plano). */
export interface Idempotencia {
  chave: string;
  /** Método e molde da rota, ex.: `POST /v1/contatos/:id/enviar`. */
  rota: string;
  hash: string;
}

/** Ordena as chaves dos objetos (recursivo): o mesmo corpo dá sempre o mesmo JSON. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object')
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((k) => [k, canonico((valor as Record<string, unknown>)[k])]),
    );
  return valor;
}

/**
 * Lê a `Idempotency-Key` e calcula o hash do pedido: rota, parâmetros, query, empresa, autor e
 * corpo.
 * Mudar qualquer um com a mesma chave dá 422. O autor no hash impede que outra pessoa da conta,
 * com a mesma chave, receba a resposta de alguém.
 */
export function idempotenciaDa(req: Request, empresaId: string, autor: string): Idempotencia {
  const valor = req.get(CABECALHO_IDEMPOTENCIA);
  if (!valor || !Uuid.safeParse(valor).success)
    throw new ErroDominio('validacao', {
      campos: [
        valor
          ? { campo: 'Idempotency-Key', code: 'invalid_format', mensagem: 'UUID inválido.' }
          : { campo: 'Idempotency-Key', code: 'invalid_type', mensagem: 'Campo obrigatório.' },
      ],
    });
  const molde = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof molde !== 'string') throw new Error('Idempotência fora de uma rota do Nest');
  const rota = `${req.method} ${molde}`;
  const pedido = {
    rota,
    params: req.params,
    query: req.query,
    empresaId,
    autor,
    corpo: req.body ?? null,
  };
  const hash = createHash('sha256')
    .update(JSON.stringify(canonico(pedido)))
    .digest('hex');
  return { chave: valor.toLowerCase(), rota, hash };
}

/**
 * Trava a chave (nesta transação) e devolve a resposta salva, se houver. Outra requisição com a
 * mesma chave em andamento: 409. Chave salva com outro pedido: 422. Chave vencida: apagada, e o
 * pedido roda como novo.
 */
export async function travarERecuperar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  { chave, hash }: Idempotencia,
): Promise<{ resposta: unknown } | null> {
  const [trava] = await tx.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${`${tenantId}:${chave}`}, 0)) AS ok`;
  if (!trava?.ok) throw new ErroDominio('idempotencia_em_andamento');

  const where = { tenant_id_chave: { tenant_id: tenantId, chave } };
  const salva = await tx.idempotenciaRequisicao.findUnique({ where });
  if (!salva) return null;
  if (salva.expira_em <= new Date()) {
    await tx.idempotenciaRequisicao.delete({ where });
    return null;
  }
  if (salva.hash_payload !== hash) throw new ErroDominio('idempotencia_divergente');
  return { resposta: salva.resposta };
}

/** A saída em JSON: é o que vai salvo e o que a primeira resposta devolve (iguais na repetição). */
export const comoJson = (saida: unknown): unknown =>
  saida === undefined ? null : (JSON.parse(JSON.stringify(saida)) as unknown);

/** Grava a resposta do comando, na mesma transação dos efeitos. */
export async function gravarResposta(
  tx: Prisma.TransactionClient,
  tenantId: string,
  { chave, rota, hash }: Idempotencia,
  resposta: unknown,
): Promise<void> {
  await tx.idempotenciaRequisicao.create({
    data: {
      tenant_id: tenantId,
      chave,
      rota,
      hash_payload: hash,
      status: 'CONCLUIDA',
      resposta: resposta === null ? Prisma.JsonNull : (resposta as Prisma.InputJsonValue),
      expira_em: new Date(Date.now() + VALIDADE_MS),
    },
  });
}
