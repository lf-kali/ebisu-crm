import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { comTenant, Prisma, type PrismaClient } from '@ebisu/db';
import { PRISMA_APP } from '../banco/banco.module.js';
import { ErroDominio } from '../erros/erro-dominio.js';
import type { Comando, ContextoDaRequisicao } from './contexto.js';

// Único ponto que abre transação para dados de domínio (spec §3.2, §5.4). Idempotência, audit
// log e eventos entram aqui no PR 3.

@Injectable()
export class ExecutorDeComandos {
  constructor(@Inject(PRISMA_APP) private readonly app: PrismaClient) {}

  async executarComando<Entrada, Saida>(
    contexto: ContextoDaRequisicao,
    comando: Comando<Entrada, Saida>,
    entrada: Entrada,
  ): Promise<Saida> {
    try {
      return await comTenant(this.app, contexto.tenantId, (tx) =>
        comando({ ...contexto, tx }, entrada),
      );
    } catch (erro) {
      // FK (composta, SEG-2) violada: referência inexistente ou de outra empresa. A mesma
      // resposta nos dois casos, para não revelar que o registro de outra empresa existe.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2003')
        throw new ErroDominio('validacao', { detail: 'Um registro referenciado não existe.' });
      throw erro;
    }
  }
}

@Global()
@Module({ providers: [ExecutorDeComandos], exports: [ExecutorDeComandos] })
export class TxModule {}
