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
import { requestIdDa } from '../requisicao/request-id.js';
import type { ContextoDaRequisicao } from '../tx/contexto.js';
import { type Acesso, marcasDe } from './marcas.js';
import { permissoesPorEmpresa } from './permissoes.js';

// Guard global (plano docs/planos/f3-2-contexto-rbac.md): lê a marca da rota, valida o access
// token, revalida a sessão no banco em toda requisição e, nas rotas de domínio, resolve a
// empresa do X-Empresa-Id (SEG-3) e as permissões dela.

export const CABECALHO_EMPRESA = 'x-empresa-id';

export interface RequisicaoAutenticada extends Request {
  identidade: Identidade;
  contexto?: ContextoDaRequisicao;
}

const naoAutenticado = () => new ErroDominio('nao_autenticado');

function acessoDa(contexto: ExecutionContext): Acesso {
  const marcas = marcasDe(contexto.getHandler());
  const [acesso] = marcas;
  // Erro de programação, não do cliente: vira 500 e o teste de marcas barra no CI.
  if (marcas.length !== 1 || !acesso) {
    throw new Error(
      `Rota precisa de exatamente uma marca de acesso (@Publica, @SoAutenticado ou @Permissao): ` +
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
    // O formato do cabeçalho é conferido antes de ir ao banco.
    const empresaId = acesso.tipo === 'permissao' ? empresaDoCabecalho(req) : null;

    // O usuário é global: só o ebisu_auth lê. O resto fica sob o RLS da conta do token.
    const usuario = await this.auth.usuario.findUnique({
      where: { id: identidade.usuarioId },
      select: { ativo: true },
    });
    if (!usuario?.ativo) throw naoAutenticado();

    const permissoes = await comTenant(this.app, identidade.tenantId, async (tx) => {
      if (!(await this.sessaoAtiva(tx, identidade))) throw naoAutenticado();
      return empresaId ? this.permissoesNaEmpresa(tx, identidade.membroId, empresaId) : null;
    });
    req.identidade = identidade;
    if (acesso.tipo !== 'permissao' || !empresaId || !permissoes) return true;

    if (!permissoes.has(acesso.chave)) throw new ErroDominio('sem_permissao');
    req.contexto = {
      tenantId: identidade.tenantId,
      empresaId,
      membroId: identidade.membroId,
      apiKeyId: null,
      permissoes,
      requestId: requestIdDa(contexto.switchToHttp().getResponse<Response>()) ?? randomUUID(),
    };
    return true;
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
  if (!valor) throw new Error('@Contexto() só funciona em rota com @Permissao');
  return valor;
});
