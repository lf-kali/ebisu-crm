import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  HttpCode,
  SetMetadata,
} from '@nestjs/common';
import { camposDoZod } from '@ebisu/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { ErroDominio } from '../erros/erro-dominio.js';

// Um contrato por endpoint (D-A02, D-A10): os mesmos schemas validam a requisição e a resposta
// e geram o OpenAPI. Endpoint sem contrato é recusado pelo teste de cobertura do OpenAPI.

export interface DefinicaoContrato {
  resumo: string;
  descricao?: string;
  tags?: string[];
  params?: z.ZodObject;
  query?: z.ZodObject;
  corpo?: z.ZodType;
  /** Schema da resposta de sucesso; `null` para respostas sem corpo (204). */
  resposta: z.ZodType | null;
  /** Status de sucesso (padrão 200). */
  status?: number;
}

export const CHAVE_CONTRATO = 'ebisu:contrato';

export function Contrato(definicao: DefinicaoContrato): MethodDecorator {
  return applyDecorators(SetMetadata(CHAVE_CONTRATO, definicao), HttpCode(definicao.status ?? 200));
}

export function contratoDoHandler(contexto: ExecutionContext): DefinicaoContrato | undefined {
  return Reflect.getMetadata(CHAVE_CONTRATO, contexto.getHandler()) as
    DefinicaoContrato | undefined;
}

type Parte = 'corpo' | 'query' | 'params';
const ORIGEM: Record<Parte, (req: Request) => unknown> = {
  corpo: (req) => req.body,
  query: (req) => req.query,
  params: (req) => req.params,
};

function validar(parte: Parte, contexto: ExecutionContext): unknown {
  const schema = contratoDoHandler(contexto)?.[parte];
  if (!schema) {
    // Erro de programação: o parâmetro é lido mas o contrato não declara o schema.
    throw new Error(
      `@Contrato sem schema "${parte}" em ${contexto.getClass().name}.${contexto.getHandler().name}`,
    );
  }
  // Só a entrada vira 422: um ZodError lançado em outro lugar (service, regra) é bug e o
  // filtro o trata como 500 logado, sem expor o schema interno.
  const resultado = schema.safeParse(ORIGEM[parte](contexto.switchToHttp().getRequest<Request>()));
  if (!resultado.success)
    throw new ErroDominio('validacao', { campos: camposDoZod(resultado.error) });
  return resultado.data;
}

/** Corpo validado pelo `corpo` do contrato. */
export const Corpo = createParamDecorator((_: unknown, contexto: ExecutionContext) =>
  validar('corpo', contexto),
);
/** Query validada pelo `query` do contrato. */
export const Consulta = createParamDecorator((_: unknown, contexto: ExecutionContext) =>
  validar('query', contexto),
);
/** Parâmetros de rota validados pelo `params` do contrato. */
export const Parametros = createParamDecorator((_: unknown, contexto: ExecutionContext) =>
  validar('params', contexto),
);
