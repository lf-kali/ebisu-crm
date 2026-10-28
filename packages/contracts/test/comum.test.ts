import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CursorInvalidoError,
  ConsultaInvalidaError,
  Data,
  DataHora,
  Dinheiro,
  DinheiroNaoNegativo,
  MAXIMO_VALORES_IN,
  ParametrosPaginacao,
  TAMANHO_MAXIMO_CURSOR,
  Problema,
  Quantidade,
  camposDoZod,
  codificarCursor,
  criarProblema,
  decodificarCursor,
  extrairFiltros,
  extrairOrdem,
  paginado,
} from '../src/index.js';

const ok = (s: z.ZodType, v: unknown) => s.safeParse(v).success;

describe('escalares (§5.1)', () => {
  it('dinheiro: string com exatamente 2 casas, até 12 dígitos inteiros', () => {
    for (const v of ['0.00', '123.40', '-100.00', '999999999999.99'])
      expect(ok(Dinheiro, v), v).toBe(true);
    for (const v of [123.4, '123.4', '123', '1,00', '1000000000000.00', ' 1.00', '1.000']) {
      expect(ok(Dinheiro, v), String(v)).toBe(false);
    }
    expect(ok(DinheiroNaoNegativo, '-1.00')).toBe(false);
    expect(ok(DinheiroNaoNegativo, '1.00')).toBe(true);
  });

  it('dinheiro e quantidade em forma canônica: sem zeros à esquerda nem zero negativo', () => {
    for (const v of ['007.00', '00.00', '-0.00', '-01.00']) expect(ok(Dinheiro, v), v).toBe(false);
    for (const v of ['0.00', '0.50', '-1.00', '10.00']) expect(ok(Dinheiro, v), v).toBe(true);
    for (const v of ['007', '00', '-0', '-0.0', '-0.000']) expect(ok(Quantidade, v), v).toBe(false);
    for (const v of ['0', '0.5', '-0.5', '10']) expect(ok(Quantidade, v), v).toBe(true);
  });

  it('quantidade: até 3 casas', () => {
    for (const v of ['1', '1.5', '0.125', '-2']) expect(ok(Quantidade, v), v).toBe(true);
    for (const v of ['1.2345', 1, '1.', '.5']) expect(ok(Quantidade, v), String(v)).toBe(false);
  });

  it('datas: ISO 8601 com fuso; Date como YYYY-MM-DD válido', () => {
    expect(ok(DataHora, '2026-10-27T14:00:00-03:00')).toBe(true);
    expect(ok(DataHora, '2026-10-27T17:00:00Z')).toBe(true);
    expect(ok(DataHora, '2026-10-27T14:00:00')).toBe(false);
    expect(ok(Data, '2026-10-27')).toBe(true);
    expect(ok(Data, '2026-02-30')).toBe(false);
  });
});

describe('erros RFC 9457 (§5.1, §5.2)', () => {
  it('criarProblema usa status e title do catálogo e só inclui campos definidos', () => {
    const p = criarProblema('estoque_insuficiente', { invariante: 'EST-6', request_id: 'r1' });
    expect(p).toEqual({
      type: 'urn:ebisu:erro:estoque_insuficiente',
      title: 'Estoque insuficiente para esta peça.',
      status: 409,
      code: 'estoque_insuficiente',
      invariante: 'EST-6',
      request_id: 'r1',
    });
    expect(Problema.parse(p)).toEqual(p);
  });

  it('extras do código entram no envelope, sem sobrescrever os campos padrão', () => {
    const p = criarProblema('transicao_invalida', {
      extras: { estado_atual: 'PRONTA', status: 200, code: 'outro' },
    });
    expect(p).toMatchObject({ status: 409, code: 'transicao_invalida', estado_atual: 'PRONTA' });
  });

  it('camposDoZod converte issues em campos com caminho pontuado', () => {
    const r = z.object({ itens: z.array(z.object({ quantidade: Quantidade })) }).safeParse({
      itens: [{ quantidade: 'x' }],
    });
    expect(r.success).toBe(false);
    const campos = camposDoZod(r.error!);
    expect(campos).toHaveLength(1);
    expect(campos[0]).toMatchObject({ campo: 'itens.0.quantidade', code: 'invalid_format' });
    expect(Problema.parse(criarProblema('validacao', { campos })).campos).toEqual(campos);
  });
});

