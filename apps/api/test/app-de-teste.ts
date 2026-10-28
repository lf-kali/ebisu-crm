import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';

/** Sobe o AppModule real (com os controllers extras, se houver) sem abrir porta. */
export async function criarAppDeTeste(controllers: Array<new (...args: never[]) => unknown> = []) {
  const modulo = await Test.createTestingModule({ imports: [AppModule], controllers }).compile();
  const app: INestApplication = configurarApp(modulo.createNestApplication({ logger: false }));
  await app.init();
  return app;
}
