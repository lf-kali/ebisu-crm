import { z } from 'zod';

// CPF: 9 dígitos de base e 2 verificadores (módulo 11, pesos decrescentes a partir de 10 e 11).

/** Só os dígitos. */
export const normalizarCpf = (valor: string) => valor.replace(/\D/g, '');

function digito(base: string): number {
  const peso = base.length + 1;
  const soma = [...base].reduce((total, c, i) => total + Number(c) * (peso - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/** Formato (com ou sem máscara) e dígitos verificadores. */
export function cpfValido(valor: string): boolean {
  const cpf = normalizarCpf(valor);
  if (!/^\d{11}$/.test(valor.replace(/[.\-\s]/g, '')) || cpf.length !== 11) return false;
  // Todos os dígitos iguais (ex.: 111.111.111-11) passam no cálculo, mas não existem.
  if (/^(\d)\1+$/.test(cpf)) return false;
  const primeiro = digito(cpf.slice(0, 9));
  const segundo = digito(cpf.slice(0, 9) + primeiro);
  return cpf.endsWith(`${primeiro}${segundo}`);
}

export const Cpf = z.string().trim().max(14).refine(cpfValido, 'CPF inválido').meta({
  id: 'Cpf',
  description: 'CPF com ou sem máscara; a API grava só os dígitos',
  example: '529.982.247-25',
});
