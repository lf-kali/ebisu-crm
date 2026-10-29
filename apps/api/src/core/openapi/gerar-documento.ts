import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Problema, Uuid, VERSAO_API } from '@ebisu/contracts';
import { resolve } from 'node:path';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { z } from 'zod';
import { CHAVE_CONTRATO, type DefinicaoContrato } from '../contrato/contrato.js';
import { type Acesso, marcasDe } from '../rbac/marcas.js';

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
  /** Marcas de acesso do handler (o guard exige exatamente uma). */
  marcas: Acesso[];
}

const juntar = (...partes: Array<string | undefined>) =>
  '/' +
  partes
    .flatMap((p) => (p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

/** Métodos do controller, incluindo os herdados (o Nest também registra rotas herdadas). */
function metodosDoController(prototipo: object): Array<[string, unknown]> {
  const vistos = new Map<string, unknown>();
  for (
    let atual = prototipo;
    atual && atual !== Object.prototype;
    atual = Object.getPrototypeOf(atual)
  ) {
    for (const nome of Object.getOwnPropertyNames(atual)) {
      // A sobrescrita mais próxima da classe concreta vence, como no Nest.
      if (nome === 'constructor' || vistos.has(nome)) continue;
      // Pelo descritor: ler `atual[nome]` executaria getters do controller.
      const { value } = Object.getOwnPropertyDescriptor(atual, nome) ?? {};
      vistos.set(nome, value);
    }
  }
  return [...vistos];
}

/** Lista as rotas HTTP do app, com o contrato de cada uma (ou `undefined` se faltar). */
export function listarRotas(app: INestApplication): Rota[] {
  const rotas: Rota[] = [];
  for (const modulo of app.get(ModulesContainer).values()) {
    for (const { metatype } of modulo.controllers.values()) {
      if (!metatype) continue;
      const prefixos = [Reflect.getMetadata(PATH_METADATA, metatype) as string | string[]].flat();
      for (const [nome, handler] of metodosDoController(metatype.prototype as object)) {
        if (typeof handler !== 'function') continue;
        const caminhos = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[] | undefined;
        if (caminhos === undefined) continue;
        const metodoNest = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        const metodo = METODOS[metodoNest];
        if (!metodo) {
          // @All/@Head/@Options etc. escapariam do OpenAPI e da exigência de @Contrato.
          throw new Error(
            `Método HTTP não suportado pelo contrato: ${RequestMethod[metodoNest]} em ${metatype.name}.${nome}`,
          );
        }
        for (const prefixo of prefixos) {
          for (const caminho of [caminhos].flat()) {
            rotas.push({
              metodo,
              // `:id` do Nest vira `{id}` no OpenAPI.
              caminho: juntar(VERSAO_API, prefixo, caminho).replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
              handler: `${metatype.name}.${nome}`,
              contrato: Reflect.getMetadata(CHAVE_CONTRATO, handler) as
                DefinicaoContrato | undefined,
              marcas: marcasDe(handler),
            });
          }
        }
      }
    }
  }
  // Ordem por código (independe do locale): o openapi.json sai igual em qualquer máquina.
  const chave = (r: Rota) => `${r.caminho} ${r.metodo}`;
  return rotas.sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
}

/** apps/api/openapi.json (mesma profundidade em src/ e em dist/). */
export const CAMINHO_OPENAPI = resolve(__dirname, '../../../openapi.json');

export const serializar = (documento: unknown) => `${JSON.stringify(documento, null, 2)}\n`;

const respostaDeErro = {
  description: 'Erro no formato RFC 9457',
  content: { 'application/problem+json': { schema: Problema } },
};

/** Cabeçalho das rotas de domínio (§5.1, SEG-3). */
const CabecalhoEmpresa = z.object({
  'X-Empresa-Id': Uuid.meta({ description: 'Empresa em que a operação acontece' }),
});

/** POST de domínio e da conta: idempotente (§5.1; plano f3-3a). */
const CabecalhoIdempotencia = z.object({
  'Idempotency-Key': Uuid.meta({
    description: 'Repetir com a mesma chave devolve a mesma resposta (validade de 24 h)',
  }),
});
const CabecalhosIdempotente = CabecalhoEmpresa.extend(CabecalhoIdempotencia.shape);

/** Cabeçalhos da rota pela marca: as de domínio levam a empresa; os POST, a chave. */
function cabecalhosDa(acesso: Acesso, idempotente: boolean) {
  if (acesso.tipo === 'permissao') return idempotente ? CabecalhosIdempotente : CabecalhoEmpresa;
  if (acesso.tipo === 'conta' && idempotente) return CabecalhoIdempotencia;
  return undefined;
}

function descricaoDoAcesso(acesso: Acesso): string | undefined {
  if (acesso.tipo === 'permissao') return `Permissão: \`${acesso.chave}\`.`;
  if (acesso.tipo === 'conta')
    return `Permissão: \`${acesso.chave}\` em todas as empresas (escopo TENANT). Sem X-Empresa-Id.`;
  return undefined;
}

/** Respostas de erro que a marca de acesso acrescenta, além do `default`. */
const ERROS_DO_ACESSO: Record<Acesso['tipo'], string[]> = {
  publica: [],
  autenticado: ['401'],
  permissao: ['401', '403', '422'],
  conta: ['401', '403'],
};

export function gerarDocumento(app: INestApplication) {
  const registro = new OpenAPIRegistry();
  const bearer = registro.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  for (const { metodo, caminho, handler, contrato, marcas } of listarRotas(app)) {
    if (!contrato)
      throw new Error(`Rota sem @Contrato: ${metodo.toUpperCase()} ${caminho} (${handler})`);
    const [acesso] = marcas;
    if (marcas.length !== 1 || !acesso)
      throw new Error(
        `Rota sem marca de acesso única: ${metodo.toUpperCase()} ${caminho} (${handler})`,
      );
    const status = contrato.status ?? 200;
    const descricao = [contrato.descricao, descricaoDoAcesso(acesso)].filter(Boolean).join('\n\n');
    const idempotente =
      (acesso.tipo === 'permissao' || acesso.tipo === 'conta') && metodo === 'post';
    const erros = [
      ...new Set([...ERROS_DO_ACESSO[acesso.tipo], ...(idempotente ? ['409', '422'] : [])]),
    ];
    const cabecalhos = cabecalhosDa(acesso, idempotente);
    registro.registerPath({
      method: metodo,
      path: caminho,
      summary: contrato.resumo,
      ...(descricao ? { description: descricao } : {}),
      ...(contrato.tags ? { tags: contrato.tags } : {}),
      ...(acesso.tipo === 'publica' ? {} : { security: [{ [bearer.name]: [] }] }),
      request: {
        ...(cabecalhos ? { headers: cabecalhos } : {}),
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
        ...Object.fromEntries(erros.map((s) => [s, respostaDeErro])),
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
