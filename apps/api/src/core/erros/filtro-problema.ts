import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type CodigoErro, camposDoZod, criarProblema, type Problema } from '@ebisu/contracts';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { requestIdDa } from '../requisicao/request-id.js';
import { ErroDominio } from './erro-dominio.js';

// Converte qualquer exceção no envelope RFC 9457 (spec §5.1). Nunca expõe mensagem interna,
// stack ou erro cru do banco: o cliente vê só o código do catálogo e o request_id.

const CODIGO_DO_STATUS: Partial<Record<number, CodigoErro>> = {
  [HttpStatus.BAD_REQUEST]: 'validacao',
  [HttpStatus.UNAUTHORIZED]: 'nao_autenticado',
  [HttpStatus.FORBIDDEN]: 'sem_permissao',
  [HttpStatus.NOT_FOUND]: 'nao_encontrado',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'validacao',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'validacao',
  [HttpStatus.TOO_MANY_REQUESTS]: 'limite_excedido',
};

@Catch()
export class FiltroProblema implements ExceptionFilter {
  private readonly logger = new Logger('Erros');

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const request_id = requestIdDa(res);
    const problema = { ...this.converter(excecao), request_id, instance: req.path };
    if (problema.status >= 500) {
      this.logger.error({ request_id, erro: excecao }, 'Erro não tratado');
    }
    res.status(problema.status).type('application/problem+json').json(problema);
  }

  private converter(excecao: unknown): Problema {
    if (excecao instanceof ErroDominio) {
      return criarProblema(excecao.code, { ...excecao.detalhes, invariante: excecao.invariante });
    }
    if (excecao instanceof ZodError) {
      return criarProblema('validacao', { campos: camposDoZod(excecao) });
    }
    if (excecao instanceof HttpException) {
      const code = CODIGO_DO_STATUS[excecao.getStatus()];
      if (code) return criarProblema(code);
    }
    return criarProblema('erro_interno');
  }
}
