import { randomUUID } from 'node:crypto';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Uuid } from '@ebisu/contracts';
import { comTenant, type Prisma, type PrismaClient } from '@ebisu/db';
import type { Request, Response } from 'express';
import { STATUS_CONTA_ATIVA } from '../../modules/auth/sessoes.service.js';
import {
  type Identidade,
  TOKENS_DE_ACESSO,
  type TokensDeAcesso,
} from '../../modules/auth/tokens.js';
import { PRISMA_APP, PRISMA_AUTH } from '../banco/banco.module.js';
import { ErroDominio } from '../erros/erro-dominio.js';
import { idempotenciaDa } from '../idempotencia/idempotencia.js';
import { requestIdDa } from '../requisicao/request-id.js';
import type { ContextoDaConta, ContextoDaRequisicao } from '../tx/contexto.js';
import { type Acesso, marcasDe } from './marcas.js';
import { permissoesPorEmpresa } from './permissoes.js';

// Guard global (plano docs/planos/f3-2-contexto-rbac.md): lê a marca da rota, valida o access
// token, revalida a sessão no banco em toda requisição e, nas rotas de domínio, resolve a
// empresa do X-Empresa-Id (SEG-3) e as permissões dela.

export const CABECALHO_EMPRESA = 'x-empresa-id';

export interface RequisicaoAutenticada extends Request {
  identidade: Identidade;
  contexto?: ContextoDaRequisicao | ContextoDaConta;
}

const naoAutenticado = () => new ErroDominio('nao_autenticado');

function acessoDa(contexto: ExecutionContext): Acesso {
  const marcas = marcasDe(contexto.getHandler());
  const [acesso] = marcas;
  // Erro de programação, não do cliente: vira 500 e o teste de marcas barra no CI.
  if (marcas.length !== 1 || !acesso) {
    throw new Error(
      `Rota precisa de exatamente uma marca de acesso ` +
        `(@Publica, @SoAutenticado, @Permissao ou @PermissaoNaConta): ` +
        `${contexto.getClass().name}.${contexto.getHandler().name} tem ${marcas.length}`,
    );
  }
  return acesso;
}

function empresaDoCabecalho(req: Request): string {
  const valor = req.get(CABECALHO_EMPRESA);
  // Minúsculas: o banco compara uuid sem caixa, mas as atribuições são comparadas como texto.
  if (valor && Uuid.safeParse(valor).success) return valor.toLowerCase();
  throw new ErroDominio('validacao', {
    campos: [
      valor
        ? { campo: 'X-Empresa-Id', code: 'invalid_format', mensagem: 'UUID inválido.' }
        : { campo: 'X-Empresa-Id', code: 'invalid_type', mensagem: 'Campo obrigatório.' },
    ],
  });
}

@Injectable()
export class GuardaContexto implements CanActivate {
  constructor(
    @Inject(TOKENS_DE_ACESSO) private readonly tokens: TokensDeAcesso,
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(PRISMA_APP) private readonly app: PrismaClient,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const acesso = acessoDa(contexto);
    if (acesso.tipo === 'publica') return true;

    const req = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    const identidade = tipo === 'Bearer' && token ? await this.tokens.verificar(token) : null;
    if (!identidade) throw naoAutenticado();
    // O formato dos cabeçalhos é conferido antes de ir ao banco.
    const empresaId = acesso.tipo === 'permissao' ? empresaDoCabecalho(req) : null;
    // Todo POST de domínio, e da conta, é idempotente (plano f3-3a, decisão 1; f3-4a, decisão 8).
    const comPermissao = acesso.tipo === 'permissao' || acesso.tipo === 'conta';
    const idempotencia =
      comPermissao && req.method === 'POST'
        ? idempotenciaDa(req, empresaId, identidade.membroId)
        : undefined;

    // O usuário é global: só o ebisu_auth lê. O resto fica sob o RLS da conta do token.
    const usuario = await this.auth.usuario.findUnique({
      where: { id: identidade.usuarioId },
      select: { ativo: true },
    });
    if (!usuario?.ativo) throw naoAutenticado();

    const permissoes = await comTenant(this.app, identidade.tenantId, async (tx) => {
      if (!(await this.sessaoAtiva(tx, identidade))) throw naoAutenticado();
      if (acesso.tipo === 'conta') return this.permissoesNaConta(tx, identidade.membroId);
      return empresaId ? this.permissoesNaEmpresa(tx, identidade.membroId, empresaId) : null;
    });
    req.identidade = identidade;
    if (!comPermissao || !permissoes) return true;

    if (!permissoes.has(acesso.chave)) throw new ErroDominio('sem_permissao');
    const base = {
      tenantId: identidade.tenantId,
      membroId: identidade.membroId,
      apiKeyId: null,
      requestId: requestIdDa(contexto.switchToHttp().getResponse<Response>()) ?? randomUUID(),
      ip: req.ip ?? null,
      ...(idempotencia ? { idempotencia } : {}),
    };
    req.contexto =
      acesso.tipo === 'conta'
        ? { ...base, empresaId: null, permissoes: permissoes as Map<string, 'TENANT'> }
        : { ...base, empresaId: empresaId!, permissoes };
    return true;
  }

