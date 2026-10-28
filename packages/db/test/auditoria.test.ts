import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comTenant } from '../src/tenancy.js';
import { type BancoDeTeste, criarBancoDeTeste } from '../src/teste/banco-de-teste.js';

// Audit log automático por trigger (plano docs/planos/f3-3b-audit-log.md; SEG-8).

/** Fora do trigger, de propósito (decisão 6 do plano). Tabela nova: entra no trigger ou aqui. */
const FORA_DA_AUDITORIA = [
  'tenant',
  'usuario',
  'refresh_token',
  'permissao',
  'audit_log',
  'idempotencia_requisicao',
  'sequencia_documento',
  'notificacao',
  'job_lote',
  'historico_etapa_negocio',
  'orcamento_status_historico',
  'os_status_historico',
  'dispositivo_evento',
  'movimento_estoque',
  'pagamento',
];

const T1 = randomUUID();
const T2 = randomUUID();
const EMPRESA = randomUUID();
const MEMBRO = randomUUID();
const PAPEL = randomUUID();
const ATOR = { membroId: MEMBRO, requestId: 'req-auditoria-1', ip: '203.0.113.7' };

interface LinhaAudit {
  tenant_id: string;
  empresa_id: string | null;
  ator_membro_id: string | null;
  ator_api_key_id: string | null;
  entidade_tipo: string;
  entidade_id: string;
  acao: string;
  diff: { campos: string[] } | null;
  ip: string | null;
  request_id: string | null;
}

