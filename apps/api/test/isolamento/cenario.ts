import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type BancoDeTeste, criarBancoDeTeste } from '@ebisu/db/teste';
import { TOKENS_DE_ACESSO, type TokensDeAcesso } from '../../src/modules/auth/tokens.js';
import { criarAppDeTeste } from '../app-de-teste.js';
import { ContatosDeTesteController } from './contatos-de-teste.controller.js';

// Cenário da suíte de isolamento (F3-2), gravado pelo superusuário do container (ignora RLS).
//   Conta A (ATIVO): empresas A1 e A2 (ativas) e A3 (inativa).
//     m1    EDITOR em A1 e em A3 (inativa)  · m2 EDITOR em A2
//     mP    PROPRIO em A1 (lê e edita só o que é dele)
//     admin ADMIN em todas as empresas (TENANT), com contato.delete
//     vol   EDITOR em A1; os testes de revalidação mexem nele
//   Conta B (ATIVO): empresa B1, membro mB (ADMIN).
//   Conta C (ATIVO): empresa C1, membro mC; os testes de revalidação suspendem a conta.

const id = () => randomUUID();

export const IDS = {
  contas: { a: id(), b: id(), c: id() },
  empresas: { a1: id(), a2: id(), a3: id(), b1: id(), c1: id() },
  usuarios: { m1: id(), m2: id(), mP: id(), admin: id(), vol: id(), mB: id(), mC: id() },
  membros: { m1: id(), m2: id(), mP: id(), admin: id(), vol: id(), mB: id(), mC: id() },
  papeis: { editor: id(), proprio: id(), admin: id(), adminB: id(), editorC: id() },
  origens: { a1: id(), a2: id() },
  contatos: { a1DoP: id(), a1DoM1: id(), a2: id(), b1: id() },
};

export type Quem = keyof typeof IDS.membros;

const CONTAS_DO_MEMBRO: Record<Quem, keyof typeof IDS.contas> = {
  m1: 'a',
  m2: 'a',
  mP: 'a',
  admin: 'a',
  vol: 'a',
  mB: 'b',
  mC: 'c',
};

