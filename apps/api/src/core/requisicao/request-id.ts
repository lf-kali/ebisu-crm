import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CABECALHO_REQUEST_ID = 'x-request-id';
const REQUEST_ID_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;

/** Identifica cada requisição (D-T09). Reaproveita o id do proxy se for seguro; senão gera um. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const recebido = req.get(CABECALHO_REQUEST_ID);
  const id = recebido && REQUEST_ID_VALIDO.test(recebido) ? recebido : randomUUID();
  res.locals.requestId = id;
  res.setHeader(CABECALHO_REQUEST_ID, id);
  next();
}

export function requestIdDa(res: Response): string | undefined {
  return typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
}
