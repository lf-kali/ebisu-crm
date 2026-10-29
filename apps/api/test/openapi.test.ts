import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMINHO_OPENAPI,
  gerarDocumento,
  listarRotas,
  serializar,
} from '../src/core/openapi/gerar-documento.js';
import { criarAppDeTeste } from './app-de-teste.js';
import { ExemploController } from './exemplo.controller.js';

describe('OpenAPI gerado dos contratos (D-A02, §4 F2)', () => {
  let app: INestApplication;
  let appComExemplo: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    appComExemplo = await criarAppDeTeste({ controllers: [ExemploController] });
  });
  afterAll(async () => {
    await Promise.all([app?.close(), appComExemplo?.close()]);
  });

  it('toda rota da API tem @Contrato', () => {
    const rotas = listarRotas(app);
    expect(rotas.length).toBeGreaterThan(0);
    expect(rotas.filter((r) => !r.contrato).map((r) => `${r.metodo} ${r.caminho}`)).toEqual([]);
  });

  it('apps/api/openapi.json está atualizado (rode `pnpm --filter @ebisu/api openapi`)', () => {
    expect(readFileSync(CAMINHO_OPENAPI, 'utf8')).toBe(serializar(gerarDocumento(app)));
  });

  it('documenta corpo, query, parâmetro de rota, status do contrato e o erro padrão', () => {
    const doc = gerarDocumento(appComExemplo) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const post = doc.paths['/v1/exemplo']!.post!;
    expect(Object.keys(post.responses as object)).toEqual(['201', 'default']);
    expect(post.requestBody).toBeDefined();
    expect(post.parameters).toEqual([expect.objectContaining({ in: 'query', name: 'modo' })]);
    const get = doc.paths['/v1/exemplo/{id}']!.get!;
    expect(get.parameters).toEqual([
      expect.objectContaining({ in: 'path', name: 'id', required: true }),
    ]);
    expect(JSON.stringify(post.responses)).toContain('application/problem+json');
  });

  it('rotas herdadas de uma classe base entram no documento e exigem contrato', async () => {
    const { Controller, Get } = await import('@nestjs/common');
    const { z } = await import('zod');
    const { Contrato } = await import('../src/core/contrato/contrato.js');
    class Base {
      @Get('com-contrato')
      @Contrato({ resumo: 'Herdada', resposta: z.object({ ok: z.boolean() }) })
      comContrato() {
        return { ok: true };
      }
    }
    @Controller('filho')
    class FilhoController extends Base {}
    const comHeranca = await criarAppDeTeste({ controllers: [FilhoController] });
    try {
      expect(listarRotas(comHeranca).map((r) => r.caminho)).toContain('/v1/filho/com-contrato');
    } finally {
      await comHeranca.close();
    }

    class BaseSemContrato {
      @Get('sem')
      sem() {
        return {};
      }
    }
    @Controller('filho2')
    class Filho2Controller extends BaseSemContrato {}
    const semContrato = await criarAppDeTeste({ controllers: [Filho2Controller] });
    try {
      expect(() => gerarDocumento(semContrato)).toThrow(
        /Rota sem @Contrato: GET \/v1\/filho2\/sem/,
      );
    } finally {
      await semContrato.close();
    }
  });

  it('listar rotas não executa getters do controller', async () => {
    const { Controller } = await import('@nestjs/common');
    @Controller('com-getter')
    class ComGetterController {
      get perigoso(): never {
        throw new Error('getter executado');
      }
    }
    const comGetter = await criarAppDeTeste({ controllers: [ComGetterController] });
    try {
      expect(() => listarRotas(comGetter)).not.toThrow();
    } finally {
      await comGetter.close();
    }
  });

  it('recusa @Head, @Options e @All (escapariam do contrato)', async () => {
    const { All, Controller, Head, Options } = await import('@nestjs/common');
    @Controller('head')
    class ComHead {
      @Head()
      tratar() {}
    }
    @Controller('options')
    class ComOptions {
      @Options()
      tratar() {}
    }
    @Controller('all')
    class ComAll {
      @All()
      tratar() {}
    }
    for (const controller of [ComHead, ComOptions, ComAll]) {
      const especial = await criarAppDeTeste({ controllers: [controller] });
      try {
        expect(() => listarRotas(especial), controller.name).toThrow(
          /Método HTTP não suportado pelo contrato/,
        );
      } finally {
        await especial.close();
      }
    }
  });

  it('rotas da conta (@PermissaoNaConta): sem X-Empresa-Id; o POST pede Idempotency-Key', () => {
    const doc = gerarDocumento(app) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const post = doc.paths['/v1/empresas']!.post!;
    expect(post.parameters).toEqual([
      expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }),
    ]);
    expect(Object.keys(post.responses as object)).toEqual([
      '201',
      '401',
      '403',
      '409',
      '422',
      'default',
    ]);
    expect(post.security).toEqual([{ bearer: [] }]);
    expect(post.description).toContain('escopo TENANT');
    const get = doc.paths['/v1/empresas']!.get!;
    expect(JSON.stringify(get.parameters)).not.toMatch(/X-Empresa-Id|Idempotency-Key/);
    const registrar = doc.paths['/v1/auth/registrar']!.post!;
    expect(registrar.security).toBeUndefined();
  });

  it('recusa gerar o documento se alguma rota não tiver @Contrato', async () => {
    const { Controller, Get } = await import('@nestjs/common');
    @Controller('sem-contrato')
    class SemContratoController {
      @Get()
      ler() {
        return {};
      }
    }
    const semContrato = await criarAppDeTeste({ controllers: [SemContratoController] });
    try {
      expect(() => gerarDocumento(semContrato)).toThrow(
        /Rota sem @Contrato: GET \/v1\/sem-contrato/,
      );
    } finally {
      await semContrato.close();
    }
  });
});
