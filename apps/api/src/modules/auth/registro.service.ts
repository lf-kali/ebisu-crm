import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type EntradaRegistro, normalizarCnpj } from '@ebisu/contracts';
import {
  comTenant,
  Prisma,
  type PrismaClient,
  semearPadroesEmpresa,
  semearPadroesTenant,
} from '@ebisu/db';
import { PRISMA_APP, PRISMA_AUTH } from '../../core/banco/banco.module.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { senhasVazadas, validarSenha } from './politica-senha.js';
import { gerarHashSenha, verificarSenha } from './senha.js';
import {
  normalizarEmail,
  type Origem,
  type SessaoEmitida,
  SessoesService,
} from './sessoes.service.js';

// Cadastro de conta (plano docs/planos/f3-4a-cadastro-empresas.md). Duas transações, uma por
// papel de banco (SEG-6): o usuário pelo ebisu_auth e a conta pelo ebisu_app. Se a segunda
// falha, sobra um usuário sem conta, que não entra; repetir o cadastro com a mesma senha conclui
// (decisão 6).

/** Quem faz o cadastro: a origem da sessão e o request_id do audit log. */
export interface OrigemDoCadastro extends Origem {
  requestId: string;
}

const TAMANHO_SLUG = 50;
/**
 * Tentativas de slug. Cada colisão quer dizer que outro cadastro com o mesmo nome terminou antes,
 * então N cadastros simultâneos com o mesmo nome precisam de até N tentativas.
 */
const TENTATIVAS_SLUG = 5;

/** "Assistência São José" vira "assistencia-sao-jose". */
export function slugDe(nome: string): string {
  const slug = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, TAMANHO_SLUG)
    .replace(/^-+|-+$/g, '');
  return slug || 'conta';
}

/**
 * Violação de unicidade no modelo. Pelo modelo, não pela coluna: dentro da transação do ebisu_app
 * o Prisma não informa a coluna (`meta.target` vem nulo). Em `tenant`, o único valor que colide é
 * o slug (o id é um UUID aleatório); em `usuario`, o e-mail.
 */
const violouUnicidade = (erro: unknown, modelo: 'Tenant' | 'Usuario') =>
  erro instanceof Prisma.PrismaClientKnownRequestError &&
  erro.code === 'P2002' &&
  erro.meta?.modelName === modelo;

@Injectable()
export class RegistroService {
  constructor(
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(PRISMA_APP) private readonly app: PrismaClient,
    private readonly sessoes: SessoesService,
  ) {
    // Sem a lista de senhas vazadas a API não sobe (politica-senha.ts).
    senhasVazadas();
  }

  async registrar(entrada: EntradaRegistro, origem: OrigemDoCadastro): Promise<SessaoEmitida> {
    const email = normalizarEmail(entrada.email);
    validarSenha(entrada.senha, { email, nome: entrada.nome });
    const usuarioId = await this.usuarioDoCadastro(email, entrada);
    const tenantId = await this.criarConta(usuarioId, entrada, origem);
    return this.sessoes.abrirNaConta(usuarioId, tenantId, origem);
  }

  /**
   * Usuário novo, ou o existente se a senha for a dele (decisão 4). E-mail existente com outra
   * senha, ou usuário inativo, dá 401, como no login.
   */
  private async usuarioDoCadastro(email: string, entrada: EntradaRegistro): Promise<string> {
    const existente = await this.auth.usuario.findUnique({ where: { email } });
    if (existente) {
      const confere = await verificarSenha(
        existente.ativo ? existente.senha_hash : null,
        entrada.senha,
      );
      if (!existente.ativo || !confere) throw new ErroDominio('nao_autenticado');
      return existente.id;
    }
    try {
      const { id } = await this.auth.usuario.create({
        data: { email, nome: entrada.nome, senha_hash: await gerarHashSenha(entrada.senha) },
        select: { id: true },
      });
      return id;
    } catch (erro) {
      // Dois cadastros simultâneos do mesmo e-mail: o segundo segue como e-mail existente.
      if (violouUnicidade(erro, 'Usuario')) return this.usuarioDoCadastro(email, entrada);
      throw erro;
    }
  }

  private async criarConta(
    usuarioId: string,
    entrada: EntradaRegistro,
    origem: OrigemDoCadastro,
  ): Promise<string> {
    for (let tentativa = 1; ; tentativa++) {
      const slug = await this.slugLivre(slugDe(entrada.conta.nome));
      try {
        return await this.gravarConta(usuarioId, slug, entrada, origem);
      } catch (erro) {
        if (tentativa < TENTATIVAS_SLUG && violouUnicidade(erro, 'Tenant')) continue;
        throw erro;
      }
    }
  }

  /**
   * O slug base, ou com sufixo numérico (`-2`, `-3`...) se já existir. O slug é único no sistema,
   * e só o ebisu_auth enxerga as outras contas.
   */
  private async slugLivre(base: string): Promise<string> {
    const usados = new Set(
      (
        await this.auth.tenant.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((t) => t.slug),
    );
    if (!usados.has(base)) return base;
    for (let sufixo = 2; ; sufixo++) {
      const candidato = `${base}-${sufixo}`;
      if (!usados.has(candidato)) return candidato;
    }
  }

  /**
   * Conta em teste, primeira empresa, padrões e o dono, numa transação com o tenant novo no
   * contexto (decisão 7). O membro é criado logo depois do tenant: é o autor do audit log.
   */
  private gravarConta(
    usuarioId: string,
    slug: string,
    entrada: EntradaRegistro,
    origem: OrigemDoCadastro,
  ): Promise<string> {
    const tenantId = randomUUID();
    const membroId = randomUUID();
    const ator = { membroId, requestId: origem.requestId, ip: origem.ip ?? null };
    return comTenant(
      this.app,
      tenantId,
      async (tx) => {
        await tx.tenant.create({
          data: { id: tenantId, nome: entrada.conta.nome, slug, status: 'TRIAL' },
        });
        await tx.membro.create({
          data: { id: membroId, tenant_id: tenantId, usuario_id: usuarioId, status: 'ATIVO' },
        });
        const { cnpj, ...empresa } = entrada.empresa;
        const { id: empresaId } = await tx.empresa.create({
          data: { tenant_id: tenantId, ...empresa, cnpj: cnpj ? normalizarCnpj(cnpj) : null },
          select: { id: true },
        });
        const { papeis } = await semearPadroesTenant(tx, tenantId);
        await semearPadroesEmpresa(tx, tenantId, empresaId);
        await tx.atribuicaoPapel.create({
          data: {
            tenant_id: tenantId,
            membro_id: membroId,
            papel_id: papeis.OWNER!,
            empresa_id: null,
          },
        });
        return tenantId;
      },
      { ator, timeout: 15_000 },
    );
  }
}
