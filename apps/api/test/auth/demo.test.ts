import type { INestApplication } from '@nestjs/common';
import { RespostaEu, RespostaSessao } from '@ebisu/contracts';
import { PrismaClient, SENHA_DEMO, semearDemo } from '@ebisu/db';
import { type BancoDeTeste, criarBancoDeTeste } from '@ebisu/db/teste';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAppDeTeste, ORIGEM_WEB } from '../app-de-teste.js';

// O web fala com a API real: os usuários do seed de demonstração entram com a senha de dev
// (README) e veem as empresas dos seus papéis, pelo mesmo fluxo do navegador.

let banco: BancoDeTeste;
let app: INestApplication;

beforeAll(async () => {
  banco = await criarBancoDeTeste();
  const migrador = new PrismaClient({ datasourceUrl: banco.urlAdmin });
  try {
    await semearDemo(migrador);
  } finally {
    await migrador.$disconnect();
  }
  app = await criarAppDeTeste({
    config: {
      DATABASE_URL_AUTH: banco.urlDoPapel('ebisu_auth'),
      DATABASE_URL_APP: banco.urlDoPapel('ebisu_app'),
    },
  });
}, 180_000);
afterAll(async () => {
  await app?.close();
  await banco?.container.stop();
});

const entrar = (email: string, senha = SENHA_DEMO) =>
  request(app.getHttpServer())
    .post('/v1/auth/login')
    .set('Origin', ORIGEM_WEB)
    .send({ email, senha });

describe('login com os usuários de demonstração', () => {
  it('owner entra e vê as duas empresas', async () => {
    const r = await entrar('owner@demo.ebisu.local');
    expect(r.status).toBe(200);
    const sessao = RespostaSessao.parse(r.body);
    expect(sessao.conta.slug).toBe('assistencia-demo');
    const eu = await request(app.getHttpServer())
      .get('/v1/eu')
      .set('Authorization', `Bearer ${sessao.access_token}`);
    expect(eu.status).toBe(200);
    const nomes = RespostaEu.parse(eu.body).empresas.map((e) => e.nome_fantasia);
    expect(nomes).toEqual(['Ebisu Centro', 'Ebisu Shopping']);
  });

  it('técnico entra e vê só a empresa Centro', async () => {
    const r = await entrar('tecnico@demo.ebisu.local');
    expect(r.status).toBe(200);
    const eu = await request(app.getHttpServer())
      .get('/v1/eu')
      .set('Authorization', `Bearer ${RespostaSessao.parse(r.body).access_token}`);
    expect(RespostaEu.parse(eu.body).empresas.map((e) => e.nome_fantasia)).toEqual([
      'Ebisu Centro',
    ]);
  });

  it('senha errada continua 401', async () => {
    expect((await entrar('owner@demo.ebisu.local', 'outra-senha-qualquer')).status).toBe(401);
  });
});
