import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOGO_ERROS, Canal, StatusOrcamento, StatusOS } from '../src/index.js';

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('paridade com a spec e com o banco', () => {
  it('catálogo de erros = tabela da spec §5.2 (códigos e HTTP)', () => {
    const spec = ler('../../../docs/spec-mvp.md');
    const secao = spec.slice(spec.indexOf('### 5.2'), spec.indexOf('### 5.3'));
    const linhas = [...secao.matchAll(/^\| `([a-z_]+)` \| (\d{3}) \|/gm)].map(([, code, http]) => [
      code,
      Number(http),
    ]);
    expect(linhas.length).toBeGreaterThan(10);
    expect(Object.entries(CATALOGO_ERROS).map(([code, { status }]) => [code, status])).toEqual(
      linhas,
    );
  });

  it.each([
    ['StatusOS', StatusOS.options],
    ['StatusOrcamento', StatusOrcamento.options],
    ['CanalComunicacao', Canal.options],
  ])('enum %s espelha o schema.prisma', (nome, valores) => {
    const schema = ler('../../db/prisma/schema.prisma');
    const bloco = new RegExp(`enum ${nome} \\{([^}]*)\\}`).exec(schema)?.[1];
    expect(bloco, `enum ${nome} não encontrado`).toBeDefined();
    const doBanco = bloco!
      .split('\n')
      .map((linha) => linha.replace(/\/\/\/.*$/, '').trim())
      .filter(Boolean);
    expect([...valores]).toEqual(doBanco);
  });
});
