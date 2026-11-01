import { randomUUID } from 'node:crypto';
import { RespostaEu } from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta } from '../conta/cenario.js';
import { type PedidoNaEmpresa, testarIsolamento } from './suite.js';

// Isolamento das rotas da F4 (plano docs/planos/f4-1-contatos.md, decisão 8): contatos, origens e
// motivos de perda na matriz por empresa. Conta X (empresas x1 e x2) e conta Y (y1); quem age é o
// dono de X. Os ids só existem depois do beforeAll: a matriz lê os campos na hora do teste.

let c: CenarioConta;
const x = { token: '', x1: '', x2: '' };
const contatos = { a1: '', a2: '', b1: '' };
const origens = { a1: '', a2: '', b1: '' };
const motivos = { a1: '', a2: '', b1: '' };

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
  const { token } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse((await pedir(token, 'get', '/v1/eu')).body);
  return { token, empresaId: eu.empresas[0]!.id };
}

/** Um contato, uma origem e um motivo na empresa dada. */
async function semear(token: string, empresa: string, sufixo: string) {
  return {
    contato: await criado(
      pedir(token, 'post', '/v1/contatos', empresa, {
        nome: `Contato ${sufixo}`,
        email: `c.${sufixo}@iso.test`,
      }),
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
  Object.assign(x, { token: dx.token, x1: dx.empresaId, x2 });
  const [a1, a2, b1] = [
    await semear(dx.token, dx.empresaId, 'a1'),
    await semear(dx.token, x2, 'a2'),
    await semear(dy.token, dy.empresaId, 'b1'),
  ];
  Object.assign(contatos, { a1: a1.contato, a2: a2.contato, b1: b1.contato });
  Object.assign(origens, { a1: a1.origem, a2: a2.origem, b1: b1.origem });
  Object.assign(motivos, { a1: a1.motivo, a2: a2.motivo, b1: b1.motivo });
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
