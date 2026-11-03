import { randomUUID } from 'node:crypto';
import {
  Atividade,
  Contato,
  ListaAtividades,
  NegocioDetalhado,
  RespostaEu,
} from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta, novoMembro } from '../conta/cenario.js';

// Atividades, a timeline do contato e do negócio (plano docs/planos/f4-2b-atividades.md).

let c: CenarioConta;

beforeAll(async () => {
  c = await criarCenarioConta();
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

interface Conta {
  token: string;
  tenantId: string;
  empresaId: string;
  donoId: string;
}

type Quem = { token: string; empresaId: string };

async function conta(nome: string): Promise<Conta> {
  const { token, tenantId } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse(
    (await request(c.app.getHttpServer()).get('/v1/eu').set('Authorization', `Bearer ${token}`))
      .body,
  );
  return { token, tenantId, empresaId: eu.empresas[0]!.id, donoId: eu.membro.id };
}

function pedir(x: Quem, metodo: 'get' | 'post' | 'patch' | 'delete', rota: string, corpo?: object) {
  const req = request(c.app.getHttpServer())
    [metodo](rota)
    .set('Authorization', `Bearer ${x.token}`)
    .set('X-Empresa-Id', x.empresaId);
  if (metodo === 'post') req.set('Idempotency-Key', randomUUID());
  return corpo ? req.send(corpo) : req;
}

async function ok<T>(r: request.Test, schema: { parse: (v: unknown) => T }, status = 200) {
  const resposta = await r;
  expect(resposta.status, JSON.stringify(resposta.body)).toBe(status);
  return schema.parse(resposta.body);
}

const contato = (x: Quem, corpo: object = {}) =>
  ok(
    pedir(x, 'post', '/v1/contatos', {
      nome: 'Rui Paz',
      email: `${randomUUID()}@a.test`,
      ...corpo,
    }),
    Contato,
    201,
  );

const registrar = (x: Quem, corpo: object) =>
  ok(pedir(x, 'post', '/v1/atividades', corpo), Atividade, 201);

const ligacao = (contatoId: string, extra: object = {}) => ({
  tipo: 'LIGACAO',
  direcao: 'SAIDA',
  contato_id: contatoId,
  ...extra,
});

const ultimaInteracao = async (x: Quem, id: string) =>
  (await ok(pedir(x, 'get', `/v1/contatos/${id}`), Contato)).ultima_interacao_em;

/** Simula o tempo: a atividade foi registrada há tantas horas. */
const registradaHa = (id: string, horas: number) =>
  c.sql(`UPDATE atividade SET registrada_em = now() - make_interval(hours => $2) WHERE id = $1`, [
    id,
    horas,
  ]);

describe('registrar', () => {
  it('registra conversas e notas; a nota é interna; o autor é quem age', async () => {
    const x = await conta('Conta Atividades');
    const k = await contato(x);
    const a = await registrar(x, ligacao(k.id, { assunto: 'Orçamento', resultado: 'não atendeu' }));
    expect(a).toMatchObject({
      tipo: 'LIGACAO',
      direcao: 'SAIDA',
      contato_id: k.id,
      negocio_id: null,
      membro_id: x.donoId,
      resultado: 'não atendeu',
    });
    const nota = await registrar(x, {
      tipo: 'NOTA',
      conteudo: 'Prefere à tarde',
      contato_id: k.id,
    });
    expect(nota.direcao).toBe('INTERNA');
  });

  it('recusa tipo do sistema, direção ausente ou na nota, data no futuro e falta de vínculo', async () => {
    const x = await conta('Conta Atividades Inválidas');
    const k = await contato(x);
    for (const corpo of [
      { tipo: 'SISTEMA', direcao: 'SAIDA', contato_id: k.id },
      { tipo: 'FORMULARIO', direcao: 'ENTRADA', contato_id: k.id },
      { tipo: 'NOTA_TECNICA', direcao: 'SAIDA', contato_id: k.id },
      { tipo: 'LIGACAO', contato_id: k.id },
      { tipo: 'NOTA', direcao: 'SAIDA', contato_id: k.id },
      { tipo: 'LIGACAO', direcao: 'SAIDA' },
      ligacao(k.id, { ocorreu_em: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
      ligacao(k.id, { membro_id: x.donoId }),
    ])
      expect((await pedir(x, 'post', '/v1/atividades', corpo)).status, JSON.stringify(corpo)).toBe(
        422,
      );
  });

  it('com negócio, o contato é o dele; que não combinam ou de outra empresa dá 422', async () => {
    const x = await conta('Conta Atividade Vínculo');
    const y = await conta('Outra Atividade Vínculo');
    const k = await contato(x);
    const outro = await contato(x);
    const n = await ok(
      pedir(x, 'post', '/v1/negocios', { contato_id: k.id, titulo: 'Bateria' }),
      NegocioDetalhado,
      201,
    );
    const a = await registrar(x, { tipo: 'WHATSAPP', direcao: 'ENTRADA', negocio_id: n.id });
    expect(a.contato_id).toBe(k.id);
    const errado = await pedir(x, 'post', '/v1/atividades', {
      ...ligacao(outro.id),
      negocio_id: n.id,
    });
    expect(errado.status).toBe(422);
    const deY = await contato(y);
    expect((await pedir(x, 'post', '/v1/atividades', ligacao(deY.id))).status).toBe(422);
  });
});

describe('contato herdado do negócio', () => {
  it('quem vê o negócio mas não o contato dele não registra atividade nem tarefa nele (422)', async () => {
    const x = await conta('Conta Contato Herdado');
    const vendedor = await novoMembro(
      c,
      x.tenantId,
      {
        'contato.read': 'PROPRIO',
        'negocio.read': 'EMPRESA',
        'atividade.create': 'EMPRESA',
        'tarefa.create': 'EMPRESA',
      },
      x.empresaId,
    );
    const v = { token: vendedor.token, empresaId: x.empresaId };
    const doDono = await contato(x, { responsavel_id: x.donoId });
    const n = await ok(
      pedir(x, 'post', '/v1/negocios', { contato_id: doDono.id, titulo: 'Do dono' }),
      NegocioDetalhado,
      201,
    );
    const atividade = await pedir(v, 'post', '/v1/atividades', {
      tipo: 'LIGACAO',
      direcao: 'SAIDA',
      negocio_id: n.id,
    });
    expect(atividade.status).toBe(422);
    const tarefa = await pedir(v, 'post', '/v1/tarefas', { titulo: 'X', negocio_id: n.id });
    expect(tarefa.status).toBe(422);
    expect(await ultimaInteracao(x, doDono.id)).toBeNull();
  });
});

describe('timeline', () => {
  it('da mais recente à mais antiga, com páginas, desempate e filtros', async () => {
    const x = await conta('Conta Timeline');
    const k = await contato(x);
    const outro = await contato(x);
    const mesmaHora = '2026-10-20T15:00:00.000Z';
    const antiga = await registrar(x, ligacao(k.id, { ocorreu_em: '2026-10-01T10:00:00Z' }));
    const a1 = await registrar(x, ligacao(k.id, { ocorreu_em: mesmaHora }));
    const a2 = await registrar(x, { tipo: 'NOTA', contato_id: k.id, ocorreu_em: mesmaHora });
    await registrar(x, ligacao(outro.id));
    const lista = (q: string) =>
      ok(pedir(x, 'get', `/v1/atividades?filtro[contato_id]=${k.id}&${q}`), ListaAtividades);
    const p1 = await lista('limit=2');
    // Mesma hora: o id mais novo primeiro (UUID v7).
    expect(p1.dados.map((a) => a.id)).toEqual([a2.id, a1.id]);
    const p2 = await lista(`limit=2&cursor=${p1.proximo_cursor}`);
    expect(p2).toMatchObject({ dados: [{ id: antiga.id }], proximo_cursor: null });
    const notas = await lista('filtro[tipo]=NOTA');
    expect(notas.dados.map((a) => a.id)).toEqual([a2.id]);
    expect((await pedir(x, 'get', '/v1/atividades?filtro[outro]=1')).status).toBe(422);
  });

  it('PROPRIO só vê as próprias, mesmo filtrando pelo contato', async () => {
    const x = await conta('Conta Timeline Própria');
    const vendedor = await novoMembro(
      c,
      x.tenantId,
      { 'contato.read': 'EMPRESA', 'atividade.read': 'PROPRIO', 'atividade.create': 'EMPRESA' },
      x.empresaId,
    );
    const v = { token: vendedor.token, empresaId: x.empresaId };
    const k = await contato(x);
    const doDono = await registrar(x, ligacao(k.id));
    const minha = await registrar(v, ligacao(k.id));
    const vistas = await ok(
      pedir(v, 'get', `/v1/atividades?filtro[contato_id]=${k.id}`),
      ListaAtividades,
    );
    expect(vistas.dados.map((a) => a.id)).toEqual([minha.id]);
    expect((await pedir(v, 'get', `/v1/atividades/${doDono.id}`)).status).toBe(404);
  });
});

describe('corrigir', () => {
  async function cenarioPrazo(nome: string) {
    const x = await conta(nome);
    const autor = await novoMembro(
      c,
      x.tenantId,
      {
        'contato.read': 'EMPRESA',
        'atividade.read': 'PROPRIO',
        'atividade.create': 'EMPRESA',
        'atividade.update': 'PROPRIO',
        'atividade.delete': 'PROPRIO',
      },
      x.empresaId,
    );
    return { x, a: { token: autor.token, empresaId: x.empresaId }, k: await contato(x) };
  }

  it('o autor PROPRIO corrige e apaga nas primeiras 24 horas; depois, 409', async () => {
    const { a, k } = await cenarioPrazo('Conta Prazo');
    const minha = await registrar(a, ligacao(k.id));
    const editada = await ok(
      pedir(a, 'patch', `/v1/atividades/${minha.id}`, { resultado: 'atendeu', assunto: null }),
      Atividade,
    );
    expect(editada).toMatchObject({ resultado: 'atendeu', assunto: null });
    await registradaHa(minha.id, 25);
    const tarde = await pedir(a, 'patch', `/v1/atividades/${minha.id}`, { resultado: 'x' });
    expect([tarde.status, tarde.body.code]).toEqual([409, 'transicao_invalida']);
    expect((await pedir(a, 'delete', `/v1/atividades/${minha.id}`)).status).toBe(409);

    // Registrar hoje uma ligação de ontem: o prazo conta do registro.
    const deOntem = await registrar(
      a,
      ligacao(k.id, { ocorreu_em: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() }),
    );
    expect((await pedir(a, 'delete', `/v1/atividades/${deOntem.id}`)).status).toBe(204);
  });

  it('PROPRIO não mexe na atividade de outra pessoa; EMPRESA corrige depois do prazo', async () => {
    const { x, a, k } = await cenarioPrazo('Conta Prazo Gestor');
    const doDono = await registrar(x, ligacao(k.id));
    expect(
      (await pedir(a, 'patch', `/v1/atividades/${doDono.id}`, { resultado: 'x' })).status,
    ).toBe(404);
    const minha = await registrar(a, ligacao(k.id));
    await registradaHa(minha.id, 72);
    const corrigida = await ok(
      pedir(x, 'patch', `/v1/atividades/${minha.id}`, { resultado: 'corrigido pelo gestor' }),
      Atividade,
    );
    expect(corrigida.resultado).toBe('corrigido pelo gestor');
    expect((await pedir(x, 'delete', `/v1/atividades/${minha.id}`)).status).toBe(204);
  });

  it('atividade do sistema nunca muda; nota continua interna', async () => {
    const x = await conta('Conta Sistema');
    const k = await contato(x);
    const id = randomUUID();
    await c.sql(
      `INSERT INTO atividade (id, tenant_id, empresa_id, contato_id, tipo, direcao) VALUES ($1, $2, $3, $4, 'SISTEMA', 'INTERNA')`,
      [id, x.tenantId, x.empresaId, k.id],
    );
    expect((await pedir(x, 'patch', `/v1/atividades/${id}`, { conteudo: 'x' })).status).toBe(409);
    expect((await pedir(x, 'delete', `/v1/atividades/${id}`)).status).toBe(409);
    const nota = await registrar(x, { tipo: 'NOTA', contato_id: k.id });
    expect(
      (await pedir(x, 'patch', `/v1/atividades/${nota.id}`, { direcao: 'SAIDA' })).status,
    ).toBe(422);
  });
});

describe('última interação', () => {
  it('sobe com a conversa, ignora a nota e volta ao apagar ou ao mudar a data', async () => {
    const x = await conta('Conta Última Interação');
    const k = await contato(x);
    expect(await ultimaInteracao(x, k.id)).toBeNull();
    await registrar(x, { tipo: 'NOTA', contato_id: k.id });
    expect(await ultimaInteracao(x, k.id)).toBeNull();
    const antiga = await registrar(x, ligacao(k.id, { ocorreu_em: '2026-10-01T10:00:00Z' }));
    expect(await ultimaInteracao(x, k.id)).toBe('2026-10-01T10:00:00.000Z');
    const nova = await registrar(x, {
      tipo: 'WHATSAPP',
      direcao: 'ENTRADA',
      contato_id: k.id,
      ocorreu_em: '2026-10-15T10:00:00Z',
    });
    expect(await ultimaInteracao(x, k.id)).toBe('2026-10-15T10:00:00.000Z');
    await ok(
      pedir(x, 'patch', `/v1/atividades/${nova.id}`, { ocorreu_em: '2026-09-01T10:00:00Z' }),
      Atividade,
    );
    expect(await ultimaInteracao(x, k.id)).toBe('2026-10-01T10:00:00.000Z');
    expect((await pedir(x, 'delete', `/v1/atividades/${antiga.id}`)).status).toBe(204);
    expect(await ultimaInteracao(x, k.id)).toBe('2026-09-01T10:00:00.000Z');
  });
});
