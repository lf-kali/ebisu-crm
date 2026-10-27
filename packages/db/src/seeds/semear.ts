import type { $Enums, Prisma, PrismaClient } from '@prisma/client';
import { CATALOGO_PERMISSOES } from './catalogo-permissoes.js';
import { FUNIL_PADRAO, MODELOS_MENSAGEM, MOTIVOS_PERDA, ORIGENS_LEAD } from './padroes-empresa.js';
import { PAPEIS_PADRAO } from './papeis-padrao.js';
import { CHECKLISTS, TIPOS_ACESSORIO } from './padroes-tenant.js';

// Todas as funções são idempotentes: rodar de novo não duplica nem altera o que já existe.
// Elas NÃO convergem: um tenant já semeado não recebe mudanças posteriores nos padrões
// (permissão nova ou revogada, item de checklist etc.). Mudança de papel padrão em tenants
// existentes exige migração de dados própria. Execuções concorrentes no mesmo tenant: uma
// vence e as demais falham por unicidade (rollback, sem duplicar) — quem chama deve repetir.

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Catálogo global de permissões. Roda com o papel migrador (`pnpm db:seed`). */
export async function semearCatalogoPermissoes(cliente: Cliente): Promise<number> {
  for (const { chave, descricao } of CATALOGO_PERMISSOES) {
    const [recurso, acao] = chave.split('.') as [string, string];
    await cliente.permissao.upsert({
      where: { chave },
      create: { chave, recurso, acao, descricao },
      update: { descricao },
    });
  }
  return CATALOGO_PERMISSOES.length;
}

/**
 * Papéis padrão, tipos de acessório e checklists de um tenant.
 * Deve rodar dentro de `comTenant` (o RLS exige o contexto). Não lê a tabela permissao:
 * funciona com o papel ebisu_app, que não tem acesso a ela.
 */
export async function semearPadroesTenant(tx: Prisma.TransactionClient, tenantId: string) {
  const papeis: Record<string, string> = {};
  for (const papel of PAPEIS_PADRAO) {
    const { id } = await tx.papel.upsert({
      where: { tenant_id_chave: { tenant_id: tenantId, chave: papel.chave } },
      create: {
        tenant_id: tenantId,
        chave: papel.chave,
        nome: papel.nome,
        descricao: papel.descricao,
        sistema: true,
      },
      update: {},
      select: { id: true },
    });
    papeis[papel.chave] = id;
    await tx.papelPermissao.createMany({
      data: Object.entries(papel.permissoes).map(([permissao_chave, escopo]) => ({
        papel_id: id,
        permissao_chave,
        escopo,
      })),
      skipDuplicates: true,
    });
  }

  await tx.tipoAcessorio.createMany({
    data: TIPOS_ACESSORIO.map(({ nome, categoria, atributos }) => ({
      tenant_id: tenantId,
      nome,
      categoria,
      ...Object.fromEntries(atributos.map((atributo) => [atributo, true])),
    })),
    skipDuplicates: true,
  });

  for (const checklist of CHECKLISTS) {
    const { nome, tipo_dispositivo, momento } = checklist;
    const existente = await tx.checklistModelo.findFirst({
      where: { tenant_id: tenantId, nome, tipo_dispositivo, momento },
      select: { id: true },
    });
    if (!existente) {
      await tx.checklistModelo.create({
        data: {
          tenant_id: tenantId,
          nome,
          tipo_dispositivo,
          momento,
          itens: checklist.itens as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  return { papeis };
}

/** Origens, motivos de perda, funil padrão e modelos de mensagem de uma empresa. */
export async function semearPadroesEmpresa(
  tx: Prisma.TransactionClient,
  tenantId: string,
  empresaId: string,
) {
  const daEmpresa = { tenant_id: tenantId, empresa_id: empresaId };

  await tx.origemLead.createMany({
    data: ORIGENS_LEAD.map(({ nome, tipo }) => ({
      ...daEmpresa,
      nome,
      tipo: tipo as $Enums.TipoOrigem,
    })),
    skipDuplicates: true,
  });
  await tx.motivoPerda.createMany({
    data: MOTIVOS_PERDA.map((nome) => ({ ...daEmpresa, nome })),
    skipDuplicates: true,
  });
  await tx.modeloMensagem.createMany({
    data: MODELOS_MENSAGEM.map(({ evento, ...modelo }) => ({
      ...daEmpresa,
      ...modelo,
      evento: evento as $Enums.EventoNotificacao,
    })),
    skipDuplicates: true,
  });

  // CRM-5: no máximo um funil padrão por empresa (índice parcial funil_padrao_uq).
  const existente = await tx.funil.findFirst({
    where: { empresa_id: empresaId, padrao: true },
    select: { id: true },
  });
  if (existente) return { funilId: existente.id };

  const funil = await tx.funil.create({
    data: {
      ...daEmpresa,
      nome: FUNIL_PADRAO.nome,
      padrao: true,
      etapas: {
        create: FUNIL_PADRAO.etapas.map(({ requisitos, ...etapa }) => ({
          ...etapa,
          requisitos: {
            create: requisitos.map((requisito, ordem) => ({ ...requisito, ordem })),
          },
        })),
      },
    },
    select: { id: true },
  });
  return { funilId: funil.id };
}