export interface CenarioIsolamento {
  banco: BancoDeTeste;
  app: INestApplication;
  /** Access token válido do membro (emitido direto, sem login). */
  token(quem: Quem): Promise<string>;
  sql(texto: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  fechar(): Promise<void>;
}

export async function criarCenarioIsolamento(): Promise<CenarioIsolamento> {
  const banco = await criarBancoDeTeste();
  const admin = await banco.conectar(banco.urlAdmin);
  const sql = (texto: string, params: unknown[] = []) => admin.query(texto, params);
  const { contas, empresas, usuarios, membros, papeis, origens, contatos } = IDS;

  for (const chave of ['contato.read', 'contato.create', 'contato.update', 'contato.delete']) {
    const [recurso, acao] = chave.split('.');
    await sql(
      `INSERT INTO permissao (chave, recurso, acao, descricao) VALUES ($1, $2, $3, 'teste')`,
      [chave, recurso, acao],
    );
  }
  for (const [tid, slug] of [
    [contas.a, 'a'],
    [contas.b, 'b'],
    [contas.c, 'c'],
  ] as const) {
    await sql(
      `INSERT INTO tenant (id, nome, slug, status, updated_at) VALUES ($1, $2, $2, 'ATIVO', now())`,
      [tid, slug],
    );
  }
  for (const [eid, tid, nome, ativo] of [
    [empresas.a1, contas.a, 'A1', true],
    [empresas.a2, contas.a, 'A2', true],
    [empresas.a3, contas.a, 'A3', false],
    [empresas.b1, contas.b, 'B1', true],
    [empresas.c1, contas.c, 'C1', true],
  ] as const) {
    await sql(
      `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, ativo, updated_at)
       VALUES ($1, $2, $3, $3, $4, now())`,
      [eid, tid, nome, ativo],
    );
  }
  for (const quem of Object.keys(membros) as Quem[]) {
    await sql(
      `INSERT INTO usuario (id, email, nome, senha_hash, updated_at) VALUES ($1, $2, $3, 'x', now())`,
      [usuarios[quem], `${quem.toLowerCase()}@isolamento.local`, quem],
    );
    await sql(
      `INSERT INTO membro (id, tenant_id, usuario_id, status, updated_at) VALUES ($1, $2, $3, 'ATIVO', now())`,
      [membros[quem], contas[CONTAS_DO_MEMBRO[quem]], usuarios[quem]],
    );
  }

  const papel = async (pid: string, tid: string, chave: string, perms: Record<string, string>) => {
    await sql(
      `INSERT INTO papel (id, tenant_id, chave, nome, updated_at) VALUES ($1, $2, $3, $3, now())`,
      [pid, tid, chave],
    );
    for (const [permissao, escopo] of Object.entries(perms))
      await sql(
        `INSERT INTO papel_permissao (papel_id, permissao_chave, escopo) VALUES ($1, $2, $3)`,
        [pid, permissao, escopo],
      );
  };
  const editor = {
    'contato.read': 'EMPRESA',
    'contato.create': 'EMPRESA',
    'contato.update': 'EMPRESA',
  };
  const todas = {
    'contato.read': 'TENANT',
    'contato.create': 'TENANT',
    'contato.update': 'TENANT',
    'contato.delete': 'TENANT',
  };
  await papel(papeis.editor, contas.a, 'EDITOR', editor);
  await papel(papeis.proprio, contas.a, 'PROPRIO', {
    'contato.read': 'PROPRIO',
    'contato.update': 'PROPRIO',
  });
  await papel(papeis.admin, contas.a, 'ADMIN', todas);
  await papel(papeis.adminB, contas.b, 'ADMIN', todas);
  await papel(papeis.editorC, contas.c, 'EDITOR', editor);

  const atribuir = (tid: string, mid: string, pid: string, empresa: string | null) =>
    sql(
      `INSERT INTO atribuicao_papel (id, tenant_id, membro_id, papel_id, empresa_id) VALUES ($1, $2, $3, $4, $5)`,
      [id(), tid, mid, pid, empresa],
    );
  await atribuir(contas.a, membros.m1, papeis.editor, empresas.a1);
  await atribuir(contas.a, membros.m1, papeis.editor, empresas.a3);
  await atribuir(contas.a, membros.m2, papeis.editor, empresas.a2);
  await atribuir(contas.a, membros.mP, papeis.proprio, empresas.a1);
  await atribuir(contas.a, membros.admin, papeis.admin, null);
  await atribuir(contas.a, membros.vol, papeis.editor, empresas.a1);
  await atribuir(contas.b, membros.mB, papeis.adminB, null);
  await atribuir(contas.c, membros.mC, papeis.editorC, empresas.c1);

  for (const [oid, tid, eid] of [
    [origens.a1, contas.a, empresas.a1],
    [origens.a2, contas.a, empresas.a2],
  ] as const) {
    await sql(
      `INSERT INTO origem_lead (id, tenant_id, empresa_id, nome, tipo) VALUES ($1, $2, $3, 'Site', 'FORMULARIO_SITE')`,
      [oid, tid, eid],
    );
  }
  for (const [cid, tid, eid, nome, responsavel] of [
    [contatos.a1DoP, contas.a, empresas.a1, 'A1 do P', membros.mP],
    [contatos.a1DoM1, contas.a, empresas.a1, 'A1 do m1', membros.m1],
    [contatos.a2, contas.a, empresas.a2, 'A2', membros.m2],
    [contatos.b1, contas.b, empresas.b1, 'B1', membros.mB],
  ] as const) {
    await sql(
      `INSERT INTO contato (id, tenant_id, empresa_id, nome, email, responsavel_id, updated_at)
       VALUES ($1, $2, $3, $4, 'contato@isolamento.local', $5, now())`,
      [cid, tid, eid, nome, responsavel],
    );
  }

  const app = await criarAppDeTeste({
    controllers: [ContatosDeTesteController],
    config: {
      DATABASE_URL_AUTH: banco.urlDoPapel('ebisu_auth'),
      DATABASE_URL_APP: banco.urlDoPapel('ebisu_app'),
    },
  });
  const tokens = app.get<TokensDeAcesso>(TOKENS_DE_ACESSO);
  return {
    banco,
    app,
    sql,
    token: (quem) =>
      tokens.emitir({
        usuarioId: usuarios[quem],
        tenantId: contas[CONTAS_DO_MEMBRO[quem]],
        membroId: membros[quem],
      }),
    async fechar() {
      await app.close();
      await admin.end();
      await banco.container.stop();
    },
  };
}
