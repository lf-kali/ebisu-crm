import { randomUUID } from 'node:crypto';
import { RespostaEu } from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta, novoMembro } from '../conta/cenario.js';
import { type PedidoNaEmpresa, testarIsolamento } from './suite.js';

// Isolamento das rotas da F4 (plano docs/planos/f4-1-contatos.md, decisão 8): contatos, origens e
// motivos de perda na matriz por empresa, mais as opções de responsável (plano
// docs/planos/f4-web-1-contatos.md, decisão 6). Conta X (empresas x1 e x2) e conta Y (y1); quem age é o
// dono de X. Os ids só existem depois do beforeAll: a matriz lê os campos na hora do teste.

let c: CenarioConta;
const x = { token: '', tenantId: '', x1: '', x2: '', donoY: '' };
const contatos = { a1: '', a2: '', b1: '' };
const origens = { a1: '', a2: '', b1: '' };
const motivos = { a1: '', a2: '', b1: '' };
const negocios = { a1: '', a2: '', b1: '' };
const tarefas = { a1: '', a2: '', b1: '' };

function pedir(
  token: string,
  metodo: 'get' | 'post' | 'patch' | 'delete',
  caminho: string,
  empresa?: string,
  corpo?: object,
) {
  const req = request(c.app.getHttpServer())
    [metodo](caminho)
    .set('Authorization', `Bearer ${token}`);
  if (empresa) req.set('X-Empresa-Id', empresa);
  if (metodo === 'post') req.set('Idempotency-Key', randomUUID());
  return corpo ? req.send(corpo) : req;
}

async function criado(r: request.Test): Promise<string> {
  const resposta = await r;
  expect(resposta.status, JSON.stringify(resposta.body)).toBe(201);
  return (resposta.body as { id: string }).id;
}

async function conta(nome: string) {
  const { token, tenantId } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse((await pedir(token, 'get', '/v1/eu')).body);
  return { token, tenantId, empresaId: eu.empresas[0]!.id, membroId: eu.membro.id };
}

/** Um contato (com um negócio e uma tarefa), uma origem e um motivo na empresa dada. */
async function semear(token: string, empresa: string, sufixo: string) {
  const contato = await criado(
    pedir(token, 'post', '/v1/contatos', empresa, {
      nome: `Contato ${sufixo}`,
      email: `c.${sufixo}@iso.test`,
    }),
  );
  const negocio = await criado(
    pedir(token, 'post', '/v1/negocios', empresa, { contato_id: contato, titulo: `N ${sufixo}` }),
  );
  return {
    contato,
    negocio,
    tarefa: await criado(
      pedir(token, 'post', '/v1/tarefas', empresa, { titulo: `T ${sufixo}`, negocio_id: negocio }),
    ),
    origem: await criado(
      pedir(token, 'post', '/v1/origens', empresa, { nome: `Origem ${sufixo}`, tipo: 'OUTRO' }),
    ),
    motivo: await criado(
      pedir(token, 'post', '/v1/motivos-perda', empresa, { nome: `Motivo ${sufixo}` }),
    ),
  };
}

