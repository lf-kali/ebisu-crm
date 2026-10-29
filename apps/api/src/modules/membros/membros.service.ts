import { Inject, Injectable } from '@nestjs/common';
import type {
  EdicaoMembro,
  EntradaAtribuicoes,
  ListaMembros,
  Membro,
  ParametrosPaginacao,
} from '@ebisu/contracts';
import type { PrismaClient } from '@ebisu/db';
import { PRISMA_AUTH } from '../../core/banco/banco.module.js';
import type { ContextoDaConta } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './membros.comandos.js';
import type { LinhaMembro } from './membros.repositorio.js';
import { dadosDosUsuarios } from './usuarios.repositorio.js';

/** Roda os comandos e completa cada membro com o nome e o e-mail do usuário. */
@Injectable()
export class MembrosService {
  constructor(
    private readonly executor: ExecutorDeComandos,
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
  ) {}

  private async comUsuarios(linhas: LinhaMembro[]): Promise<Membro[]> {
    const usuarios = await dadosDosUsuarios(
      this.auth,
      linhas.map((l) => l.usuario_id),
    );
    return linhas.map(({ usuario_id, created_at, ...membro }) => {
      const usuario = usuarios.get(usuario_id);
      if (!usuario) throw new Error(`Membro ${membro.id} sem usuário`);
      return { ...membro, usuario, created_at: created_at.toISOString() };
    });
  }

  private async um(linha: LinhaMembro): Promise<Membro> {
    const [membro] = await this.comUsuarios([linha]);
    return membro!;
  }

  async listar(ctx: ContextoDaConta, query: ParametrosPaginacao): Promise<ListaMembros> {
    const { membros, proximoCursor } = await this.executor.executarComando(
      ctx,
      comandos.listar,
      query,
    );
    return { dados: await this.comUsuarios(membros), proximo_cursor: proximoCursor };
  }

  async ler(ctx: ContextoDaConta, id: string) {
    return this.um(await this.executor.executarComando(ctx, comandos.ler, id));
  }

  async editar(ctx: ContextoDaConta, id: string, edicao: EdicaoMembro) {
    return this.um(await this.executor.executarComando(ctx, comandos.editar, { id, edicao }));
  }

  async atribuir(ctx: ContextoDaConta, id: string, entrada: EntradaAtribuicoes) {
    return this.um(await this.executor.executarComando(ctx, comandos.atribuir, { id, entrada }));
  }

  async papeis(ctx: ContextoDaConta) {
    return { dados: await this.executor.executarComando(ctx, comandos.papeis, undefined) };
  }
}
