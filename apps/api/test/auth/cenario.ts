import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type BancoDeTeste, criarBancoDeTeste } from '@ebisu/db/teste';
import { gerarHashSenha } from '../../src/modules/auth/senha.js';
import { criarAppDeTeste } from '../app-de-teste.js';
import type { Limitador } from '../../src/core/limite/limitador.js';

// Cenário dos testes de auth (F3-1), gravado pelo superusuário do container (ignora RLS).
//   Ana:   membro ATIVO em "ebisu" (ATIVO) e "oficina" (TRIAL); também em "suspensa" (conta SUSPENSA).
//          Em ebisu: ADMIN em todas as empresas + TECNICO no Centro.
//   Bruno: membro ATIVO só em ebisu; TECNICO e CAIXA no Shopping (escopos se somam).
//   Carla: membro SUSPENSO em ebisu (sem conta ativa).   Davi: usuário inativo.
//   Elisa: membro ATIVO só numa conta CANCELADA.

export const SENHA = 'senha-de-teste-123';
const id = () => randomUUID();

export const IDS = {
  contas: { ebisu: id(), oficina: id(), suspensa: id(), cancelada: id() },
  usuarios: { ana: id(), bruno: id(), carla: id(), davi: id(), elisa: id() },
  membros: {
    anaEbisu: id(),
    anaOficina: id(),
    anaSuspensa: id(),
    bruno: id(),
    carla: id(),
    davi: id(),
    elisa: id(),
  },
  empresas: { centro: id(), shopping: id(), inativa: id(), oficina: id() },
  papeis: { admin: id(), tecnico: id(), caixa: id(), adminOficina: id() },
};

