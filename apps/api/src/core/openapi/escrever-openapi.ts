// Gera apps/api/openapi.json (spec §4 F2). Roda no build: `nest build && node dist/core/openapi/escrever-openapi.js`.
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { configurarApp } from '../../configurar-app.js';
import { CAMINHO_OPENAPI, gerarDocumento, serializar } from './gerar-documento.js';

async function escrever(): Promise<void> {
  const app = configurarApp(await NestFactory.create(AppModule, { logger: false }));
  await app.init();
  try {
    writeFileSync(CAMINHO_OPENAPI, serializar(gerarDocumento(app)));
  } finally {
    await app.close();
  }
}

void escrever();
