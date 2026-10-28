import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Problema, VERSAO_API } from '@ebisu/contracts';
import { resolve } from 'node:path';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { CHAVE_CONTRATO, type DefinicaoContrato } from '../contrato/contrato.js';

// Gera o OpenAPI (D-A02) a partir das rotas registradas no Nest e dos seus @Contrato:
// uma única fonte para validação e documentação.

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';
const METODOS: Partial<Record<RequestMethod, Metodo>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

export interface Rota {
  metodo: Metodo;
  caminho: string;
  handler: string;
  contrato: DefinicaoContrato | undefined;
}

const juntar = (...partes: Array<string | undefined>) =>
  '/' +
  partes
    .flatMap((p) => (p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

/** Lista as rotas HTTP do app, com o contrato de cada uma (ou `undefined` se faltar). */
export function listarRotas(app: INestApplication): Rota[] {
  const rotas: Rota[] = [];
  for (const modulo of app.get(ModulesContainer).values()) {
    for (const { metatype } of modulo.controllers.values()) {
      if (!metatype) continue;
      const prefixos = [Reflect.getMetadata(PATH_METADATA, metatype) as string | string[]].flat();
      const prototipo = metatype.prototype as Record<string, unknown>;
      for (const nome of Object.getOwnPropertyNames(prototipo)) {
        const handler = prototipo[nome];
        if (nome === 'constructor' || typeof handler !== 'function') continue;
        const metodo = METODOS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        const caminhos = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[] | undefined;
        if (!metodo || caminhos === undefined) continue;
        for (const prefixo of prefixos) {
          for (const caminho of [caminhos].flat()) {
            rotas.push({
              metodo,
              // `:id` do Nest vira `{id}` no OpenAPI.
              caminho: juntar(VERSAO_API, prefixo, caminho).replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
              handler: `${metatype.name}.${nome}`,
              contrato: Reflect.getMetadata(CHAVE_CONTRATO, handler) as
                DefinicaoContrato | undefined,
            });
          }
        }
      }
    }
  }
  return rotas.sort((a, b) => `${a.caminho} ${a.metodo}`.localeCompare(`${b.caminho} ${b.metodo}`));
}

/** apps/api/openapi.json (mesma profundidade em src/ e em dist/). */
export const CAMINHO_OPENAPI = resolve(__dirname, '../../../openapi.json');

export const serializar = (documento: unknown) => `${JSON.stringify(documento, null, 2)}\n`;

const respostaDeErro = {
  description: 'Erro no formato RFC 9457',
  content: { 'application/problem+json': { schema: Problema } },
};

export function gerarDocumento(app: INestApplication) {
  const registro = new OpenAPIRegistry();
  for (const { metodo, caminho, handler, contrato } of listarRotas(app)) {
    if (!contrato)
      throw new Error(`Rota sem @Contrato: ${metodo.toUpperCase()} ${caminho} (${handler})`);
    const status = contrato.status ?? 200;
    registro.registerPath({
      method: metodo,
      path: caminho,
      summary: contrato.resumo,
      ...(contrato.descricao ? { description: contrato.descricao } : {}),
      ...(contrato.tags ? { tags: contrato.tags } : {}),
      request: {
        ...(contrato.params ? { params: contrato.params } : {}),
        ...(contrato.query ? { query: contrato.query } : {}),
        ...(contrato.corpo
          ? { body: { content: { 'application/json': { schema: contrato.corpo } } } }
          : {}),
      },
      responses: {
        [status]: contrato.resposta
          ? {
              description: 'Sucesso',
              content: { 'application/json': { schema: contrato.resposta } },
            }
          : { description: 'Sucesso, sem conteúdo' },
        default: respostaDeErro,
      },
    });
  }
  return new OpenApiGeneratorV31(registro.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'ebisuCRM API', version: '1.0.0', description: 'API REST /v1 do ebisuCRM' },
    servers: [{ url: '/' }],
  });
}