  /**
   * Permissões na conta inteira: só as de escopo TENANT, de papéis atribuídos a todas as empresas
   * (empresa_id nulo). Um papel atribuído a uma empresa só não vale para a conta, mesmo com TENANT.
   */
  private async permissoesNaConta(
    tx: Prisma.TransactionClient,
    membroId: string,
  ): Promise<Map<string, 'TENANT'>> {
    const atribuicoes = await tx.atribuicaoPapel.findMany({
      where: { membro_id: membroId, empresa_id: null },
      select: { papel: { select: { permissoes: { where: { escopo: 'TENANT' } } } } },
    });
    return new Map(
      atribuicoes.flatMap((a) =>
        a.papel.permissoes.map((p) => [p.permissao_chave, 'TENANT'] as const),
      ),
    );
  }

  /** Membro ATIVO, do mesmo usuário do token, numa conta em teste ou ativa (como no login). */
  private async sessaoAtiva(tx: Prisma.TransactionClient, identidade: Identidade) {
    const membro = await tx.membro.findUnique({
      where: { id: identidade.membroId },
      select: { usuario_id: true, status: true, tenant: { select: { id: true, status: true } } },
    });
    return (
      !!membro &&
      membro.status === 'ATIVO' &&
      membro.usuario_id === identidade.usuarioId &&
      membro.tenant.id === identidade.tenantId &&
      (STATUS_CONTA_ATIVA as readonly string[]).includes(membro.tenant.status)
    );
  }

  /** Permissões do membro na empresa; 403 se a empresa não está ativa ou não é atribuída a ele. */
  private async permissoesNaEmpresa(
    tx: Prisma.TransactionClient,
    membroId: string,
    empresaId: string,
  ) {
    // Empresa de outra conta não aparece (RLS): mesma resposta que empresa não atribuída.
    const empresa = await tx.empresa.findFirst({
      where: { id: empresaId, ativo: true },
      select: { id: true },
    });
    const atribuicoes = empresa
      ? await tx.atribuicaoPapel.findMany({
          where: { membro_id: membroId, OR: [{ empresa_id: empresaId }, { empresa_id: null }] },
          include: { papel: { include: { permissoes: true } } },
        })
      : [];
    const naEmpresa = permissoesPorEmpresa(
      [empresaId],
      atribuicoes.map((a) => ({
        empresaId: a.empresa_id,
        permissoes: a.papel.permissoes.map((p) => ({ chave: p.permissao_chave, escopo: p.escopo })),
      })),
    ).get(empresaId);
    if (!naEmpresa) throw new ErroDominio('empresa_nao_autorizada');
    return new Map(Object.entries(naEmpresa));
  }
}

/** Contexto validado da rota de domínio (só em rota com `@Permissao`). */
export const Contexto = createParamDecorator((_: unknown, contexto: ExecutionContext) => {
  const valor = contexto.switchToHttp().getRequest<RequisicaoAutenticada>().contexto;
  if (!valor?.empresaId) throw new Error('@Contexto() só funciona em rota com @Permissao');
  return valor;
});

/** Contexto validado da rota da conta (só em rota com `@PermissaoNaConta`). */
export const ContextoConta = createParamDecorator((_: unknown, contexto: ExecutionContext) => {
  const valor = contexto.switchToHttp().getRequest<RequisicaoAutenticada>().contexto;
  if (!valor || valor.empresaId !== null)
    throw new Error('@ContextoConta() só funciona em rota com @PermissaoNaConta');
  return valor;
});
