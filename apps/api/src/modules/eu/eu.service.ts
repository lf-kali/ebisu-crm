import { Inject, Injectable } from '@nestjs/common';
import type { EmpresaDoMembro, RespostaEu } from '@ebisu/contracts';
import { comTenant, type PrismaClient } from '@ebisu/db';
import { PRISMA_APP, PRISMA_AUTH } from '../../core/banco/banco.module.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { permissoesPorEmpresa } from '../../core/rbac/permissoes.js';
import type { Identidade } from '../auth/tokens.js';

@Injectable()
export class EuService {
  constructor(
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(PRISMA_APP) private readonly app: PrismaClient,
  ) {}

  async obter(identidade: Identidade): Promise<RespostaEu> {
    // usuario é global (só o ebisu_auth lê); o resto fica sob o RLS da conta do token.
    const usuario = await this.auth.usuario.findUnique({ where: { id: identidade.usuarioId } });
    if (!usuario?.ativo) throw new ErroDominio('nao_autenticado');

    return comTenant(this.app, identidade.tenantId, async (tx) => {
      const membro = await tx.membro.findUnique({
        where: { id: identidade.membroId },
        include: {
          atribuicoes: { include: { papel: { include: { permissoes: true } } } },
        },
      });
      // Token de um membro que saiu da conta ou foi suspenso não vale mais.
      if (!membro || membro.status !== 'ATIVO' || membro.usuario_id !== usuario.id)
        throw new ErroDominio('nao_autenticado');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: identidade.tenantId } });
      const empresas = await tx.empresa.findMany({
        where: { ativo: true },
        orderBy: { created_at: 'asc' },
      });

      const porEmpresa = permissoesPorEmpresa(
        empresas.map((e) => e.id),
        membro.atribuicoes.map((a) => ({
          empresaId: a.empresa_id,
          permissoes: a.papel.permissoes.map((p) => ({
            chave: p.permissao_chave,
            escopo: p.escopo,
          })),
        })),
      );
      const daResposta: EmpresaDoMembro[] = empresas
        .filter((e) => porEmpresa.has(e.id))
        .map((e) => ({
          id: e.id,
          nome_fantasia: e.nome_fantasia,
          razao_social: e.razao_social,
          logo_url: e.logo_url,
          permissoes: porEmpresa.get(e.id)!,
        }));

      return {
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          avatar_url: usuario.avatar_url,
        },
        membro: { id: membro.id, cargo: membro.cargo },
        conta: { tenant_id: tenant.id, nome: tenant.nome, slug: tenant.slug },
        empresas: daResposta,
      };
    });
  }
}
