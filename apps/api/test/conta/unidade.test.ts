import { describe, expect, it } from 'vitest';
import { ErroDominio } from '../../src/core/erros/erro-dominio.js';
import { senhasVazadas, validarSenha } from '../../src/modules/auth/politica-senha.js';
import { slugDe } from '../../src/modules/auth/registro.service.js';

const pessoa = { email: 'jose.carvalho@oficina.com.br', nome: 'José Carvalho da Silva' };
const recusa = (senha: string) => () => validarSenha(senha, pessoa);

describe('política de senha', () => {
  it('a lista tem dezenas de milhares de senhas, todas com 12 a 128 caracteres', () => {
    const lista = senhasVazadas();
    expect(lista.size).toBeGreaterThan(40_000);
    expect(
      [...lista].every((s) => s.length >= 12 && s.length <= 128 && s === s.toLowerCase()),
    ).toBe(true);
    expect(lista.has('# senhas vazadas comuns com 12 a 128 caracteres')).toBe(false);
  });

  it('aceita uma frase longa sem dados pessoais', () => {
    expect(() => validarSenha('cavalo-bateria-grampo-42', pessoa)).not.toThrow();
    expect(() => validarSenha('açaí-pão-feijão-já', pessoa)).not.toThrow();
  });

  it('recusa senha com menos de 5 caracteres diferentes, inclusive só espaços', () => {
    expect(recusa(' '.repeat(12))).toThrow(ErroDominio);
    expect(recusa('ç'.repeat(12))).toThrow(ErroDominio);
    expect(recusa('abcdabcdabcd')).toThrow(ErroDominio);
    expect(() => validarSenha('abcdeabcdeab', pessoa)).not.toThrow();
  });

  it('compara com a lista depois de normalizar (NFKC): largura total não escapa', () => {
    expect(recusa('ＰＡＳＳＷＯＲＤ１２３４')).toThrow(ErroDominio);
  });

  it('espaços e caracteres invisíveis não escondem senha vazada nem dado pessoal', () => {
    expect(recusa('password\u200b1234')).toThrow(ErroDominio);
    expect(recusa('pass\u00adword1234')).toThrow(ErroDominio);
    expect(recusa('p a s s w o r d 1 2 3 4')).toThrow(ErroDominio);
    expect(recusa('car valho-2026-forte')).toThrow(ErroDominio);
  });

  it('a parte do e-mail sem pontuação, e cada pedaço dela, também contam', () => {
    const outra = { email: 'marina.duarte@oficina.com.br', nome: 'M D' };
    expect(() => validarSenha('marinaduarte99xx', outra)).toThrow(ErroDominio);
    expect(() => validarSenha('x-duarte-y-2026!', outra)).toThrow(ErroDominio);
  });

  it('recusa tamanho fora de 12 a 128', () => {
    expect(recusa('a'.repeat(11))).toThrow(ErroDominio);
    expect(recusa('a1-'.repeat(43))).toThrow(ErroDominio);
  });

  it('recusa senha vazada, em qualquer caixa', () => {
    expect(recusa('1qaz2wsx3edc')).toThrow(ErroDominio);
    expect(recusa('1QAZ2WSX3EDC')).toThrow(ErroDominio);
  });

  it('recusa o e-mail, a parte antes do @, o nome junto e cada palavra longa do nome', () => {
    for (const senha of [
      'x-jose.carvalho@oficina.com.br',
      'eu-sou-jose.carvalho!',
      'josecarvalhodasilva1',
      'Carvalho-2026-forte',
      'meu-SILVA-preferido',
      'JOSÉ-É-MEU-NOME-123',
    ])
      expect(recusa(senha), senha).toThrow(ErroDominio);
  });

  it('palavras curtas do nome não contam ("da" em "dados")', () => {
    expect(() => validarSenha('meus-dados-secretos-9', pessoa)).not.toThrow();
  });

  it('o erro é 422 no campo senha, sem dizer qual regra falhou', () => {
    try {
      validarSenha('1qaz2wsx3edc', pessoa);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      expect((erro as ErroDominio).code).toBe('validacao');
      expect((erro as ErroDominio).detalhes.campos).toEqual([
        expect.objectContaining({ campo: 'senha', code: 'senha_fraca' }),
      ]);
    }
  });
});

describe('slug da conta', () => {
  it('sem acento, minúsculo, com hífens', () => {
    expect(slugDe('Assistência São José')).toBe('assistencia-sao-jose');
    expect(slugDe('  --Ebisu & Cia.  ')).toBe('ebisu-cia');
  });

  it('nome sem letras nem números vira "conta"; nome longo é cortado em 50', () => {
    expect(slugDe('!!!')).toBe('conta');
    expect(slugDe('a'.repeat(80))).toHaveLength(50);
    expect(slugDe(`${'a'.repeat(49)} b`)).toBe('a'.repeat(49));
  });
});
