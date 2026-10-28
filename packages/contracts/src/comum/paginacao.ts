import { z } from 'zod';

// Paginação por cursor (spec §5.1): ?limit= (padrão 25, máx. 100) e ?cursor=.
// Resposta: { dados: [...], proximo_cursor: "…" | null }.

export const LIMITE_PADRAO = 25;
export const LIMITE_MAXIMO = 100;

export const ParametrosPaginacao = z
  .object({
    limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
    cursor: z.string().min(1).optional(),
  })
  .meta({ id: 'ParametrosPaginacao' });
export type ParametrosPaginacao = z.infer<typeof ParametrosPaginacao>;

export function paginado<T extends z.ZodType>(item: T) {
  return z.object({ dados: z.array(item), proximo_cursor: z.string().nullable() });
}

export class CursorInvalidoError extends Error {
  constructor() {
    super('Cursor de paginação inválido');
    this.name = 'CursorInvalidoError';
  }
}

// base64url com TextEncoder + btoa/atob: funciona no Node 24 e no navegador (o web importa este pacote).
function paraBase64Url(texto: string): string {
  const binario = Array.from(new TextEncoder().encode(texto), (b) => String.fromCharCode(b)).join(
    '',
  );
  return btoa(binario).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function deBase64Url(cursor: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new CursorInvalidoError();
  const binario = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binario, (c) => c.charCodeAt(0)),
  );
}

/** Cursor opaco: base64url de um JSON com a posição (ex.: { created_at, id }). */
export function codificarCursor(posicao: Record<string, unknown>): string {
  return paraBase64Url(JSON.stringify(posicao));
}

/** Decodifica e valida o cursor contra o formato esperado; qualquer desvio vira CursorInvalidoError. */
export function decodificarCursor<T extends z.ZodType>(cursor: string, formato: T): z.infer<T> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(deBase64Url(cursor));
  } catch {
    throw new CursorInvalidoError();
  }
  const resultado = formato.safeParse(bruto);
  if (!resultado.success) throw new CursorInvalidoError();
  return resultado.data;
}
