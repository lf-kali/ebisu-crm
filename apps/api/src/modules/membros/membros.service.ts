import { Inject, Injectable } from '@nestjs/common';
import type {
  EdicaoMembro,
  EntradaAtribuicoes,
  EntradaConvite,
  ListaMembros,
  Membro,
  ParametrosPaginacao,
} from '@ebisu/contracts';
import type { PrismaClient } from '@ebisu/db';
import { PRISMA_AUTH } from '../../core/banco/banco.module.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { LIMITADOR, type Limitador } from '../../core/limite/limitador.js';
import type { ContextoDaConta, TxContextDaConta } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as convites from './convites.comandos.js';
import * as comandos from './membros.comandos.js';
import type { LinhaMembro } from './membros.repositorio.js';
import { contaCriadaEm } from './convites.repositorio.js';
import { dadosDosUsuarios, idDoUsuario } from './usuarios.repositorio.js';

/**
 * Limites dos convites (cada um dispara um e-mail do sistema para fora): por conta, por e-mail de
 * destino e por convite reenviado. Sem eles, uma conta recém-cadastrada mandaria e-mails sem teto.
 */
const DIA = 24 * 60 * 60;
const LIMITES_CONVITE = {
  conta: { maximo: 30, janela: 60 * 60 },
  destino: { maximo: 3, janela: DIA },
  reenvio: { maximo: 3, janela: DIA },
  /** Conta com menos de 24 h: o cadastro é aberto, então conta nova convida pouco (usuário). */
  contaNova: { maximo: 5, janela: DIA },
  /**
   * Teto do sistema inteiro, contado só por convite de fato enfileirado (depois do comando). Dois
   * baldes: contas novas juntas não esgotam o das contas antigas, que convidam de verdade.
   */
  global: { maximo: 300, janela: 60 * 60 },
  globalNovas: { maximo: 100, janela: 60 * 60 },
} as const;

type Chaves = ReadonlyArray<[string, { maximo: number; janela: number }]>;

/** 429 com a espera, para o controller pôr no Retry-After. */
export class LimiteExcedido extends ErroDominio {
  constructor(readonly espera: number) {
    super('limite_excedido');
  }
}

/** Roda os comandos e completa cada membro com o nome e o e-mail do usuário. */
@Injectable()
export class MembrosService {
  constructor(
    private readonly executor: ExecutorDeComandos,
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(LIMITADOR) private readonly limitador: Limitador,
  ) {}

  /** Conta uma tentativa em cada chave; se alguma estourou, LimiteExcedido. */
  private async registrar(chaves: Chaves): Promise<void> {
    let espera = 0;
    for (const [chave, { maximo, janela }] of chaves)
      espera = Math.max(espera, await this.limitador.registrar(chave, maximo, janela));
    if (espera > 0) throw new LimiteExcedido(espera);
  }

  /**
   * O comando com os limites (plano f3-4b2, decisão 11). Roda dentro do executarComando, depois da
   * checagem de idempotência: repetir o POST com a mesma Idempotency-Key devolve a resposta salva
   * e não gasta cota (plano f3-3a). Ordem:
   * 1. limites da própria conta (conta, destino ou reenvio, conta nova): quem abusa só gasta a
   *    própria cota;
   * 2. o comando (403, 404, 409 param aqui, sem tocar no teto global);
   * 3. o teto global, só pelo convite de fato enfileirado; estourado, a transação desfaz tudo.
   */
  private comLimite<E, S>(chaves: Chaves, comando: (ctx: TxContextDaConta, e: E) => Promise<S>) {
    return async (ctx: TxContextDaConta, entrada: E): Promise<S> => {
      const nova = Date.now() - (await contaCriadaEm(ctx.tx, ctx.tenantId)).getTime() < DIA * 1000;
      await this.registrar(
        nova
          ? [...chaves, [`convite:conta-nova:${ctx.tenantId}`, LIMITES_CONVITE.contaNova]]
          : chaves,
      );
      const saida = await comando(ctx, entrada);
      await this.registrar([
        nova
          ? ['convite:global-novas', LIMITES_CONVITE.globalNovas]
          : ['convite:global', LIMITES_CONVITE.global],
      ]);
      return saida;
    };
  }

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

  /** E-mail normalizado como no cadastro; o usuário (se existir) só para checar se já é membro. */
  async convidar(ctx: ContextoDaConta, entrada: EntradaConvite) {
    const email = entrada.email.trim().toLowerCase();
    const usuarioId = await idDoUsuario(this.auth, email);
    const limitado = this.comLimite(
      [
        [`convite:conta:${ctx.tenantId}`, LIMITES_CONVITE.conta],
        [`convite:destino:${ctx.tenantId}:${email}`, LIMITES_CONVITE.destino],
      ],
      convites.convidar,
    );
    return this.executor.executarComando(ctx, limitado, {
      email,
      atribuicoes: entrada.atribuicoes,
      usuarioId,
    });
  }

  listarConvites(ctx: ContextoDaConta, query: ParametrosPaginacao) {
    return this.executor.executarComando(ctx, convites.listar, query);
  }

  reenviarConvite(ctx: ContextoDaConta, id: string) {
    const limitado = this.comLimite(
      [
        [`convite:conta:${ctx.tenantId}`, LIMITES_CONVITE.conta],
        [`convite:reenvio:${ctx.tenantId}:${id}`, LIMITES_CONVITE.reenvio],
      ],
      convites.reenviar,
    );
    return this.executor.executarComando(ctx, limitado, id);
  }

  revogarConvite(ctx: ContextoDaConta, id: string) {
    return this.executor.executarComando(ctx, convites.revogar, id);
  }

  async papeis(ctx: ContextoDaConta) {
    return { dados: await this.executor.executarComando(ctx, comandos.papeis, undefined) };
  }
}
