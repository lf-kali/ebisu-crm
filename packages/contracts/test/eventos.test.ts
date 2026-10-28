import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIPOS_EVENTO, criarEvento, lerEvento } from '../src/index.js';

const ID = '0190d7c0-0000-7000-8000-000000000001';
const ID2 = '0190d7c0-0000-7000-8000-000000000002';

describe('eventos de domínio (§5.5)', () => {
  it('catálogo = eventos da tabela da spec §5.5', () => {
    const spec = readFileSync(new URL('../../../docs/spec-mvp.md', import.meta.url), 'utf8');
    const secao = spec.slice(spec.indexOf('### 5.5'), spec.indexOf('### 5.6'));
    const daSpec = [...secao.matchAll(/^\| (`[a-z_.]+`(?: \/ `[a-z_.]+`)*) \|/gm)].flatMap(
      ([, celula]) => [...celula!.matchAll(/`([a-z_.]+)`/g)].map(([, nome]) => nome),
    );
    expect([...TIPOS_EVENTO].sort()).toEqual(daSpec.sort());
  });

  it('criarEvento valida o payload', () => {
    expect(
      criarEvento('os.status_alterado', {
        os_id: ID,
        historico_id: ID2,
        de: 'EM_REPARO',
        para: 'EM_TESTES',
      }),
    ).toEqual({
      tipo: 'os.status_alterado',
      payload: { os_id: ID, historico_id: ID2, de: 'EM_REPARO', para: 'EM_TESTES' },
    });
    expect(() =>
      criarEvento('os.status_alterado', {
        os_id: ID,
        historico_id: ID2,
        de: 'EM_REPARO',
        para: 'CONSERTADA' as never,
      }),
    ).toThrow();
  });

  it('SEG-8: payload não aceita campos extras (ex.: dado pessoal)', () => {
    expect(() =>
      criarEvento('orcamento.enviado', {
        orcamento_id: ID,
        contato_id: ID2,
        email: 'a@b.c',
      } as never),
    ).toThrow();
  });

  it('lerEvento valida eventos vindos de fora do processo', () => {
    expect(lerEvento({ tipo: 'compra.recebida', payload: { compra_id: ID } })).toEqual({
      tipo: 'compra.recebida',
      payload: { compra_id: ID },
    });
    expect(() => lerEvento({ tipo: 'evento.inexistente', payload: {} })).toThrow();
    expect(() =>
      lerEvento({ tipo: 'os.entregue', payload: { os_id: ID, total: 10, custo_total: '1.00' } }),
    ).toThrow();
  });
});