beforeAll(async () => {
  c = await criarCenarioConta();
  const dx = await conta('Conta X CRM');
  const dy = await conta('Conta Y CRM');
  const x2 = await criado(
    pedir(dx.token, 'post', '/v1/empresas', undefined, {
      razao_social: 'X Filial Ltda',
      nome_fantasia: 'X Filial',
    }),
  );
  Object.assign(x, {
    token: dx.token,
    tenantId: dx.tenantId,
    x1: dx.empresaId,
    x2,
    donoY: dy.membroId,
  });
  const [a1, a2, b1] = [
    await semear(dx.token, dx.empresaId, 'a1'),
    await semear(dx.token, x2, 'a2'),
    await semear(dy.token, dy.empresaId, 'b1'),
  ];
  Object.assign(contatos, { a1: a1.contato, a2: a2.contato, b1: b1.contato });
  Object.assign(origens, { a1: a1.origem, a2: a2.origem, b1: b1.origem });
  Object.assign(motivos, { a1: a1.motivo, a2: a2.motivo, b1: b1.motivo });
  Object.assign(negocios, { a1: a1.negocio, a2: a2.negocio, b1: b1.negocio });
  Object.assign(tarefas, { a1: a1.tarefa, a2: a2.tarefa, b1: b1.tarefa });
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

const naEmpresa: PedidoNaEmpresa = (metodo, caminho, empresa, corpo) =>
  pedir(x.token, metodo, caminho, empresa, corpo);
const acesso = () => ({ http: naEmpresa, empresas: { a1: x.x1, a2: x.x2 } });
const linha = async (sql: string, id: string) => (await c.sql(sql, [id])).rows[0];

describe('contatos (por empresa)', () => {
  testarIsolamento(acesso, {
    rota: '/v1/contatos',
    ids: contatos,
    edicao: { nome: 'Invadido' },
    linha: (id) =>
      linha(`SELECT empresa_id, nome, email, deleted_at FROM contato WHERE id = $1`, id),
  });
});

describe('origens (por empresa)', () => {
  testarIsolamento(acesso, {
    rota: '/v1/origens',
    ids: origens,
    edicao: { nome: 'Invadida' },
    linha: (id) => linha(`SELECT empresa_id, nome, ativo FROM origem_lead WHERE id = $1`, id),
  });
});

describe('motivos de perda (por empresa)', () => {
  testarIsolamento(acesso, {
    rota: '/v1/motivos-perda',
    ids: motivos,
    edicao: { nome: 'Invadido' },
    linha: (id) => linha(`SELECT empresa_id, nome, ativo FROM motivo_perda WHERE id = $1`, id),
  });
});

describe('negócios (por empresa)', () => {
  testarIsolamento(acesso, {
    rota: '/v1/negocios',
    ids: negocios,
    edicao: { versao_registro: 0, titulo: 'Invadido' },
    linha: (id) =>
      linha(
        `SELECT empresa_id, titulo, etapa_id, status, versao_registro, deleted_at FROM negocio WHERE id = $1`,
        id,
      ),
  });

  it('os comandos não alcançam negócio de outra empresa ou conta (404), e nada muda', async () => {
    for (const alvo of [negocios.a2, negocios.b1]) {
      const antes = await linha(
        `SELECT etapa_id, status, versao_registro FROM negocio WHERE id = $1`,
        alvo,
      );
      for (const [acao, corpo] of [
        ['mover', { etapa_id: randomUUID(), versao_registro: 0 }],
        ['perder', { motivo_perda_id: motivos.a1, versao_registro: 0 }],
        ['nutrir', { nba_adiada_ate: '2099-01-01T00:00:00Z', versao_registro: 0 }],
      ] as const)
        expect((await naEmpresa('post', `/v1/negocios/${alvo}/${acao}`, x.x1, corpo)).status).toBe(
          404,
        );
      expect(
        await linha(`SELECT etapa_id, status, versao_registro FROM negocio WHERE id = $1`, alvo),
      ).toEqual(antes);
    }
  });
});

describe('tarefas (por empresa)', () => {
  testarIsolamento(acesso, {
    rota: '/v1/tarefas',
    ids: tarefas,
    edicao: { titulo: 'Invadida' },
    linha: (id) => linha(`SELECT empresa_id, titulo, status FROM tarefa WHERE id = $1`, id),
  });

  it('não conclui tarefa de outra empresa ou conta, nem a liga a negócio de outra empresa', async () => {
    for (const alvo of [tarefas.a2, tarefas.b1])
      expect((await naEmpresa('post', `/v1/tarefas/${alvo}/concluir`, x.x1)).status).toBe(404);
    const r = await naEmpresa('post', '/v1/tarefas', x.x1, {
      titulo: 'X',
      negocio_id: negocios.a2,
    });
    expect(r.status).toBe(422);
  });
});

describe('funil (por empresa)', () => {
  it('cada empresa lê o seu; etapas de outra empresa no PATCH dão 422 e nada muda', async () => {
    const f1 = (await naEmpresa('get', '/v1/funil', x.x1)).body as {
      id: string;
      etapas: Array<Record<string, unknown>>;
    };
    const f2 = (await naEmpresa('get', '/v1/funil', x.x2)).body as {
      id: string;
      etapas: Array<Record<string, unknown>>;
    };
    expect(f1.id).not.toBe(f2.id);
    const etapas = f2.etapas.map(({ id, nome, ordem, probabilidade, sla_horas, cor }) => ({
      id,
      nome: `${String(nome)} invadida`,
      ordem,
      probabilidade,
      sla_horas,
      cor,
      requisitos: [],
    }));
    expect((await naEmpresa('patch', '/v1/funil', x.x1, { etapas })).status).toBe(422);
    const depois = (await naEmpresa('get', '/v1/funil', x.x2)).body as typeof f2;
    expect(depois).toEqual(f2);
  });
});

describe('opções de responsável (por empresa)', () => {
  const opcoes = async (empresa: string) => {
    const r = await pedir(x.token, 'get', '/v1/membros/opcoes', empresa);
    expect(r.status).toBe(200);
    return (r.body as { dados: Array<{ id: string }> }).dados.map((o) => o.id);
  };

  it('quem só tem acesso a outra empresa não aparece; membro de outra conta nunca', async () => {
    const soX2 = await novoMembro(c, x.tenantId, { 'contato.read': 'EMPRESA' }, x.x2);
    expect(await opcoes(x.x2)).toContain(soX2.membroId);
    expect(await opcoes(x.x1)).not.toContain(soX2.membroId);
    expect(await opcoes(x.x1)).not.toContain(x.donoY);
  });

  it('empresa de outra conta no cabeçalho: sem acesso', async () => {
    const outra = (await c.sql(`SELECT empresa_id FROM contato WHERE id = $1`, [contatos.b1]))
      .rows[0]!.empresa_id as string;
    const r = await pedir(x.token, 'get', '/v1/membros/opcoes', outra);
    expect(r.status).toBe(403);
  });
});
