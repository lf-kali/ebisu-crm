import { cnpjValido, cpfValido, normalizarCnpj, normalizarCpf } from '@ebisu/contracts';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Normalização de meios de contato (plano docs/planos/f4-1-contatos.md, decisão 2): a forma
// canônica é a que vai para o banco e para o dedupe (CRM-1).

/** Trim e minúsculas: `Fulano@Exemplo.com ` vira `fulano@exemplo.com`. */
export const normalizarEmail = (email: string) => email.trim().toLowerCase();

/**
 * Metadado completo (`/max`): confere também os prefixos válidos do país, não só o comprimento
 * (ex.: fixo brasileiro começa de 2 a 5).
 *
 * E.164, com Brasil como país padrão para número sem `+DDI`. Devolve null se não for um número
 * válido (quem chama responde 422 no campo).
 */
export function normalizarTelefone(telefone: string): string | null {
  const numero = parsePhoneNumberFromString(telefone.trim(), 'BR');
  return numero?.isValid() ? numero.number : null;
}

/** Dígitos para busca por telefone: `(11) 9876` vira `119876`. */
export const digitosDoTelefone = (texto: string) => texto.replace(/\D/g, '');

/** CPF (PF) ou CNPJ (PJ) conferido e sem máscara; null se inválido para o tipo. */
export function normalizarDocumento(documento: string, tipo: 'PF' | 'PJ'): string | null {
  if (tipo === 'PF') return cpfValido(documento) ? normalizarCpf(documento) : null;
  return cnpjValido(documento) ? normalizarCnpj(documento) : null;
}
