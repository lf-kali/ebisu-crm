import { cpfValido } from '@ebisu/contracts';
import { normalizarBusca } from '@ebisu/db';
import { describe, expect, it } from 'vitest';
import {
  normalizarDocumento,
  normalizarEmail,
  normalizarTelefone,
} from '../../src/core/normalizacao/normalizacao.js';

// Normalização de meios de contato (plano docs/planos/f4-1-contatos.md, decisões 2 e 5).

describe('normalização', () => {
  it('e-mail: trim e minúsculas', () => {
    expect(normalizarEmail('  Fulano.Silva@Exemplo.COM ')).toBe('fulano.silva@exemplo.com');
  });

  it('telefone: E.164 com Brasil como padrão; outros países com +DDI; inválido é null', () => {
    expect(normalizarTelefone('(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizarTelefone('11 3456-7890')).toBe('+551134567890');
    expect(normalizarTelefone('+55 21 99876-5432')).toBe('+5521998765432');
    expect(normalizarTelefone('+351 912 345 678')).toBe('+351912345678');
    expect(normalizarTelefone('12345')).toBeNull();
    expect(normalizarTelefone('(11) 1234-5678')).toBeNull();
    expect(normalizarTelefone('abc')).toBeNull();
  });

  it('documento: CPF para PF e CNPJ para PJ, sem máscara', () => {
    expect(normalizarDocumento('529.982.247-25', 'PF')).toBe('52998224725');
    expect(normalizarDocumento('529.982.247-26', 'PF')).toBeNull();
    expect(normalizarDocumento('111.111.111-11', 'PF')).toBeNull();
    expect(normalizarDocumento('11.222.333/0001-81', 'PJ')).toBe('11222333000181');
    expect(normalizarDocumento('529.982.247-25', 'PJ')).toBeNull();
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('5299822472')).toBe(false);
  });

  it('busca: sem acento, minúsculas e espaços simples', () => {
    expect(normalizarBusca('  João  da Conceição ')).toBe('joao da conceicao');
    expect(normalizarBusca('ÁRVORE Ñandú')).toBe('arvore nandu');
  });
});
