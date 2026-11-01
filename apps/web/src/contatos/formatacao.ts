import type { CanalComunicacao, CicloVida, Contato } from '@ebisu/contracts';

// Rótulos e formatação das telas de contatos (plano docs/planos/f4-web-1-contatos.md).

/**
 * Telefone em E.164 para a tela (decisão 9): do Brasil, `(11) 98765-4321` ou `(11) 3456-7890`;
 * de outro país, como veio. Sem a biblioteca de telefone no navegador.
 */
export function formatarTelefone(e164: string | null): string {
  if (!e164) return '—';
  const brasil = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!brasil) return e164;
  const [, ddd, inicio, fim] = brasil;
  return `(${ddd}) ${inicio}-${fim}`;
}

/** CPF (11 dígitos) ou CNPJ (14) com máscara; outro formato, como veio. */
export function formatarDocumento(documento: string | null): string {
  if (!documento) return '—';
  if (/^\d{11}$/.test(documento))
    return documento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (documento.length === 14)
    return `${documento.slice(0, 2)}.${documento.slice(2, 5)}.${documento.slice(5, 8)}/${documento.slice(8, 12)}-${documento.slice(12)}`;
  return documento;
}

/** Data YYYY-MM-DD em pt-BR, sem passar por fuso horário. */
export const formatarData = (data: string | null) =>
  data ? data.split('-').reverse().join('/') : '—';

export const CICLO_VIDA: Record<CicloVida, string> = {
  LEAD: 'Lead',
  LEAD_QUALIFICADO: 'Lead qualificado',
  OPORTUNIDADE: 'Oportunidade',
  CLIENTE: 'Cliente',
  RECORRENTE: 'Recorrente',
  INATIVO: 'Inativo',
};

export const CANAIS: Record<CanalComunicacao, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  SMS: 'SMS',
};

export const FINALIDADES = { TRANSACIONAL: 'Transacional', MARKETING: 'Marketing' } as const;

export const BASES_LEGAIS = {
  consentimento: 'Consentimento',
  execucao_contrato: 'Execução de contrato',
  legitimo_interesse: 'Legítimo interesse',
} as const;

export const TIPO_PESSOA: Record<Contato['tipo_pessoa'], string> = {
  PF: 'Pessoa física',
  PJ: 'Pessoa jurídica',
};

/** Telefone principal da lista: o telefone, ou o WhatsApp quando não há telefone (decisão 2). */
export const telefonePrincipal = (contato: Pick<Contato, 'telefone_e164' | 'whatsapp_e164'>) =>
  formatarTelefone(contato.telefone_e164 ?? contato.whatsapp_e164);
