import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { EntradaLogin, RespostaSessao, ResumoConta } from '@ebisu/contracts';
import type { Prisma, PrismaClient } from '@ebisu/db';
import { PRISMA_AUTH } from '../../core/banco/banco.module.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { REFRESH_DIAS } from './cookie-refresh.js';
import { verificarSenha } from './senha.js';
import {
  ACESSO_SEGUNDOS,
  gerarRefreshToken,
  hashDoRefresh,
  type Identidade,
  TOKENS_DE_ACESSO,
  type TokensDeAcesso,
} from './tokens.js';

// Sessões (D-T05; plano docs/planos/f3-1-nucleo-auth.md). Tudo pelo papel ebisu_auth: usuario e
// refresh_token, mais a leitura de membro/tenant de qualquer conta para montar a lista de contas.

/** Sessão emitida: a resposta do contrato e o refresh token, que vai só no cookie. */
export interface SessaoEmitida {
  resposta: RespostaSessao;
  refresh: string;
}

export interface Origem {
  ip?: string;
  userAgent?: string;
}

interface Vinculo {
  membroId: string;
  conta: ResumoConta;
}

/** Cliente ou transação: as escritas da rotação acontecem dentro de uma transação só. */
type Banco = PrismaClient | Prisma.TransactionClient;

interface LinhaRefresh {
  id: string;
  usuario_id: string;
  tenant_id: string | null;
  familia: string;
  expira_em: Date;
  revogado_em: Date | null;
}

const naoAutenticado = () => new ErroDominio('nao_autenticado');
/** Contas que aceitam login: em teste ou ativas (suspensa e cancelada ficam de fora). */
const STATUS_CONTA_ATIVA = ['TRIAL', 'ATIVO'] as const;

