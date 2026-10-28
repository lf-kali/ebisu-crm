// Gera apps/api/openapi.json (spec §4 F2). Roda no build: `nest build && node dist/core/openapi/escrever-openapi.js`.
import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { configurarApp } from '../../configurar-app.js';
import { CAMINHO_OPENAPI, gerarDocumento, serializar } from './gerar-documento.js';

/**
 * O documento só lê as rotas: nada conecta a banco ou Redis. Para gerar no build (e no CI, que
 * não tem segredos), completa o que faltar com valores descartáveis, inclusive uma chave efêmera.
 */
function completarAmbienteDeGeracao(): void {
  const descartaveis: Record<string, () => string> = {
    DATABASE_URL_AUTH: () => 'postgresql://openapi:x@127.0.0.1:1/openapi',
    DATABASE_URL_APP: () => 'postgresql://openapi:x@127.0.0.1:1/openapi',
    REDIS_URL: () => 'redis://127.0.0.1:1',
    AUTH_JWT_CHAVE_PRIVADA: () =>
      generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    AUTH_JWT_KID: () => 'openapi',
    WEB_ORIGENS: () => 'http://localhost',
  };
  for (const [chave, valor] of Object.entries(descartaveis)) process.env[chave] ??= valor();
}

async function escrever(): Promise<void> {
  completarAmbienteDeGeracao();
  const app = configurarApp(await NestFactory.create(AppModule, { logger: false }));
  await app.init();
  try {
    writeFileSync(CAMINHO_OPENAPI, serializar(gerarDocumento(app)));
  } finally {
    await app.close();
  }
}

void escrever();
