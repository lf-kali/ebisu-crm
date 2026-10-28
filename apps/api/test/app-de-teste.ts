import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';
import { CONFIG, type Config } from '../src/core/config/config.js';
import { LIMITADOR, type Limitador, limitadorEmMemoria } from '../src/core/limite/limitador.js';

export const ORIGEM_WEB = 'http://localhost:5173';

/** Configuração de teste: chave Ed25519 gerada na hora; bancos só conectam no primeiro uso. */
export function configDeTeste(sobrescrever: Partial<Config> = {}): Config {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    DATABASE_URL_AUTH: 'postgresql://ninguem:x@127.0.0.1:1/nada',
    DATABASE_URL_APP: 'postgresql://ninguem:x@127.0.0.1:1/nada',
    REDIS_URL: 'redis://127.0.0.1:1',
    AUTH_JWT_CHAVE_PRIVADA: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    AUTH_JWT_KID: 'teste',
    WEB_ORIGENS: [ORIGEM_WEB],
    ...sobrescrever,
  };
}

interface OpcoesApp {
  controllers?: Array<new (...args: never[]) => unknown>;
  config?: Partial<Config>;
  limitador?: Limitador;
}

/** Sobe o AppModule real (com os controllers extras, se houver) sem abrir porta. */
export async function criarAppDeTeste({ controllers = [], config, limitador }: OpcoesApp = {}) {
  const modulo = await Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(CONFIG)
    .useValue(configDeTeste(config))
    .overrideProvider(LIMITADOR)
    .useValue(limitador ?? limitadorEmMemoria())
    .compile();
  const app: INestApplication = configurarApp(modulo.createNestApplication({ logger: false }));
  await app.init();
  return app;
}
