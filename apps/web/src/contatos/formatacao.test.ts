import { describe, expect, it } from 'vitest';
import { formatarData, formatarDocumento, formatarTelefone, telefonePrincipal } from './formatacao';

describe('formatação de contatos', () => {
  it('telefone do Brasil com DDD; fixo e celular', () => {
    expect(formatarTelefone('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatarTelefone('+551134567890')).toBe('(11) 3456-7890');
  });

  it('telefone de outro país fica como veio; vazio vira travessão', () => {
    expect(formatarTelefone('+351912345678')).toBe('+351912345678');
    expect(formatarTelefone(null)).toBe('—');
  });

  it('lista mostra o WhatsApp quando não há telefone', () => {
    expect(telefonePrincipal({ telefone_e164: null, whatsapp_e164: '+5521998765432' })).toBe(
      '(21) 99876-5432',
    );
  });

  it('CPF e CNPJ com máscara; data sem fuso', () => {
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarData('1990-03-07')).toBe('07/03/1990');
  });
});
