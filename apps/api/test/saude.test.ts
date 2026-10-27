import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';

describe('GET /v1/saude', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
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
  });
});
