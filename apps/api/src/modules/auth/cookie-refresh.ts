import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request, Response } from 'express';

// Cookie do refresh token (§5.1; plano F3-1, decisão 4). O prefixo __Host- obriga Secure,
// Path=/ e nenhum Domain: o cookie fica preso à origem que o recebeu. O navegador aceita Secure
// em http://localhost, então dev e produção usam o mesmo cookie.
export const NOME_COOKIE = '__Host-ebisu_refresh';
export const REFRESH_DIAS = 30;

const ATRIBUTOS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;

export const lerRefresh = (req: Request): string | undefined =>
  parseCookie(req.headers.cookie ?? '')[NOME_COOKIE] || undefined;

export function gravarRefresh(res: Response, token: string): void {
  res.append(
    'Set-Cookie',
    stringifySetCookie({
      name: NOME_COOKIE,
      value: token,
      ...ATRIBUTOS,
      maxAge: REFRESH_DIAS * 24 * 60 * 60,
    }),
  );
}

export function apagarRefresh(res: Response): void {
  res.append(
    'Set-Cookie',
    stringifySetCookie({ name: NOME_COOKIE, value: '', ...ATRIBUTOS, maxAge: 0 }),
  );
}
