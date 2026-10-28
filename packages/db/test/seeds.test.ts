import { randomUUID } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CATALOGO_PERMISSOES,
  CHAVES_PERMISSAO,
  CHECKLISTS,
  FUNIL_PADRAO,
  MODELOS_MENSAGEM,
  MOTIVOS_PERDA,
  ORIGENS_LEAD,
  PAPEIS_PADRAO,
  TIPOS_ACESSORIO,
  semearCatalogoPermissoes,
  semearPadroesEmpresa,
  semearDemo,
  semearPadroesTenant,
  SENHA_DEMO,
  TENANT_DEMO_ID,
} from '../src/seeds/index.js';
import { comTenant } from '../src/tenancy.js';
import { type BancoDeTeste, criarBancoDeTeste } from '../src/teste/banco-de-teste.js';

describe('dados de referência (puros)', () => {
  it('toda permissão de papel existe no catálogo, sem chaves repetidas', () => {
    expect(CHAVES_PERMISSAO.size).toBe(CATALOGO_PERMISSOES.length);
    for (const papel of PAPEIS_PADRAO) {
      for (const chave of Object.keys(papel.permissoes)) {
        expect(CHAVES_PERMISSAO.has(chave), `${papel.chave}: ${chave}`).toBe(true);
      }
    }
  });

  it('OWNER e ADMIN têm todas as permissões com escopo TENANT', () => {
    for (const chave of ['OWNER', 'ADMIN']) {
      const papel = PAPEIS_PADRAO.find((p) => p.chave === chave)!;
      expect(Object.keys(papel.permissoes).sort()).toEqual([...CHAVES_PERMISSAO].sort());
      expect(new Set(Object.values(papel.permissoes))).toEqual(new Set(['TENANT']));
    }
  });

  it('GERENTE tem lista fechada: tudo menos gestão de acesso e anonimização LGPD', () => {
    const gerente = PAPEIS_PADRAO.find((p) => p.chave === 'GERENTE')!;
    const fora = [
      'config.empresa',
      'config.membros',
      'config.rbac',
      'config.api_keys',
      'lgpd.anonimizar',
    ];
    expect(Object.keys(gerente.permissoes).sort()).toEqual(
      [...CHAVES_PERMISSAO].filter((c) => !fora.includes(c)).sort(),
    );
    expect(new Set(Object.values(gerente.permissoes))).toEqual(new Set(['EMPRESA']));
  });

  it('lgpd.anonimizar (irreversível) é só de OWNER e ADMIN', () => {
    const comAnonimizar = PAPEIS_PADRAO.filter((p) => 'lgpd.anonimizar' in p.permissoes).map(
      (p) => p.chave,
    );
    expect(comAnonimizar.sort()).toEqual(['ADMIN', 'OWNER']);
  });

  it('SEG-5: só papéis que lidam com custo recebem financeiro.ver_custos', () => {
    const comCusto = PAPEIS_PADRAO.filter((p) => 'financeiro.ver_custos' in p.permissoes).map(
      (p) => p.chave,
    );
    expect(comCusto.sort()).toEqual(['ADMIN', 'ESTOQUISTA', 'FINANCEIRO', 'GERENTE', 'OWNER']);
  });

  it.each(CHECKLISTS.map((c) => [c.nome, c] as const))(
    'checklist %s é consistente',
    (_, checklist) => {
      const chaves = checklist.itens.map((i) => i.chave);
      expect(new Set(chaves).size).toBe(chaves.length);
      for (const item of checklist.itens) {
        if (item.tipo_resposta === 'OPCOES') expect(item.opcoes?.length).toBeGreaterThan(1);
        if (item.depende_de) expect(chaves).toContain(item.depende_de.chave);
      }
    },
  );

  it('funil padrão: ordens únicas, uma etapa de cada tipo final e um modelo por evento/canal', () => {
    const ordens = FUNIL_PADRAO.etapas.map((e) => e.ordem);
    expect(new Set(ordens).size).toBe(ordens.length);
    for (const tipo of ['GANHO', 'PERDIDO', 'NUTRICAO']) {
      expect(FUNIL_PADRAO.etapas.filter((e) => e.tipo === tipo)).toHaveLength(1);
    }
    const pares = MODELOS_MENSAGEM.map((m) => `${m.evento}/${m.canal}`);
    expect(new Set(pares).size).toBe(pares.length);
  });
});

