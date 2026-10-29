import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { comTenant, Prisma, type PrismaClient } from '@ebisu/db';
import { PRISMA_APP } from '../banco/banco.module.js';
import { ErroDominio } from '../erros/erro-dominio.js';
import { comoJson, gravarResposta, travarERecuperar } from '../idempotencia/idempotencia.js';
import type { ComTransacao, ContextoDaConta, ContextoDaRequisicao } from './contexto.js';

// Único ponto que abre transação para dados de domínio (spec §3.2, §5.4): aplica a
// Idempotency-Key (PR 3a) e informa o autor ao audit log do banco (PR 3b); eventos depois.

/**
 * Envolve uma escrita que grava referências (FKs, compostas por empresa: SEG-2). Se uma delas não
 * existir ou for de outra empresa, a resposta é a mesma 422, sem revelar qual dos dois casos.
 * Só nas escritas de referência: uma FK RESTRICT barrando uma exclusão, por exemplo, é outra
 * situação (o comando trata como conflito) e continua como erro.
 */
export async function comReferencias<T>(escrita: Promise<T>): Promise<T> {
  try {
    return await escrita;
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2003')
      throw new ErroDominio('validacao', { detail: 'Um registro referenciado não existe.' });
    throw erro;
  }
}

@Injectable()
export class ExecutorDeComandos {
  constructor(@Inject(PRISMA_APP) private readonly app: PrismaClient) {}

  executarComando<C extends ContextoDaRequisicao | ContextoDaConta, Entrada, Saida>(
    contexto: C,
    comando: (ctx: ComTransacao<C>, entrada: Entrada) => Promise<Saida>,
    entrada: Entrada,
  ): Promise<Saida> {
    const { idempotencia, ...resto } = contexto;
    // Autor da transação: o trigger auditar() grava no audit_log (plano f3-3b, SEG-8).
    const ator = {
      membroId: contexto.membroId,
      apiKeyId: contexto.apiKeyId,
      requestId: contexto.requestId,
      ip: contexto.ip,
    };
    return comTenant(
      this.app,
      contexto.tenantId,
      async (tx) => {
        if (!idempotencia) return comando({ ...resto, tx }, entrada);
        // A chave fica travada até o fim desta transação; a resposta é gravada nela (plano f3-3a).
        const salva = await travarERecuperar(tx, contexto.tenantId, idempotencia);
        if (salva) return salva.resposta as Saida;
        const resposta = comoJson(await comando({ ...resto, tx }, entrada));
        await gravarResposta(tx, contexto.tenantId, idempotencia, resposta);
        return resposta as Saida;
      },
      { ator },
    );
  }
}

@Global()
@Module({ providers: [ExecutorDeComandos], exports: [ExecutorDeComandos] })
export class TxModule {}
