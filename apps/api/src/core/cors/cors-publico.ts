import type { NextFunction, Request, Response } from 'express';
import { PREFIXO_ROTAS_PUBLICAS } from '../rbac/marcas.js';

// CORS só nas rotas da chave de navegador (plano docs/planos/f3-5-api-keys-cors.md, decisão 9).
// O preflight não traz a chave, então responde a qualquer origem; quem decide é a requisição de
// fato: o guard confere o Origin contra a chave e só então põe o Access-Control-Allow-Origin.
// Nunca `*` nem credenciais. Fora de /v1/publico/*, nenhum cabeçalho de CORS.

const CABECALHOS_PERMITIDOS = 'Content-Type, X-Api-Key, Idempotency-Key';
const MAX_AGE_SEGUNDOS = 600;

export function corsPublico(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.toLowerCase().startsWith(PREFIXO_ROTAS_PUBLICAS)) return next();
  res.vary('Origin');
  if (req.method !== 'OPTIONS') return next();
  const origem = req.get('origin');
  if (origem) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', CABECALHOS_PERMITIDOS);
    res.setHeader('Access-Control-Max-Age', String(MAX_AGE_SEGUNDOS));
  }
  res.status(204).end();
}
