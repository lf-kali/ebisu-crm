import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { type CenarioIsolamento, IDS, type Quem } from './cenario.js';

// Matriz de isolamento reaproveitável (spec §4 F3, "pronto quando"): cada frente de domínio
// chama `testarIsolamento` para o seu recurso, sobre o cenário de criarCenarioIsolamento.
// Quem age é o `admin` da conta A, que tem acesso às empresas A1 e A2: o que separa as empresas
// é o X-Empresa-Id, não a falta de atribuição.

export interface RecursoIsolado {
  /** Caminho da coleção, ex.: /v1/contatos */
  rota: string;
  /** Ids de um registro em A1, outro em A2 e outro na conta B. */
  ids: { a1: string; a2: string; b1: string };
  /** Corpo de um PATCH válido. */
  edicao: Record<string, unknown>;
  /** Lê a linha direto no banco (superusuário), para provar que nada mudou. */
  linha(id: string): Promise<Record<string, unknown> | undefined>;
}

export function pedir(cenario: () => CenarioIsolamento) {
  return async (
    quem: Quem,
    metodo: 'get' | 'post' | 'patch' | 'delete',
    caminho: string,
    empresa: string | null,
    corpo?: object,
    /** Idempotency-Key do POST; sem ela, uma nova a cada chamada (como o cliente web). `null` omite. */
    chave?: string | null,
  ) => {
    const req = request(cenario().app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${await cenario().token(quem)}`);
    if (empresa) req.set('X-Empresa-Id', empresa);
    const idempotencia = chave === undefined && metodo === 'post' ? randomUUID() : chave;
    if (idempotencia) req.set('Idempotency-Key', idempotencia);
    return corpo ? req.send(corpo) : req;
  };
}

export function testarIsolamento(cenario: () => CenarioIsolamento, recurso: RecursoIsolado) {
  const http = pedir(cenario);
  const { a1, a2 } = IDS.empresas;
  const { rota, ids } = recurso;

  it('não lê pelo id um registro de outra empresa nem de outra conta (404)', async () => {
    expect((await http('admin', 'get', `${rota}/${ids.a1}`, a1)).status).toBe(200);
    expect((await http('admin', 'get', `${rota}/${ids.a2}`, a1)).status).toBe(404);
    expect((await http('admin', 'get', `${rota}/${ids.b1}`, a1)).status).toBe(404);
  });

  it('a lista de uma empresa só traz as linhas dela', async () => {
    const r = await http('admin', 'get', rota, a1);
    expect(r.status).toBe(200);
    const vistos = (r.body as { dados: Array<{ id: string; empresa_id: string }> }).dados;
    expect(vistos.map((d) => d.id)).toContain(ids.a1);
    expect(vistos.every((d) => d.empresa_id === a1)).toBe(true);
    expect(vistos.map((d) => d.id)).not.toContain(ids.a2);
    expect(vistos.map((d) => d.id)).not.toContain(ids.b1);
  });

  it('não edita nem exclui pelo id um registro de outra empresa ou conta, e nada muda', async () => {
    for (const alvo of [ids.a2, ids.b1]) {
      const antes = await recurso.linha(alvo);
      expect(antes).toBeDefined();
      expect((await http('admin', 'patch', `${rota}/${alvo}`, a1, recurso.edicao)).status).toBe(
        404,
      );
      expect((await http('admin', 'delete', `${rota}/${alvo}`, a1)).status).toBe(404);
      expect(await recurso.linha(alvo)).toEqual(antes);
    }
  });

  it('com o cabeçalho certo, a mesma pessoa acessa a outra empresa (o que separa é a empresa)', async () => {
    expect((await http('admin', 'get', `${rota}/${ids.a2}`, a2)).status).toBe(200);
  });
}
