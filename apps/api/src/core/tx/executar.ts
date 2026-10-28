import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { comTenant, Prisma, type PrismaClient } from '@ebisu/db';
import { PRISMA_APP } from '../banco/banco.module.js';
import { ErroDominio } from '../erros/erro-dominio.js';
import type { Comando, ContextoDaRequisicao } from './contexto.js';

// Único ponto que abre transação para dados de domínio (spec §3.2, §5.4). Idempotência, audit
// log e eventos entram aqui no PR 3.

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

  executarComando<Entrada, Saida>(
    contexto: ContextoDaRequisicao,
    comando: Comando<Entrada, Saida>,
    entrada: Entrada,
  ): Promise<Saida> {
    return comTenant(this.app, contexto.tenantId, (tx) => comando({ ...contexto, tx }, entrada));
  }
}

@Global()
@Module({ providers: [ExecutorDeComandos], exports: [ExecutorDeComandos] })
export class TxModule {}
