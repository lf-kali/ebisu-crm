import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConsultaConvite, EntradaAceite } from '@ebisu/contracts';
import { comTenant, hashDoTokenConvite, Prisma, type PrismaClient } from '@ebisu/db';
import { PRISMA_APP, PRISMA_AUTH } from '../../core/banco/banco.module.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { validarSenha } from './politica-senha.js';
import type { OrigemDoCadastro } from './registro.service.js';
import { gerarHashSenha, verificarSenha } from './senha.js';
import { type SessaoEmitida, SessoesService } from './sessoes.service.js';

// Aceite de convite (plano docs/planos/f3-4b2-convites.md, decisões 6 a 9). Como o cadastro, em
// duas etapas por papel de banco: o usuário pelo ebisu_auth, o membro pelo ebisu_app dentro da
// conta. O token do link prova a posse do e-mail.

interface AtribuicaoPedida {
  papel_id: string;
  empresa_id: string | null;
}

const linkInvalido = () => new ErroDominio('link_invalido');

@Injectable()
export class ConvitesService {
  constructor(
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(PRISMA_APP) private readonly app: PrismaClient,
    private readonly sessoes: SessoesService,
  ) {}

  /** O convite do token: pendente e no prazo; senão 410, sem dizer por quê. */
  private async conviteDoToken(token: string) {
    const convite = await this.auth.convite.findUnique({
      where: { token_hash: hashDoTokenConvite(token) },
    });
    const valido =
      convite && !convite.aceito_em && !convite.revogado_em && convite.expira_em > new Date();
    if (!valido) throw linkInvalido();
    return convite;
  }

  async consultar(token: string): Promise<ConsultaConvite> {
    const convite = await this.conviteDoToken(token);
    const [usuario, conta] = await Promise.all([
      this.auth.usuario.findUnique({ where: { email: convite.email } }),
      this.auth.tenant.findUniqueOrThrow({
        where: { id: convite.tenant_id },
        select: { nome: true },
      }),
    ]);
    const acao = !usuario
      ? 'CRIAR_ACESSO'
      : usuario.email_verificado_em
        ? 'SENHA_ATUAL'
        : 'NOVA_SENHA';
    return { conta, email: convite.email, acao };
  }

  async aceitar(entrada: EntradaAceite, origem: OrigemDoCadastro): Promise<SessaoEmitida> {
    const convite = await this.conviteDoToken(entrada.token);
    const usuarioId = await this.usuarioDoAceite(convite.email, entrada);
    await this.tornarMembro(convite.id, convite.tenant_id, usuarioId, entrada.token, origem);
    return this.sessoes.abrirNaConta(usuarioId, convite.tenant_id, origem);
  }

  /**
   * Decisão 7: e-mail sem usuário cria o usuário (já verificado); usuário verificado precisa da
   * senha dele; não verificado ganha a senha nova, perde as sessões e fica verificado (decisão
   * 10 do PR 4a); inativo dá 401.
   */
  private async usuarioDoAceite(email: string, entrada: EntradaAceite): Promise<string> {
    const usuario = await this.auth.usuario.findUnique({ where: { email } });
    if (!usuario) return this.criarUsuario(email, entrada);
    if (!usuario.ativo) {
      await verificarSenha(null, entrada.senha);
      throw new ErroDominio('nao_autenticado');
    }
    if (usuario.email_verificado_em) {
      if (!(await verificarSenha(usuario.senha_hash, entrada.senha)))
        throw new ErroDominio('nao_autenticado');
      return usuario.id;
    }
    validarSenha(entrada.senha, { email, nome: entrada.nome ?? usuario.nome });
    const senha_hash = await gerarHashSenha(entrada.senha);
    await this.auth.$transaction([
      this.auth.usuario.update({
        where: { id: usuario.id },
        data: { senha_hash, email_verificado_em: new Date() },
      }),
      // Quem cadastrou o e-mail antes (sem provar a posse) perde todas as sessões.
      this.auth.refreshToken.updateMany({
        where: { usuario_id: usuario.id, revogado_em: null },
        data: { revogado_em: new Date() },
      }),
    ]);
    return usuario.id;
  }

