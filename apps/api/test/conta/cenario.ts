import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { RespostaSessao } from '@ebisu/contracts';
import { PrismaClient, semearCatalogoPermissoes } from '@ebisu/db';
import { type BancoDeTeste, criarBancoDeTeste } from '@ebisu/db/teste';
import request from 'supertest';
import { expect } from 'vitest';
import type { Limitador } from '../../src/core/limite/limitador.js';
import { gerarHashSenha } from '../../src/modules/auth/senha.js';
import { criarAppDeTeste } from '../app-de-teste.js';

// Cenário do cadastro e das empresas (plano docs/planos/f3-4a-cadastro-empresas.md): banco
// vazio com o catálogo de permissões (como depois do `pnpm db:seed`). As contas nascem pela API.

export const SENHA = 'cavalo-bateria-grampo-42';

export interface CenarioConta {
  banco: BancoDeTeste;
  app: INestApplication;
  criarApp(limitador: Limitador): Promise<INestApplication>;
  sql(texto: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  fechar(): Promise<void>;
}

/** Nunca limita: os testes cadastram muitas contas do mesmo IP. */
const semLimite: Limitador = { registrar: async () => 0 };

export async function criarCenarioConta(): Promise<CenarioConta> {
  const banco = await criarBancoDeTeste();
  const migrador = new PrismaClient({ datasourceUrl: banco.urlAdmin });
  try {
    await semearCatalogoPermissoes(migrador);
  } finally {
    await migrador.$disconnect();
  }
  const admin = await banco.conectar(banco.urlAdmin);
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
    sql: (texto, params = []) => admin.query(texto, params),
    async fechar() {
      await Promise.all(apps.map((a) => a.close()));
      await admin.end();
      await banco.container.stop();
    },
  };
}

let sequencia = 0;
/** E-mail único por chamada. */
export const novoEmail = (prefixo = 'pessoa') => `${prefixo}.${++sequencia}@cadastro.local`;

export function corpoDeCadastro(sobrescrever: Record<string, unknown> = {}) {
  return {
    nome: 'Marina Duarte',
    email: novoEmail(),
    senha: SENHA,
    conta: { nome: 'Assistência Duarte' },
    empresa: { razao_social: 'Duarte Assistência Técnica Ltda', nome_fantasia: 'Duarte Centro' },
    ...sobrescrever,
  };
}

export const cadastrar = (app: INestApplication, corpo: object) =>
  request(app.getHttpServer()).post('/v1/auth/registrar').send(corpo);

/** Cadastra uma conta e devolve o token, o tenant e o e-mail do dono. */
export async function contaNova(app: INestApplication, sobrescrever: Record<string, unknown> = {}) {
  const corpo = corpoDeCadastro(sobrescrever);
  const r = await cadastrar(app, corpo);
  expect(r.status).toBe(201);
  const sessao = RespostaSessao.parse(r.body);
  return { token: sessao.access_token, tenantId: sessao.conta.tenant_id, email: corpo.email };
}

/**
 * Membro extra na conta (pelo superusuário, sem RLS), com um papel próprio: as permissões dadas
 * e a atribuição numa empresa ou em todas (null). Devolve o token do login dele.
 */
export async function membroCom(
  cenario: CenarioConta,
  tenantId: string,
  permissoes: Record<string, 'PROPRIO' | 'EMPRESA' | 'TENANT'>,
  empresaId: string | null,
): Promise<string> {
  const email = novoEmail('membro');
  const [usuarioId, membroId, papelId] = [randomUUID(), randomUUID(), randomUUID()];
  await cenario.sql(
    `INSERT INTO usuario (id, email, nome, senha_hash, updated_at) VALUES ($1, $2, 'Membro', $3, now())`,
    [usuarioId, email, await gerarHashSenha(SENHA)],
  );
  await cenario.sql(
    `INSERT INTO membro (id, tenant_id, usuario_id, status, updated_at) VALUES ($1, $2, $3, 'ATIVO', now())`,
    [membroId, tenantId, usuarioId],
  );
  await cenario.sql(
    `INSERT INTO papel (id, tenant_id, chave, nome, updated_at) VALUES ($1, $2, $3, $3, now())`,
    [papelId, tenantId, `TESTE_${papelId.slice(0, 8)}`],
  );
  for (const [chave, escopo] of Object.entries(permissoes))
    await cenario.sql(
      `INSERT INTO papel_permissao (papel_id, permissao_chave, escopo) VALUES ($1, $2, $3)`,
      [papelId, chave, escopo],
    );
  await cenario.sql(
    `INSERT INTO atribuicao_papel (id, tenant_id, membro_id, papel_id, empresa_id) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), tenantId, membroId, papelId, empresaId],
  );
  const login = await request(cenario.app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, senha: SENHA });
  expect(login.status).toBe(200);
  return RespostaSessao.parse(login.body).access_token;
}