export interface Cenario {
  banco: BancoDeTeste;
  app: INestApplication;
  /** Outro app sobre o mesmo banco (ex.: com o limitador de tentativas de verdade). */
  criarApp(limitador: Limitador): Promise<INestApplication>;
  fechar(): Promise<void>;
  sql(texto: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Nunca limita: os testes fazem muitos logins seguidos do mesmo IP. */
const semLimite: Limitador = { registrar: async () => 0 };

export async function criarCenario(): Promise<Cenario> {
  const banco = await criarBancoDeTeste();
  const admin = await banco.conectar(banco.urlAdmin);
  const sql = (texto: string, params: unknown[] = []) => admin.query(texto, params);
  const hash = await gerarHashSenha(SENHA);
  const { contas, usuarios, membros, empresas, papeis } = IDS;

  for (const chave of ['contato.read', 'contato.create', 'os.read', 'os.update']) {
    const [recurso, acao] = chave.split('.');
    await sql(
      `INSERT INTO permissao (chave, recurso, acao, descricao) VALUES ($1, $2, $3, 'teste')`,
      [chave, recurso, acao],
    );
  }
  for (const [chave, [nome, status]] of Object.entries({
    ebisu: ['Assistência Ebisu', 'ATIVO'],
    oficina: ['Oficina do Bairro', 'TRIAL'],
    suspensa: ['Conta Suspensa', 'SUSPENSO'],
    cancelada: ['Conta Cancelada', 'CANCELADO'],
  })) {
    await sql(
      `INSERT INTO tenant (id, nome, slug, status, updated_at) VALUES ($1, $2, $3, $4, now())`,
      [contas[chave as keyof typeof contas], nome, chave, status],
    );
  }
  for (const [chave, [email, ativo]] of Object.entries({
    ana: ['ana@teste.local', true],
    bruno: ['bruno@teste.local', true],
    carla: ['carla@teste.local', true],
    davi: ['davi@teste.local', false],
    elisa: ['elisa@teste.local', true],
  })) {
    await sql(
      `INSERT INTO usuario (id, email, nome, senha_hash, ativo, updated_at) VALUES ($1, $2, $3, $4, $5, now())`,
      [usuarios[chave as keyof typeof usuarios], email, chave, hash, ativo],
    );
  }
  // Ordem de criação importa: a conta "mais antiga" da Ana é a ebisu.
  const membro = (mid: string, tenant: string, usuario: string, status = 'ATIVO', diasAtras = 0) =>
    sql(
      `INSERT INTO membro (id, tenant_id, usuario_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now() - make_interval(days => $5), now())`,
      [mid, tenant, usuario, status, diasAtras],
    );
  await membro(membros.anaEbisu, contas.ebisu, usuarios.ana, 'ATIVO', 3);
  await membro(membros.anaOficina, contas.oficina, usuarios.ana, 'ATIVO', 2);
  await membro(membros.anaSuspensa, contas.suspensa, usuarios.ana, 'ATIVO', 5);
  await membro(membros.bruno, contas.ebisu, usuarios.bruno);
  await membro(membros.carla, contas.ebisu, usuarios.carla, 'SUSPENSO');
  await membro(membros.davi, contas.ebisu, usuarios.davi);
  await membro(membros.elisa, contas.cancelada, usuarios.elisa);

  for (const [eid, tenant, nome, ativo, diasAtras] of [
    [empresas.centro, contas.ebisu, 'Ebisu Centro', true, 3],
    [empresas.shopping, contas.ebisu, 'Ebisu Shopping', true, 2],
    [empresas.inativa, contas.ebisu, 'Ebisu Fechada', false, 1],
    [empresas.oficina, contas.oficina, 'Oficina do Bairro', true, 1],
  ] as const) {
    await sql(
      `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, ativo, created_at, updated_at)
       VALUES ($1, $2, $3, $3, $4, now() - make_interval(days => $5), now())`,
      [eid, tenant, nome, ativo, diasAtras],
    );
  }
  const papel = async (
    pid: string,
    tenant: string,
    chave: string,
    perms: Record<string, string>,
  ) => {
    await sql(
      `INSERT INTO papel (id, tenant_id, chave, nome, updated_at) VALUES ($1, $2, $3, $3, now())`,
      [pid, tenant, chave],
    );
    for (const [permissao, escopo] of Object.entries(perms))
      await sql(
        `INSERT INTO papel_permissao (papel_id, permissao_chave, escopo) VALUES ($1, $2, $3)`,
        [pid, permissao, escopo],
      );
  };
  await papel(papeis.admin, contas.ebisu, 'ADMIN', {
    'contato.read': 'TENANT',
    'contato.create': 'EMPRESA',
  });
  await papel(papeis.tecnico, contas.ebisu, 'TECNICO', {
    'contato.read': 'PROPRIO',
    'os.read': 'PROPRIO',
    'os.update': 'PROPRIO',
  });
  await papel(papeis.caixa, contas.ebisu, 'CAIXA', { 'contato.read': 'EMPRESA' });
  await papel(papeis.adminOficina, contas.oficina, 'ADMIN', { 'contato.read': 'TENANT' });

  const atribuir = (tenant: string, mid: string, pid: string, empresa: string | null) =>
    sql(
      `INSERT INTO atribuicao_papel (id, tenant_id, membro_id, papel_id, empresa_id) VALUES ($1, $2, $3, $4, $5)`,
      [id(), tenant, mid, pid, empresa],
    );
  await atribuir(contas.ebisu, membros.anaEbisu, papeis.admin, null);
  await atribuir(contas.ebisu, membros.anaEbisu, papeis.tecnico, empresas.centro);
  await atribuir(contas.ebisu, membros.bruno, papeis.tecnico, empresas.shopping);
  await atribuir(contas.ebisu, membros.bruno, papeis.caixa, empresas.shopping);
  await atribuir(contas.oficina, membros.anaOficina, papeis.adminOficina, null);

  const apps: INestApplication[] = [];
  const criarApp = async (limitador: Limitador) => {
    const novo = await criarAppDeTeste({
      config: {
        DATABASE_URL_AUTH: banco.urlDoPapel('ebisu_auth'),
        DATABASE_URL_APP: banco.urlDoPapel('ebisu_app'),
      },
      limitador,
    });
    apps.push(novo);
    return novo;
  };
  const app = await criarApp(semLimite);
  return {
    banco,
    app,
    criarApp,
    sql,
    async fechar() {
      await Promise.all(apps.map((a) => a.close()));
      await admin.end();
      await banco.container.stop();
    },
  };
}
