import { randomUUID } from 'node:crypto';
import { comTenant, PrismaClient } from '@ebisu/db';
import { type BancoDeTeste, criarBancoDeTeste } from '@ebisu/db/teste';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatarNumero,
  periodoDe,
  proximoNumero,
  type TipoDocumento,
} from '../src/core/sequencias/sequencias.js';

// Sequência de documentos (plano docs/planos/f3-6-sequencias-isolamento.md, decisões 1 a 3).

describe('formato e período (unidade)', () => {
  it('formata os três tipos e cresce acima de 9999 sem truncar', () => {
    expect(formatarNumero('OS-{AA}{MM}-{####}', '2610', 1)).toBe('OS-2610-0001');
    expect(formatarNumero('ORC-{AA}{MM}-{####}', '2601', 42)).toBe('ORC-2601-0042');
    expect(formatarNumero('CP-{AA}{MM}-{####}', '2612', 9999)).toBe('CP-2612-9999');
    expect(formatarNumero('OS-{AA}{MM}-{####}', '2610', 10000)).toBe('OS-2610-10000');
  });

  it('o mês é o do fuso da empresa, não o de UTC', () => {
    // 31/10 23h30 em São Paulo = 01/11 02h30 em UTC.
    const instante = new Date('2026-11-01T02:30:00Z');
    expect(periodoDe(instante, 'America/Sao_Paulo')).toBe('2610');
    expect(periodoDe(instante, 'UTC')).toBe('2611');
    expect(periodoDe(new Date('2026-12-31T15:30:00Z'), 'Asia/Tokyo')).toBe('2701');
  });
});

describe('proximoNumero (banco)', () => {
  let banco: BancoDeTeste;
  let admin: Awaited<ReturnType<BancoDeTeste['conectar']>>;
  let app: PrismaClient;
  const [contaA, contaB] = [randomUUID(), randomUUID()];
  const [a1, a2, b1, tokyo] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const OUTUBRO = new Date('2026-10-15T12:00:00Z');

  beforeAll(async () => {
    banco = await criarBancoDeTeste();
    admin = await banco.conectar(banco.urlAdmin);
    app = new PrismaClient({ datasourceUrl: banco.urlDoPapel('ebisu_app') });
    for (const [conta, slug] of [
      [contaA, 'a'],
      [contaB, 'b'],
    ] as const)
      await admin.query(
        `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'T', $2, now())`,
        [conta, slug],
      );
    for (const [empresa, conta, fuso] of [
      [a1, contaA, 'America/Sao_Paulo'],
      [a2, contaA, 'America/Sao_Paulo'],
      [tokyo, contaA, 'Asia/Tokyo'],
      [b1, contaB, 'America/Sao_Paulo'],
    ] as const)
      await admin.query(
        `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, timezone, updated_at)
         VALUES ($1, $2, 'E', 'E', $3, now())`,
        [empresa, conta, fuso],
      );
  }, 180_000);

  afterAll(async () => {
    await app?.$disconnect();
    await admin?.end();
    await banco?.container.stop();
  });

  const numero = (empresaId: string, tipo: TipoDocumento, agora = OUTUBRO, tenantId = contaA) =>
    comTenant(app, tenantId, (tx) => proximoNumero({ tx, tenantId, empresaId }, tipo, agora));

  it('números seguidos; empresas e tipos independentes; mês novo recomeça', async () => {
    expect(await numero(a1, 'ORDEM_SERVICO')).toBe('OS-2610-0001');
    expect(await numero(a1, 'ORDEM_SERVICO')).toBe('OS-2610-0002');
    expect(await numero(a1, 'ORCAMENTO')).toBe('ORC-2610-0001');
    expect(await numero(a1, 'COMPRA')).toBe('CP-2610-0001');
    expect(await numero(a2, 'ORDEM_SERVICO')).toBe('OS-2610-0001');
    expect(await numero(a1, 'ORDEM_SERVICO', new Date('2026-11-15T12:00:00Z'))).toBe(
      'OS-2611-0001',
    );
    expect(await numero(a1, 'ORDEM_SERVICO')).toBe('OS-2610-0003');
  });

  it('usa o fuso da empresa gravado no banco', async () => {
    expect(await numero(tokyo, 'COMPRA', new Date('2026-12-31T15:30:00Z'))).toBe('CP-2701-0001');
  });

  it('20 transações simultâneas recebem 1 a 20, sem repetir nem pular', async () => {
    const numeros = await Promise.all(Array.from({ length: 20 }, () => numero(a2, 'COMPRA')));
    expect(numeros.sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `CP-2610-${String(i + 1).padStart(4, '0')}`),
    );
  }, 60_000);

  it('comando que falha devolve o número (sem buraco)', async () => {
    const falha = comTenant(app, contaA, async (tx) => {
      await proximoNumero({ tx, tenantId: contaA, empresaId: a2 }, 'ORCAMENTO', OUTUBRO);
      throw new Error('comando falhou');
    });
    await expect(falha).rejects.toThrow('comando falhou');
    expect(await numero(a2, 'ORCAMENTO')).toBe('ORC-2610-0001');
  });

  it('outra conta não vê nem avança a sequência (RLS)', async () => {
    expect(await numero(b1, 'ORDEM_SERVICO', OUTUBRO, contaB)).toBe('OS-2610-0001');
    // Conta B pedindo número da empresa A1: a empresa não aparece sob o RLS de B.
    await expect(numero(a1, 'ORDEM_SERVICO', OUTUBRO, contaB)).rejects.toThrow();
    const visiveis = await comTenant(app, contaB, (tx) => tx.sequenciaDocumento.findMany());
    expect(visiveis.map((s) => s.empresa_id)).toEqual([b1]);
    const { rows } = await admin.query(
      `SELECT formato, proximo FROM sequencia_documento WHERE empresa_id = $1 AND tipo = 'ORDEM_SERVICO' AND periodo = '2610'`,
      [a1],
    );
    expect(rows).toEqual([{ formato: 'OS-{AA}{MM}-{####}', proximo: 4 }]);
  });
});
