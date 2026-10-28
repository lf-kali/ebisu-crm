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

/** Detalhe amigável para erros de entrada do body-parser do Express (pacote http-errors). */
const DETALHE_DO_TIPO: Record<string, string> = {
  'entity.parse.failed': 'O corpo da requisição não é um JSON válido.',
  'entity.too.large': 'O corpo da requisição excede o tamanho máximo.',
  'encoding.unsupported': 'Codificação do corpo não suportada.',
  'charset.unsupported': 'Charset do corpo não suportado.',
};

/**
 * Status 4xx de erros de cliente que não são HttpException: o body-parser lança erros
 * http-errors (`status` + `expose`) antes de a requisição chegar ao Nest.
 */
function statusDeErroDoCliente(excecao: unknown): number | undefined {
  if (excecao instanceof HttpException) return excecao.getStatus();
  if (typeof excecao !== 'object' || excecao === null) return undefined;
  const { status, expose } = excecao as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true
    ? status
    : undefined;
}

@Catch()
export class FiltroProblema implements ExceptionFilter {
  private readonly logger = new Logger('Erros');

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const request_id = requestIdDa(res);
    const problema = { ...this.converter(excecao), request_id, instance: req.path };
    // Só falha do servidor vira log de erro; erro do cliente (4xx) não gera alerta.
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
    const status = statusDeErroDoCliente(excecao);
    if (status !== undefined) {
      const tipo = (excecao as { type?: unknown }).type;
      const detail = typeof tipo === 'string' ? DETALHE_DO_TIPO[tipo] : undefined;
      // 4xx sem código próprio no catálogo é tratado como entrada inválida.
      return criarProblema(CODIGO_DO_STATUS[status] ?? 'validacao', { detail });
    }
    return criarProblema('erro_interno');
  }
}