describe('semeadura no banco', () => {
  let banco: BancoDeTeste;
  let admin: PrismaClient;
  let app: PrismaClient;
  const tenants = [randomUUID(), randomUUID()] as const;
  const empresas = [randomUUID(), randomUUID()] as const;

  const totalPermissoesDePapeis = PAPEIS_PADRAO.reduce(
    (n, p) => n + Object.keys(p.permissoes).length,
    0,
  );
  const totalRequisitos = FUNIL_PADRAO.etapas.reduce((n, e) => n + e.requisitos.length, 0);

  beforeAll(async () => {
    banco = await criarBancoDeTeste();
    admin = new PrismaClient({ datasourceUrl: banco.urlAdmin });
    app = new PrismaClient({ datasourceUrl: banco.urlDoPapel('ebisu_app') });
    for (const [i, tenantId] of tenants.entries()) {
      await comTenant(admin, tenantId, async (tx) => {
        await tx.tenant.create({ data: { id: tenantId, nome: `T${i}`, slug: `t-${tenantId}` } });
        await tx.empresa.create({
          data: {
            id: empresas[i]!,
            tenant_id: tenantId,
            razao_social: 'Empresa',
            nome_fantasia: 'E',
          },
        });
      });
    }
  });

  afterAll(async () => {
    await Promise.all([admin?.$disconnect(), app?.$disconnect()]);
    await banco?.container.stop();
  });

  // Conta como ebisu_app (sob RLS): o admin do container é superusuário e ignora o RLS.
  const contar = (tenantId: string, empresaId: string) =>
    comTenant(app, tenantId, async (tx) => ({
      papeis: await tx.papel.count(),
      papelPermissoes: await tx.papelPermissao.count(),
      tiposAcessorio: await tx.tipoAcessorio.count(),
      checklists: await tx.checklistModelo.count(),
      origens: await tx.origemLead.count({ where: { empresa_id: empresaId } }),
      motivos: await tx.motivoPerda.count({ where: { empresa_id: empresaId } }),
      modelos: await tx.modeloMensagem.count({ where: { empresa_id: empresaId } }),
      funis: await tx.funil.count({ where: { empresa_id: empresaId, padrao: true } }),
      etapas: await tx.etapaFunil.count({ where: { funil: { empresa_id: empresaId } } }),
      requisitos: await tx.requisitoEtapa.count({
        where: { etapa: { funil: { empresa_id: empresaId } } },
      }),
    }));

  const esperado = {
    papeis: PAPEIS_PADRAO.length,
    papelPermissoes: totalPermissoesDePapeis,
    tiposAcessorio: TIPOS_ACESSORIO.length,
    checklists: CHECKLISTS.length,
    origens: ORIGENS_LEAD.length,
    motivos: MOTIVOS_PERDA.length,
    modelos: MODELOS_MENSAGEM.length,
    funis: 1,
    etapas: FUNIL_PADRAO.etapas.length,
    requisitos: totalRequisitos,
  };

  it('catálogo de permissões é idempotente', async () => {
    expect(await semearCatalogoPermissoes(admin)).toBe(CATALOGO_PERMISSOES.length);
    await semearCatalogoPermissoes(admin);
    expect(await admin.permissao.count()).toBe(CATALOGO_PERMISSOES.length);
  });

  it('ebisu_app semeia os padrões do tenant e da empresa dentro de comTenant', async () => {
    await comTenant(app, tenants[0], async (tx) => {
      await semearPadroesTenant(tx, tenants[0]);
      await semearPadroesEmpresa(tx, tenants[0], empresas[0]);
    });
    expect(await contar(tenants[0], empresas[0])).toEqual(esperado);
  });

  it('rodar de novo não duplica nada (idempotente)', async () => {
    await comTenant(app, tenants[0], async (tx) => {
      await semearPadroesTenant(tx, tenants[0]);
      await semearPadroesEmpresa(tx, tenants[0], empresas[0]);
    });
    expect(await contar(tenants[0], empresas[0])).toEqual(esperado);
  });

  it('SEG-1: semear outro tenant não altera o primeiro', async () => {
    await comTenant(app, tenants[1], async (tx) => {
      await semearPadroesTenant(tx, tenants[1]);
      await semearPadroesEmpresa(tx, tenants[1], empresas[1]);
    });
    expect(await contar(tenants[1], empresas[1])).toEqual(esperado);
    expect(await contar(tenants[0], empresas[0])).toEqual(esperado);
  });

  it('seed de demonstração cria a base uma vez só (idempotente)', async () => {
    const primeira = await semearDemo(admin);
    expect(primeira).toMatchObject({ criado: true, empresas: 2, contatos: 30 });
    expect(await semearDemo(admin)).toEqual({ criado: false, tenantId: TENANT_DEMO_ID });
  });

  it('usuários de demonstração ganham a senha de dev, também num banco já semeado', async () => {
    const demo = { email: { endsWith: '@demo.ebisu.local' } };
    const senhasOk = async () => {
      const usuarios = await admin.usuario.findMany({ where: demo, select: { senha_hash: true } });
      expect(usuarios).toHaveLength(PAPEIS_PADRAO.length);
      for (const { senha_hash } of usuarios) {
        expect(senha_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
        expect(await verify(senha_hash!, SENHA_DEMO)).toBe(true);
      }
    };
    await semearDemo(admin);
    await senhasOk();
    // Banco semeado antes do F3: usuários sem senha. Rodar o seed de novo grava a senha.
    await admin.usuario.updateMany({ where: demo, data: { senha_hash: null } });
    const fora = await admin.usuario.create({
      data: { email: 'fora-da-demo@exemplo.local', nome: 'Fora' },
    });
    expect(await semearDemo(admin)).toEqual({ criado: false, tenantId: TENANT_DEMO_ID });
    await senhasOk();
    // Só os usuários de demonstração: nenhum outro recebe a senha conhecida.
    const depois = await admin.usuario.findUniqueOrThrow({ where: { id: fora.id } });
    expect(depois.senha_hash).toBeNull();
  });

  it('seed de demonstração é coerente com as regras (CRM-2, CRM-4, DSP-2)', async () => {
    const r = await comTenant(app, TENANT_DEMO_ID, async (tx) => ({
      membros: await tx.membro.count({ where: { status: 'ATIVO' } }),
      contatos: await tx.contato.count(),
      negocios: await tx.negocio.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      perdidosSemMotivo: await tx.negocio.count({
        where: { status: 'PERDIDO', motivo_perda_id: null },
      }),
      // Diagnóstico exige dispositivo; o dono atual tem exatamente um vínculo vigente.
      diagnosticoSemDispositivo: await tx.negocio.count({
        where: { etapa: { nome: 'Diagnóstico / Orçamento' }, dispositivo_id: null },
      }),
      dispositivos: await tx.dispositivo.findMany({
        select: {
          proprietario_atual_id: true,
          proprietarios: { where: { ate: null }, select: { contato_id: true } },
        },
      }),
      // LEAD_QUALIFICADO = requisitos da Qualificação atendidos: canal preferido + consentimento.
      qualificadosSemConsentimento: await tx.contato.count({
        where: {
          ciclo_vida: 'LEAD_QUALIFICADO',
          OR: [{ canal_preferido: null }, { consentimentos: { none: { concedido: true } } }],
        },
      }),
      funisPadrao: await tx.funil.count({ where: { padrao: true } }),
    }));
    expect(r.membros).toBe(PAPEIS_PADRAO.length);
    expect(r.contatos).toBe(30);
    expect(r.negocios.map((n) => [n.status, n._count])).toEqual([
      ['ABERTO', 25],
      ['PERDIDO', 2],
      ['NUTRICAO', 3],
    ]);
    expect(r.perdidosSemMotivo).toBe(0);
    expect(r.diagnosticoSemDispositivo).toBe(0);
    expect(r.dispositivos).toHaveLength(6);
    for (const d of r.dispositivos) {
      expect(d.proprietarios).toEqual([{ contato_id: d.proprietario_atual_id }]);
    }
    expect(r.qualificadosSemConsentimento).toBe(0);
    expect(r.funisPadrao).toBe(2);
  });

  it('SEG-1: o RLS impede semear com o contexto de outro tenant', async () => {
    await expect(
      comTenant(app, tenants[0], (tx) => semearPadroesEmpresa(tx, tenants[1], empresas[1])),
    ).rejects.toThrow();
  });
});
