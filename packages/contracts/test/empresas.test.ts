import { describe, expect, it } from 'vitest';
import {
  cnpjValido,
  EdicaoEmpresa,
  EntradaEmpresa,
  EntradaRegistro,
  normalizarCnpj,
} from '../src/index.js';

describe('CNPJ', () => {
  it('aceita CNPJ numérico com e sem máscara', () => {
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11.222.333/0002-62')).toBe(true);
  });

  it('o schema tira espaços nas pontas antes de validar o tamanho', () => {
    const r = EntradaEmpresa.safeParse({
      razao_social: 'X',
      nome_fantasia: 'X',
      cnpj: '  11.222.333/0001-81  ',
    });
    expect(r.success && r.data.cnpj).toBe('11.222.333/0001-81');
  });

  it('aceita o CNPJ alfanumérico (exemplo da Receita Federal), também em minúsculas', () => {
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true);
    expect(cnpjValido('12abc34501de35')).toBe(true);
    expect(normalizarCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('recusa dígito errado, tamanho errado, letra no dígito e caracteres repetidos', () => {
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('12ABC34501DE36')).toBe(false);
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('12ABC34501DE3A')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
  });
});

describe('contratos de empresas e cadastro (F3-4a)', () => {
  it('empresa exige razão social e nome fantasia; CNPJ é opcional e validado', () => {
    const base = { razao_social: 'Ebisu Ltda', nome_fantasia: 'Ebisu' };
    expect(EntradaEmpresa.safeParse(base).success).toBe(true);
    expect(EntradaEmpresa.safeParse({ ...base, cnpj: '11222333000181' }).success).toBe(true);
    expect(EntradaEmpresa.safeParse({ ...base, cnpj: '11222333000182' }).success).toBe(false);
    expect(EntradaEmpresa.safeParse({ ...base, nome_fantasia: '  ' }).success).toBe(false);
  });

  it('edição precisa de ao menos um campo e aceita null para remover o CNPJ', () => {
    expect(EdicaoEmpresa.safeParse({}).success).toBe(false);
    expect(EdicaoEmpresa.safeParse({ cnpj: null }).success).toBe(true);
    expect(EdicaoEmpresa.safeParse({ nome_fantasia: 'Nova' }).success).toBe(true);
  });

  it('cadastro exige senha de 12 a 128 caracteres', () => {
    const entrada = {
      nome: 'Ana',
      email: 'ana@ebisu.dev',
      senha: 'x'.repeat(12),
      conta: { nome: 'Assistência' },
      empresa: { razao_social: 'Ebisu Ltda', nome_fantasia: 'Ebisu' },
    };
    expect(EntradaRegistro.safeParse(entrada).success).toBe(true);
    expect(EntradaRegistro.safeParse({ ...entrada, senha: 'x'.repeat(11) }).success).toBe(false);
    expect(EntradaRegistro.safeParse({ ...entrada, senha: 'x'.repeat(129) }).success).toBe(false);
  });
});
