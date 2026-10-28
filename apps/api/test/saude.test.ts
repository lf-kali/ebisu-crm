import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAppDeTeste } from './app-de-teste.js';

describe('GET /v1/saude', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com status ok', async () => {
    const resposta = await request(app.getHttpServer()).get('/v1/saude');
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'ok' });
  });

  it('não expõe a rota fora do prefixo /v1', async () => {
    const resposta = await request(app.getHttpServer()).get('/saude');
    expect(resposta.status).toBe(404);
    expect(resposta.body.code).toBe('nao_encontrado');
  });
});