export const normalizarEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class SessoesService {
  constructor(
    @Inject(PRISMA_AUTH) private readonly db: PrismaClient,
    @Inject(TOKENS_DE_ACESSO) private readonly tokens: TokensDeAcesso,
  ) {}

  /**
   * Login. E-mail inexistente, senha errada, usuário inativo e usuário sem conta ativa dão o
   * mesmo 401, com o mesmo custo de argon2id (não revela quem tem cadastro).
   */
  async entrar(credenciais: EntradaLogin, origem: Origem): Promise<SessaoEmitida> {
    const usuario = await this.db.usuario.findUnique({
      where: { email: normalizarEmail(credenciais.email) },
    });
    const senhaConfere = await verificarSenha(
      usuario?.ativo ? usuario.senha_hash : null,
      credenciais.senha,
    );
    if (!usuario || !usuario.ativo || !senhaConfere) throw naoAutenticado();

    const vinculos = await this.vinculosAtivos(usuario.id);
    if (vinculos.length === 0) throw naoAutenticado();
    // Abre na conta usada por último (família de refresh mais recente), senão na mais antiga.
    const ultima = await this.db.refreshToken.findFirst({
      where: {
        usuario_id: usuario.id,
        tenant_id: { in: vinculos.map((v) => v.conta.tenant_id) },
      },
      orderBy: { created_at: 'desc' },
      select: { tenant_id: true },
    });
    const vinculo = vinculos.find((v) => v.conta.tenant_id === ultima?.tenant_id) ?? vinculos[0]!;

    await this.db.usuario.update({ where: { id: usuario.id }, data: { ultimo_login: new Date() } });
    return this.emitir(this.db, usuario.id, vinculo, vinculos, randomUUID(), origem);
  }

  /**
   * Refresh rotativo: cada token vale uma vez. Reusar um token já trocado (ou dois refresh
   * simultâneos com o mesmo token) revoga a família inteira: quem roubou o token e o dono
   * legítimo perdem a sessão, e o dono entra de novo.
   */
  async renovar(token: string | undefined, origem: Origem): Promise<SessaoEmitida> {
    if (!token) throw naoAutenticado();
    // Tudo numa transação que trava a linha do token (FOR UPDATE): um segundo refresh com o
    // mesmo token espera o primeiro terminar, inclusive gravar o token novo, e só então vê o
    // reuso e revoga a família com o token novo junto. A revogação é gravada (commit) antes do
    // 401: por isso a transação devolve null em vez de lançar o erro.
    const emitida = await this.db.$transaction(async (tx) => {
      const [atual] = await tx.$queryRaw<LinhaRefresh[]>`
        SELECT id, usuario_id, tenant_id, familia, expira_em, revogado_em
        FROM refresh_token WHERE token_hash = ${hashDoRefresh(token)} FOR UPDATE`;
      if (!atual || !atual.tenant_id) return null;
      if (atual.revogado_em || atual.expira_em <= new Date()) {
        await this.revogarFamilia(tx, atual.familia);
        return null;
      }
      await tx.refreshToken.update({ where: { id: atual.id }, data: { revogado_em: new Date() } });

      // O acesso pode ter mudado desde o login: usuário desativado ou membro fora da conta.
      const usuario = await tx.usuario.findUnique({ where: { id: atual.usuario_id } });
      const vinculos = usuario?.ativo ? await this.vinculosAtivos(usuario.id, tx) : [];
      const vinculo = vinculos.find((v) => v.conta.tenant_id === atual.tenant_id);
      // Sem vínculo, a sessão acaba aqui: o token atual já foi marcado como usado nesta mesma
      // transação, e numa família só há um token vivo por vez.
      if (!vinculo) return null;
      return this.emitir(tx, atual.usuario_id, vinculo, vinculos, atual.familia, origem);
    });
    if (!emitida) throw naoAutenticado();
    return emitida;
  }

  /**
   * Troca de conta: só para conta em que o usuário é membro ativo (senão 404, sem revelar se a
   * conta existe). Revoga a família da sessão anterior e abre uma família nova.
   */
  async trocarConta(
    identidade: Identidade,
    tenantId: string,
    tokenAtual: string | undefined,
    origem: Origem,
  ): Promise<SessaoEmitida> {
    const vinculos = await this.vinculosAtivos(identidade.usuarioId);
    const vinculo = vinculos.find((v) => v.conta.tenant_id === tenantId);
    if (!vinculo) throw new ErroDominio('nao_encontrado');

    if (tokenAtual) {
      const atual = await this.db.refreshToken.findUnique({
        where: { token_hash: hashDoRefresh(tokenAtual) },
      });
      if (atual?.usuario_id === identidade.usuarioId)
        await this.revogarFamilia(this.db, atual.familia);
    }
    return this.emitir(this.db, identidade.usuarioId, vinculo, vinculos, randomUUID(), origem);
  }

  /** Logout: revoga a família inteira da sessão. Sem sessão válida, 401. */
  async sair(token: string | undefined): Promise<void> {
    if (!token) throw naoAutenticado();
    const atual = await this.db.refreshToken.findUnique({
      where: { token_hash: hashDoRefresh(token) },
    });
    if (!atual || atual.revogado_em) throw naoAutenticado();
    await this.revogarFamilia(this.db, atual.familia);
  }

  private async emitir(
    db: Banco,
    usuarioId: string,
    vinculo: Vinculo,
    vinculos: Vinculo[],
    familia: string,
    origem: Origem,
  ): Promise<SessaoEmitida> {
    const refresh = gerarRefreshToken();
    await db.refreshToken.create({
      data: {
        usuario_id: usuarioId,
        tenant_id: vinculo.conta.tenant_id,
        token_hash: hashDoRefresh(refresh),
        familia,
        expira_em: new Date(Date.now() + REFRESH_DIAS * 24 * 60 * 60 * 1000),
        ip: origem.ip ?? null,
        user_agent: origem.userAgent?.slice(0, 500) ?? null,
      },
    });
    const accessToken = await this.tokens.emitir({
      usuarioId,
      tenantId: vinculo.conta.tenant_id,
      membroId: vinculo.membroId,
    });
    return {
      resposta: {
        access_token: accessToken,
        token_type: 'Bearer',
        expira_em: ACESSO_SEGUNDOS,
        conta: vinculo.conta,
        contas: vinculos.map((v) => v.conta),
      },
      refresh,
    };
  }

  private async revogarFamilia(db: Banco, familia: string): Promise<void> {
    await db.refreshToken.updateMany({
      where: { familia, revogado_em: null },
      data: { revogado_em: new Date() },
    });
  }

  /** Contas em que o usuário é membro ATIVO e que aceitam login, da mais antiga à mais nova. */
  private async vinculosAtivos(usuarioId: string, db: Banco = this.db): Promise<Vinculo[]> {
    const membros = await db.membro.findMany({
      where: {
        usuario_id: usuarioId,
        status: 'ATIVO',
        tenant: { status: { in: [...STATUS_CONTA_ATIVA] } },
      },
      include: { tenant: { select: { id: true, nome: true, slug: true } } },
      orderBy: { created_at: 'asc' },
    });
    return membros.map((m) => ({
      membroId: m.id,
      conta: { tenant_id: m.tenant.id, nome: m.tenant.nome, slug: m.tenant.slug },
    }));
  }
}
