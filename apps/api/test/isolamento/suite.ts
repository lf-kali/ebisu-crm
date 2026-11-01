import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import type { CenarioIsolamento, Quem } from './cenario.js';

// Matriz de isolamento reaproveitável (spec §4 F3, "pronto quando"): cada frente de domínio
// chama `testarIsolamento` (por empresa) ou `testarIsolamentoDaConta` (rotas da conta).
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

/** Pedido de quem age na matriz por empresa (o `admin` da conta A no cenário de isolamento). */
export type PedidoNaEmpresa = (
  metodo: 'get' | 'post' | 'patch' | 'delete',
  caminho: string,
  empresa: string,
  corpo?: object,
) => PromiseLike<request.Response>;

export interface AcessoIsolamento {
  http: PedidoNaEmpresa;
  /** Duas empresas da conta de quem age, com acesso às duas. */
  empresas: { a1: string; a2: string };
}

export function testarIsolamento(acesso: () => AcessoIsolamento, recurso: RecursoIsolado) {
  const http: PedidoNaEmpresa = (...args) => acesso().http(...args);
  const { rota, ids } = recurso;
  const a1 = () => acesso().empresas.a1;
  const a2 = () => acesso().empresas.a2;

  it('não lê pelo id um registro de outra empresa nem de outra conta (404)', async () => {
    expect((await http('get', `${rota}/${ids.a1}`, a1())).status).toBe(200);
    expect((await http('get', `${rota}/${ids.a2}`, a1())).status).toBe(404);
    expect((await http('get', `${rota}/${ids.b1}`, a1())).status).toBe(404);
  });

  it('a lista de uma empresa só traz as linhas dela', async () => {
    const r = await http('get', rota, a1());
    expect(r.status).toBe(200);
    const vistos = (r.body as { dados: Array<{ id: string; empresa_id?: string }> }).dados;
    expect(vistos.map((d) => d.id)).toContain(ids.a1);
    // Quem devolve empresa_id na resposta: todas da empresa do cabeçalho.
    expect(vistos.every((d) => d.empresa_id === undefined || d.empresa_id === a1())).toBe(true);
    expect(vistos.map((d) => d.id)).not.toContain(ids.a2);
    expect(vistos.map((d) => d.id)).not.toContain(ids.b1);
  });

  it('não edita nem exclui pelo id um registro de outra empresa ou conta, e nada muda', async () => {
    for (const alvo of [ids.a2, ids.b1]) {
      const antes = await recurso.linha(alvo);
      expect(antes).toBeDefined();
      expect((await http('patch', `${rota}/${alvo}`, a1(), recurso.edicao)).status).toBe(404);
      expect((await http('delete', `${rota}/${alvo}`, a1())).status).toBe(404);
      expect(await recurso.linha(alvo)).toEqual(antes);
    }
  });

  it('com o cabeçalho certo, a mesma pessoa acessa a outra empresa (o que separa é a empresa)', async () => {
    expect((await http('get', `${rota}/${ids.a2}`, a2())).status).toBe(200);
  });
}

/** Pedido de quem age na matriz da conta (rotas sem X-Empresa-Id). */
export type PedidoNaConta = (
  metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
  caminho: string,
  corpo?: object,
) => PromiseLike<request.Response>;

export interface RecursoDaConta {
  /** Caminho da coleção, ex.: /v1/empresas */
  rota: string;
  /** Um registro da conta de quem age e outro de outra conta. */
  ids: { proprio: string; outro: string };
  /** Há `GET {rota}/{id}`. */
  ler: boolean;
  /** As escritas pelo id que a rota tem, ex.: `{ metodo: 'patch', corpo: {...} }`. */
  escritas: Array<{ metodo: 'post' | 'put' | 'patch' | 'delete'; sufixo?: string; corpo?: object }>;
  /** Lê a linha direto no banco (superusuário), para provar que nada mudou. */
  linha(id: string): Promise<Record<string, unknown> | undefined>;
}

/**
 * Matriz das rotas da conta (plano f3-6, decisão 5): o que separa é a conta do token. Registro de
 * outra conta não é lido, não aparece na lista e não muda por nenhuma escrita (404, nunca 403).
 */
export function testarIsolamentoDaConta(acesso: () => PedidoNaConta, recurso: RecursoDaConta) {
  const http: PedidoNaConta = (...args) => acesso()(...args);
  const { rota, ids } = recurso;

  if (recurso.ler)
    it('não lê pelo id um registro de outra conta (404)', async () => {
      expect((await http('get', `${rota}/${ids.proprio}`)).status).toBe(200);
      expect((await http('get', `${rota}/${ids.outro}`)).status).toBe(404);
    });

  it('a lista só traz registros da conta', async () => {
    const r = await http('get', rota);
    expect(r.status).toBe(200);
    const vistos = (r.body as { dados: Array<{ id: string }> }).dados.map((d) => d.id);
    expect(vistos).toContain(ids.proprio);
    expect(vistos).not.toContain(ids.outro);
  });

  it('nenhuma escrita pelo id alcança um registro de outra conta, e nada muda', async () => {
    const antes = await recurso.linha(ids.outro);
    expect(antes).toBeDefined();
    for (const { metodo, sufixo = '', corpo } of recurso.escritas) {
      const r = await http(metodo, `${rota}/${ids.outro}${sufixo}`, corpo);
      expect(r.status, `${metodo} ${sufixo}`).toBe(404);
    }
    expect(await recurso.linha(ids.outro)).toEqual(antes);
  });
}