describe('audit log automático (trigger auditar) — SEG-8', () => {
  let banco: BancoDeTeste;
  let admin: pg.Client;
  let app: PrismaClient;

  const auditoria = async (entidadeId: string) =>
    (
      await admin.query<LinhaAudit>(
        `SELECT tenant_id, empresa_id, ator_membro_id, ator_api_key_id, entidade_tipo,
                entidade_id, acao, diff, ip, request_id
           FROM audit_log WHERE entidade_id = $1 ORDER BY ocorreu_em, acao`,
        [entidadeId],
      )
    ).rows;

  const novoContato = (dados: { nome: string; email: string; telefone?: string }) =>
    comTenant(
      app,
      T1,
      (tx) =>
        tx.contato.create({
          data: {
            tenant_id: T1,
            empresa_id: EMPRESA,
            nome: dados.nome,
            email: dados.email,
            telefone_e164: dados.telefone ?? null,
            campos_faltantes: [],
          },
        }),
      { ator: ATOR },
    );

  beforeAll(async () => {
    banco = await criarBancoDeTeste();
    admin = await banco.conectar(banco.urlAdmin);
    for (const t of [T1, T2])
      await admin.query(
        `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', $2, now())`,
        [t, `t-${t}`],
      );
    await admin.query(
      `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, updated_at)
       VALUES ($1, $2, 'Empresa', 'E', now())`,
      [EMPRESA, T1],
    );
    const usuario = randomUUID();
    await admin.query(
      `INSERT INTO usuario (id, email, nome, updated_at) VALUES ($1, $2, 'U', now())`,
      [usuario, `${usuario}@teste.local`],
    );
    await admin.query(
      `INSERT INTO membro (id, tenant_id, usuario_id, status, updated_at) VALUES ($1, $2, $3, 'ATIVO', now())`,
      [MEMBRO, T1, usuario],
    );
    await admin.query(
      `INSERT INTO papel (id, tenant_id, chave, nome, updated_at) VALUES ($1, $2, 'P', 'P', now())`,
      [PAPEL, T1],
    );
    await admin.query(
      `INSERT INTO permissao (chave, recurso, acao, descricao) VALUES ('contato.read', 'contato', 'read', 't')`,
    );
    app = new PrismaClient({ datasourceUrl: banco.urlDoPapel('ebisu_app') });
  }, 180_000);

  afterAll(async () => {
    await Promise.all([app?.$disconnect(), admin?.end()]);
    await banco?.container.stop();
  });

  it('create grava autor, requisição, empresa e só os NOMES das colunas', async () => {
    const valores = {
      nome: 'Fulana Secreta',
      email: 'fulana@segredo.local',
      telefone: '+5511999990000',
    };
    const contato = await novoContato(valores);
    const [linha, ...resto] = await auditoria(contato.id);
    expect(resto).toEqual([]);
    expect(linha).toMatchObject({
      tenant_id: T1,
      empresa_id: EMPRESA,
      ator_membro_id: MEMBRO,
      ator_api_key_id: null,
      entidade_tipo: 'contato',
      entidade_id: contato.id,
      acao: 'create',
      ip: ATOR.ip,
      request_id: ATOR.requestId,
    });
    expect(linha!.diff!.campos).toEqual(
      expect.arrayContaining(['email', 'empresa_id', 'id', 'nome', 'telefone_e164', 'tenant_id']),
    );
    // Colunas nulas não entram no create.
    expect(linha!.diff!.campos).not.toContain('documento');
    // SEG-8: nenhum valor gravado aparece na auditoria.
    const tudo = JSON.stringify(await auditoria(contato.id));
    for (const valor of Object.values(valores)) expect(tudo).not.toContain(valor);
  });

  it('update grava só as colunas que mudaram (sem updated_at); update sem mudança não grava', async () => {
    const contato = await novoContato({ nome: 'Antes', email: 'antes@teste.local' });
    await comTenant(
      app,
      T1,
      (tx) => tx.contato.update({ where: { id: contato.id }, data: { nome: 'Depois' } }),
      { ator: ATOR },
    );
    await comTenant(
      app,
      T1,
      (tx) => tx.contato.update({ where: { id: contato.id }, data: { nome: 'Depois' } }),
      { ator: ATOR },
    );
    const linhas = await auditoria(contato.id);
    expect(linhas.map((l) => l.acao)).toEqual(['create', 'update']);
    expect(linhas[1]!.diff).toEqual({ campos: ['nome'] });
  });

  it('soft delete vira delete; anonimizado_em vira anonimizar; DELETE físico vira delete sem diff', async () => {
    const mole = await novoContato({ nome: 'Mole', email: 'mole@teste.local' });
    await comTenant(app, T1, (tx) =>
      tx.contato.update({ where: { id: mole.id }, data: { deleted_at: new Date() } }),
    );
    const anon = await novoContato({ nome: 'Anon', email: 'anon@teste.local' });
    await comTenant(app, T1, (tx) =>
      tx.contato.update({ where: { id: anon.id }, data: { anonimizado_em: new Date() } }),
    );
    const duro = await novoContato({ nome: 'Duro', email: 'duro@teste.local' });
    await comTenant(app, T1, (tx) => tx.contato.delete({ where: { id: duro.id } }));

    expect((await auditoria(mole.id))[1]).toMatchObject({
      acao: 'delete',
      diff: { campos: ['deleted_at'] },
    });
    expect((await auditoria(anon.id))[1]).toMatchObject({ acao: 'anonimizar' });
    const fisico = (await auditoria(duro.id))[1]!;
    expect(fisico).toMatchObject({ acao: 'delete', diff: null });
  });

  it('mudança de status vira status_change', async () => {
    await comTenant(app, T1, (tx) =>
      tx.membro.update({ where: { id: MEMBRO }, data: { status: 'SUSPENSO' } }),
    );
    const ultima = (await auditoria(MEMBRO)).at(-1)!;
    expect(ultima).toMatchObject({ acao: 'status_change', entidade_tipo: 'membro' });
    expect(ultima.diff!.campos).toContain('status');
  });

  it('sem autor (seed, job): grava a auditoria com ator nulo', async () => {
    const contato = await comTenant(app, T1, (tx) =>
      tx.contato.create({
        data: {
          tenant_id: T1,
          empresa_id: EMPRESA,
          nome: 'Sem ator',
          email: 'semator@teste.local',
          campos_faltantes: [],
        },
      }),
    );
    expect((await auditoria(contato.id))[0]).toMatchObject({
      ator_membro_id: null,
      request_id: null,
      ip: null,
    });
  });

  it('o autor não vaza para a próxima transação da mesma conexão', async () => {
    await novoContato({ nome: 'Com ator', email: 'comator@teste.local' });
    const depois = await comTenant(app, T1, (tx) =>
      tx.contato.create({
        data: {
          tenant_id: T1,
          empresa_id: EMPRESA,
          nome: 'Depois do ator',
          email: 'depois@teste.local',
          campos_faltantes: [],
        },
      }),
    );
    expect((await auditoria(depois.id))[0]!.ator_membro_id).toBeNull();
  });

  it('tabela filha sem tenant_id usa o tenant da transação', async () => {
    const funil = randomUUID();
    const etapa = randomUUID();
    await comTenant(app, T1, async (tx) => {
      await tx.funil.create({
        data: { id: funil, tenant_id: T1, empresa_id: EMPRESA, nome: 'Vendas' },
      });
      await tx.etapaFunil.create({
        data: { id: etapa, funil_id: funil, nome: 'Novo', ordem: 1, tipo: 'ABERTA' },
      });
    });
    expect((await auditoria(etapa))[0]).toMatchObject({
      tenant_id: T1,
      entidade_tipo: 'etapa_funil',
      acao: 'create',
    });
  });

  it('papel_permissao (sem id) é auditada pelo papel', async () => {
    await comTenant(app, T1, (tx) =>
      tx.papelPermissao.create({
        data: { papel_id: PAPEL, permissao_chave: 'contato.read', escopo: 'EMPRESA' },
      }),
    );
    const linhas = (await auditoria(PAPEL)).filter((l) => l.entidade_tipo === 'papel_permissao');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.diff!.campos).toEqual(['escopo', 'papel_id', 'permissao_chave']);
  });

  it('uma conta não lê nem grava auditoria de outra (RLS)', async () => {
    const contato = await novoContato({ nome: 'Isolado', email: 'isolado@teste.local' });
    const vistas = await comTenant(app, T2, (tx) =>
      tx.auditLog.count({ where: { entidade_id: contato.id } }),
    );
    expect(vistas).toBe(0);
    await expect(
      comTenant(app, T2, (tx) =>
        tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenant_id: T1,
            entidade_tipo: 'contato',
            entidade_id: contato.id,
            acao: 'update',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('o tenant gravado é o da linha, mesmo com outro tenant no contexto da transação', async () => {
    // Só uma escrita privilegiada (fora do RLS) chega aqui; a aplicação sempre tem os dois iguais.
    const contato = randomUUID();
    await admin.query('BEGIN');
    try {
      await admin.query(`SELECT set_config('app.tenant_id', $1, true)`, [T2]);
      await admin.query(
        `INSERT INTO contato (id, tenant_id, empresa_id, nome, email, updated_at)
         VALUES ($1, $2, $3, 'Privilegiado', 'priv@teste.local', now())`,
        [contato, T1, EMPRESA],
      );
      await admin.query('COMMIT');
    } catch (erro) {
      await admin.query('ROLLBACK');
      throw erro;
    }
    expect((await auditoria(contato))[0]).toMatchObject({ tenant_id: T1, acao: 'create' });
  });

  it('uma tabela temporária "audit_log" na sessão não desvia a auditoria (search_path fixo)', async () => {
    const contato = randomUUID();
    await comTenant(app, T1, async (tx) => {
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE audit_log (LIKE public.audit_log INCLUDING DEFAULTS) ON COMMIT DROP',
      );
      await tx.contato.create({
        data: {
          id: contato,
          tenant_id: T1,
          empresa_id: EMPRESA,
          nome: 'Desvio',
          email: 'desvio@teste.local',
          campos_faltantes: [],
        },
      });
    });
    expect(await auditoria(contato)).toHaveLength(1);
  });

  it('autor com id que não é UUID é recusado antes de qualquer escrita', async () => {
    await expect(
      comTenant(app, T1, async () => undefined, { ator: { membroId: "x'; DROP" } }),
    ).rejects.toThrow(/ator com id inválido/);
  });

  it('toda tabela do schema está no trigger ou na lista de fora, nunca nos dois', async () => {
    const { rows: tabelas } = await admin.query<{ nome: string }>(
      `SELECT table_name AS nome FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'`,
    );
    const { rows: comTrigger } = await admin.query<{ nome: string }>(
      `SELECT c.relname AS nome FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = 'auditoria' AND NOT t.tgisinternal`,
    );
    const auditadas = new Set(comTrigger.map((r) => r.nome));
    const fora = new Set(FORA_DA_AUDITORIA);
    const semDecisao = tabelas.map((t) => t.nome).filter((t) => !auditadas.has(t) && !fora.has(t));
    expect(semDecisao).toEqual([]);
    expect([...auditadas].filter((t) => fora.has(t))).toEqual([]);
    expect(auditadas.size + fora.size).toBe(tabelas.length);
  });
});