  private async criarUsuario(email: string, entrada: EntradaAceite): Promise<string> {
    if (!entrada.nome)
      throw new ErroDominio('validacao', {
        campos: [{ campo: 'nome', code: 'invalid_type', mensagem: 'Campo obrigatório.' }],
      });
    validarSenha(entrada.senha, { email, nome: entrada.nome });
    try {
      const { id } = await this.auth.usuario.create({
        data: {
          email,
          nome: entrada.nome,
          senha_hash: await gerarHashSenha(entrada.senha),
          email_verificado_em: new Date(),
        },
        select: { id: true },
      });
      return id;
    } catch (erro) {
      // Outro aceite (ou cadastro) criou o usuário antes: segue como usuário existente.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002' &&
        erro.meta?.modelName === 'Usuario'
      )
        return this.usuarioDoAceite(email, entrada);
      throw erro;
    }
  }

  /**
   * Decisão 8, dentro da conta e com o convite travado: confere de novo o token (um reenvio pode
   * tê-lo trocado) e o prazo; recusa quem já é membro e papéis ou empresas que sumiram; cria o
   * membro ativo com as atribuições e marca o convite como aceito. O autor no audit log é o
   * novo membro.
   */
  private async tornarMembro(
    conviteId: string,
    tenantId: string,
    usuarioId: string,
    token: string,
    origem: OrigemDoCadastro,
  ) {
    const membroId = randomUUID();
    const ator = { membroId, requestId: origem.requestId, ip: origem.ip ?? null };
    await comTenant(
      this.app,
      tenantId,
      async (tx) => {
        const [convite] = await tx.$queryRaw<
          Array<{
            token_hash: string | null;
            aceito_em: Date | null;
            revogado_em: Date | null;
            expira_em: Date;
            atribuicoes: AtribuicaoPedida[];
          }>
        >`SELECT token_hash, aceito_em, revogado_em, expira_em, atribuicoes
            FROM convite WHERE id = ${conviteId}::uuid FOR UPDATE`;
        const valido =
          convite &&
          convite.token_hash === hashDoTokenConvite(token) &&
          !convite.aceito_em &&
          !convite.revogado_em &&
          convite.expira_em > new Date();
        if (!valido) throw linkInvalido();
        if ((await tx.membro.count({ where: { usuario_id: usuarioId } })) > 0)
          throw new ErroDominio('duplicado', { detail: 'Você já é membro desta conta.' });
        await exigirAtribuicoesValidas(tx, convite.atribuicoes);

        await tx.membro.create({
          data: { id: membroId, tenant_id: tenantId, usuario_id: usuarioId, status: 'ATIVO' },
        });
        await tx.atribuicaoPapel.createMany({
          data: convite.atribuicoes.map((a) => ({
            tenant_id: tenantId,
            membro_id: membroId,
            papel_id: a.papel_id,
            empresa_id: a.empresa_id,
          })),
        });
        await tx.convite.update({
          where: { id: conviteId },
          data: { aceito_em: new Date(), token_hash: null },
        });
      },
      { ator },
    );
  }
}

/** Papel ou empresa que sumiu (ou empresa desativada) desde o convite: 409, peça outro. */
async function exigirAtribuicoesValidas(
  tx: Prisma.TransactionClient,
  atribuicoes: AtribuicaoPedida[],
) {
  const papeis = [...new Set(atribuicoes.map((a) => a.papel_id))];
  const empresas = [...new Set(atribuicoes.flatMap((a) => (a.empresa_id ? [a.empresa_id] : [])))];
  const [nPapeis, nEmpresas] = await Promise.all([
    tx.papel.count({ where: { id: { in: papeis } } }),
    tx.empresa.count({ where: { id: { in: empresas }, ativo: true, deleted_at: null } }),
  ]);
  if (atribuicoes.length === 0 || nPapeis !== papeis.length || nEmpresas !== empresas.length)
    throw new ErroDominio('transicao_invalida', {
      detail: 'Os papéis deste convite mudaram. Peça um convite novo.',
    });
}
