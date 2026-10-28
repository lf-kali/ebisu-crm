import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  HttpCode,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

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
  // ZodError vira 422 `validacao` no filtro global.
  return schema.parse(ORIGEM[parte](contexto.switchToHttp().getRequest<Request>()));
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
