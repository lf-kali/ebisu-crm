import { describe, expect, it } from 'vitest';
import { chaveEstavel } from './tabela-cursor';

describe('chaveEstavel', () => {
  it('não depende da ordem das chaves (também aninhadas) e preserva arrays', () => {
    expect(chaveEstavel({ b: 1, a: { d: 2, c: [3, 1] } })).toBe(
      chaveEstavel({ a: { c: [3, 1], d: 2 }, b: 1 }),
    );
    expect(chaveEstavel({ a: [1, 2] })).not.toBe(chaveEstavel({ a: [2, 1] }));
  });
});
