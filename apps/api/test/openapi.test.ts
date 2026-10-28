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
    appComExemplo = await criarAppDeTeste([ExemploController]);
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

  it('recusa gerar o documento se alguma rota não tiver @Contrato', async () => {
    const { Controller, Get } = await import('@nestjs/common');
    @Controller('sem-contrato')
    class SemContratoController {
      @Get()
      ler() {
        return {};
      }
    }
    const semContrato = await criarAppDeTeste([SemContratoController]);
    try {
      expect(() => gerarDocumento(semContrato)).toThrow(
        /Rota sem @Contrato: GET \/v1\/sem-contrato/,
      );
    } finally {
      await semContrato.close();
    }
  });
});
