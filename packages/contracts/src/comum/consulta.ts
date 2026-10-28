import { z } from 'zod';

// Filtros e ordenação de listagens (spec §5.1):
//   ?filtro[status]=ABERTO  ?filtro[created_at][gte]=2026-10-01  ?ordem=-created_at,nome  ?q=texto
// O Express 5 entrega a query sem aninhar, então lemos as chaves `filtro[...]` literalmente.

export const OPERADORES = ['eq', 'gte', 'gt', 'lte', 'lt', 'in'] as const;
export type Operador = (typeof OPERADORES)[number];
export type Filtros = Record<string, Partial<Record<Operador, string | string[]>>>;

/** Máximo de valores num filtro `in`. */
export const MAXIMO_VALORES_IN = 100;
const NOMES_RESERVADOS = new Set(['__proto__', 'constructor', 'prototype']);

export class ConsultaInvalidaError extends Error {
  constructor(
    readonly campo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ConsultaInvalidaError';
  }
}

const CHAVE_FILTRO = /^filtro\[([a-z_][a-z0-9_]*)\](?:\[([a-z]+)\])?$/;

/**
 * Extrai `filtro[campo]` e `filtro[campo][op]` da query, aceitando só campos permitidos.
 * `in` recebe valores separados por vírgula. Valores continuam string: cada endpoint os valida.
 */
export function extrairFiltros(
  query: Record<string, unknown>,
  permitidos: readonly string[],
): Filtros {
  // Sem protótipo: nenhum nome de campo consegue alterar o objeto de filtros.
  const filtros: Filtros = Object.create(null) as Filtros;
  for (const [chave, valor] of Object.entries(query)) {
    const casamento = CHAVE_FILTRO.exec(chave);
    if (!casamento) {
      if (chave.startsWith('filtro')) throw new ConsultaInvalidaError(chave, 'Filtro mal formado');
      continue;
    }
    const [, campo, operador = 'eq'] = casamento as unknown as [string, string, string?];
    if (NOMES_RESERVADOS.has(campo) || !permitidos.includes(campo)) {
      throw new ConsultaInvalidaError(chave, `Filtro não permitido: ${campo}`);
    }
    if (!(OPERADORES as readonly string[]).includes(operador)) {
      throw new ConsultaInvalidaError(chave, `Operador inválido: ${operador}`);
    }
    if (typeof valor !== 'string' || valor === '') {
      throw new ConsultaInvalidaError(chave, 'Filtro repetido ou vazio');
    }
    const op = operador as Operador;
    filtros[campo] = { ...filtros[campo], [op]: op === 'in' ? valoresIn(chave, valor) : valor };
  }
  return filtros;
}

function valoresIn(chave: string, valor: string): string[] {
  const valores = valor.split(',');
  if (valores.some((v) => v === '')) throw new ConsultaInvalidaError(chave, 'Valor vazio na lista');
  if (valores.length > MAXIMO_VALORES_IN) {
    throw new ConsultaInvalidaError(chave, `No máximo ${MAXIMO_VALORES_IN} valores`);
  }
  return valores;
}

export interface CriterioOrdem {
  campo: string;
  direcao: 'asc' | 'desc';
}

/** `-created_at,nome` → [{created_at, desc}, {nome, asc}], só com campos permitidos e sem repetir. */
export function extrairOrdem(
  ordem: string | undefined,
  permitidos: readonly string[],
): CriterioOrdem[] {
  if (ordem === undefined || ordem === '') return [];
  const criterios = ordem.split(',').map((parte): CriterioOrdem => {
    const desc = parte.startsWith('-');
    const campo = desc ? parte.slice(1) : parte;
    if (!permitidos.includes(campo))
      throw new ConsultaInvalidaError('ordem', `Ordenação não permitida: ${campo}`);
    return { campo, direcao: desc ? 'desc' : 'asc' };
  });
  if (new Set(criterios.map((c) => c.campo)).size !== criterios.length) {
    throw new ConsultaInvalidaError('ordem', 'Campo repetido na ordenação');
  }
  return criterios;
}

/** Busca textual `?q=` (onde o endpoint oferecer). */
export const BuscaTextual = z.string().trim().min(1).max(200).optional();