describe('paginação por cursor (§5.1)', () => {
  it('limit: padrão 25, coerção de string, mínimo 1, máximo 100', () => {
    expect(ParametrosPaginacao.parse({})).toEqual({ limit: 25 });
    expect(ParametrosPaginacao.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    for (const limit of ['0', '101', '2.5', 'dez'])
      expect(ok(ParametrosPaginacao, { limit }), limit).toBe(false);
  });

  it('cursor tem tamanho máximo, na entrada e na decodificação', () => {
    const longo = 'a'.repeat(TAMANHO_MAXIMO_CURSOR + 1);
    expect(ok(ParametrosPaginacao, { cursor: longo })).toBe(false);
    expect(ok(ParametrosPaginacao, { cursor: 'a'.repeat(TAMANHO_MAXIMO_CURSOR) })).toBe(true);
    expect(() => decodificarCursor(longo, z.unknown())).toThrow(CursorInvalidoError);
  });

  it('resposta paginada tem dados e proximo_cursor (string ou null)', () => {
    const Lista = paginado(z.object({ id: z.string() }));
    expect(ok(Lista, { dados: [{ id: 'a' }], proximo_cursor: null })).toBe(true);
    expect(ok(Lista, { dados: [], proximo_cursor: 'x' })).toBe(true);
    expect(ok(Lista, { dados: [] })).toBe(false);
  });

  const Posicao = z.strictObject({ created_at: z.string(), id: z.string() });

  it('cursor opaco faz ida e volta, inclusive com acentos', () => {
    const posicao = { created_at: '2026-10-27T14:00:00-03:00', id: 'ação-ç' };
    const cursor = codificarCursor(posicao);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificarCursor(cursor, Posicao)).toEqual(posicao);
  });

  it.each([
    ['base64 inválido', '***'],
    ['não é JSON', btoa('não json')],
    ['formato errado', codificarCursor({ id: 1 })],
    [
      'campo a mais (adulterado)',
      codificarCursor({ created_at: 'x', id: 'y', tenant_id: 'outro' }),
    ],
  ])('cursor rejeitado: %s', (_, cursor) => {
    expect(() => decodificarCursor(cursor, Posicao)).toThrow(CursorInvalidoError);
  });
});

describe('filtros e ordenação (§5.1)', () => {
  const campos = ['status', 'created_at', 'nome'];

  it('extrai igualdade, operadores e listas; ignora outros parâmetros', () => {
    expect(
      extrairFiltros(
        {
          'filtro[status]': 'ABERTO',
          'filtro[created_at][gte]': '2026-10-01',
          'filtro[created_at][lt]': '2026-11-01',
          'filtro[nome][in]': 'a,b',
          limit: '10',
          q: 'ana',
        },
        campos,
      ),
    ).toEqual({
      status: { eq: 'ABERTO' },
      created_at: { gte: '2026-10-01', lt: '2026-11-01' },
      nome: { in: ['a', 'b'] },
    });
  });

  it.each([
    ['campo não permitido', { 'filtro[senha_hash]': 'x' }],
    ['operador inválido', { 'filtro[status][like]': 'x' }],
    ['chave mal formada', { 'filtro[status': 'x' }],
    ['valor repetido (array)', { 'filtro[status]': ['a', 'b'] }],
  ])('recusa filtro: %s', (_, query) => {
    expect(() => extrairFiltros(query, campos)).toThrow(ConsultaInvalidaError);
  });

  it.each([
    ['valor vazio', { 'filtro[status]': '' }],
    ['lista in com item vazio', { 'filtro[nome][in]': 'a,,b' }],
    [
      'lista in grande demais',
      { 'filtro[nome][in]': Array.from({ length: MAXIMO_VALORES_IN + 1 }, (_, i) => i).join(',') },
    ],
  ])('recusa filtro: %s', (_, query) => {
    expect(() => extrairFiltros(query, campos)).toThrow(ConsultaInvalidaError);
  });

  it('lista in no limite é aceita', () => {
    const valores = Array.from({ length: MAXIMO_VALORES_IN }, (_, i) => String(i));
    expect(extrairFiltros({ 'filtro[nome][in]': valores.join(',') }, campos).nome?.in).toEqual(
      valores,
    );
  });

  it('nomes reservados nunca viram filtro, mesmo se o endpoint os permitir', () => {
    for (const nome of ['__proto__', 'constructor', 'prototype']) {
      expect(() => extrairFiltros({ [`filtro[${nome}]`]: 'x' }, [nome])).toThrow(
        ConsultaInvalidaError,
      );
    }
    expect(Object.getPrototypeOf(extrairFiltros({ 'filtro[status]': 'A' }, campos))).toBeNull();
  });

  it('ordem: "-created_at,nome" e recusa campo não permitido ou repetido', () => {
    expect(extrairOrdem('-created_at,nome', campos)).toEqual([
      { campo: 'created_at', direcao: 'desc' },
      { campo: 'nome', direcao: 'asc' },
    ]);
    expect(extrairOrdem(undefined, campos)).toEqual([]);
    expect(() => extrairOrdem('senha_hash', campos)).toThrow(ConsultaInvalidaError);
    expect(() => extrairOrdem('nome,-nome', campos)).toThrow(ConsultaInvalidaError);
  });
});
