import { z } from 'zod';

// CNPJ: 12 caracteres de base e 2 dígitos verificadores (módulo 11). Desde julho de 2026 a base
// pode ter letras (CNPJ alfanumérico, IN RFB 2.229/2024). Cada caractere vale o código ASCII
// menos 48, então o CNPJ só com números continua com o mesmo cálculo de sempre.

const PESOS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Sem máscara (pontos, barra, hífen e espaços) e com letras maiúsculas. */
export const normalizarCnpj = (valor: string) => valor.replace(/[\s./-]/g, '').toUpperCase();

function digitoVerificador(base: string): number {
  const pesos = PESOS.slice(PESOS.length - base.length);
  const soma = [...base].reduce((total, c, i) => total + (c.charCodeAt(0) - 48) * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Formato (com ou sem máscara) e dígitos verificadores. */
export function cnpjValido(valor: string): boolean {
  const cnpj = normalizarCnpj(valor);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  // Todos os caracteres iguais (ex.: 00000000000000) passam no cálculo, mas não existem.
  if (/^(.)\1+$/.test(cnpj)) return false;
  const base = cnpj.slice(0, 12);
  const primeiro = digitoVerificador(base);
  const segundo = digitoVerificador(base + primeiro);
  return cnpj.endsWith(`${primeiro}${segundo}`);
}

export const Cnpj = z.string().max(18).refine(cnpjValido, 'CNPJ inválido').meta({
  id: 'Cnpj',
  description: 'CNPJ numérico ou alfanumérico, com ou sem máscara; a API grava sem máscara',
  example: '11.222.333/0001-81',
});
