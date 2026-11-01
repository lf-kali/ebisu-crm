import { randomUUID } from 'node:crypto';
import { ListaPapeis, RespostaEu } from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta } from '../conta/cenario.js';
import {
  type PedidoNaConta,
  type PedidoNaEmpresa,
  testarIsolamento,
  testarIsolamentoDaConta,
} from './suite.js';

// Isolamento das rotas reais da F3 (plano docs/planos/f3-6-sequencias-isolamento.md, decisão 5).
// Contas X (empresas x1 e x2) e Y (empresa y1), criadas pelo cadastro. Quem age é o dono de X.
// Os ids só existem depois do beforeAll: as matrizes leem os campos destes objetos na hora do teste.

let c: CenarioConta;
const x = { token: '', donoId: '', x1: '', x2: '', papelDono: '' };
const y = { token: '', donoId: '', y1: '' };
const chaves = { a1: '', a2: '', b1: '' };
const empresas = { proprio: '', outro: '' };
const membros = { proprio: '', outro: '' };
const convites = { proprio: '', outro: '' };

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';

function pedir(token: string, metodo: Metodo, caminho: string, empresa?: string, corpo?: object) {
  const req = request(c.app.getHttpServer())
    [metodo](caminho)
    .set('Authorization', `Bearer ${token}`);
  if (empresa) req.set('X-Empresa-Id', empresa);
  if (metodo === 'post') req.set('Idempotency-Key', randomUUID());
  return corpo ? req.send(corpo) : req;
}

async function criado(r: request.Test): Promise<string> {
  const resposta = await r;
  expect(resposta.status).toBe(201);
  return (resposta.body as { id: string }).id;
}

async function conta(nome: string) {
  const { token } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse((await pedir(token, 'get', '/v1/eu')).body);
  const papeis = ListaPapeis.parse((await pedir(token, 'get', '/v1/papeis')).body).dados;
  return { token, donoId: eu.membro.id, empresaId: eu.empresas[0]!.id, papeis };
}

const chaveDeServidor = { tipo: 'SERVIDOR', nome: 'n8n', escopos: ['contato.read'] };

beforeAll(async () => {
  c = await criarCenarioConta();
  const dx = await conta('Conta X');
  const dy = await conta('Conta Y');
  const x2 = await criado(
    pedir(dx.token, 'post', '/v1/empresas', undefined, {
      razao_social: 'X Filial Ltda',
      nome_fantasia: 'X Filial',
    }),
  );
  Object.assign(x, {
    token: dx.token,
    donoId: dx.donoId,
    x1: dx.empresaId,
    x2,
    papelDono: dx.papeis.find((p) => p.chave === 'OWNER')!.id,
  });
  Object.assign(y, { token: dy.token, donoId: dy.donoId, y1: dy.empresaId });

  Object.assign(chaves, {
    a1: await criado(pedir(x.token, 'post', '/v1/api-keys', x.x1, chaveDeServidor)),
    a2: await criado(pedir(x.token, 'post', '/v1/api-keys', x.x2, chaveDeServidor)),
    b1: await criado(pedir(y.token, 'post', '/v1/api-keys', y.y1, chaveDeServidor)),
  });
  Object.assign(empresas, { proprio: x.x1, outro: y.y1 });
  Object.assign(membros, { proprio: x.donoId, outro: y.donoId });
  const convite = (token: string, papel: string, empresa: string) =>
    criado(
      pedir(token, 'post', '/v1/membros/convites', undefined, {
        email: `convidado.${randomUUID().slice(0, 8)}@isolamento.local`,
        atribuicoes: [{ papel_id: papel, empresa_id: empresa }],
      }),
    );
  const atendente = (d: typeof dx) => d.papeis.find((p) => p.chave === 'ATENDENTE')!.id;
  Object.assign(convites, {
    proprio: await convite(x.token, atendente(dx), x.x1),
    outro: await convite(y.token, atendente(dy), y.y1),
  });
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

const linha = async (sql: string, id: string) => (await c.sql(sql, [id])).rows[0];
const comoDonoDeX: PedidoNaConta = (metodo, caminho, corpo) =>
  pedir(x.token, metodo, caminho, undefined, corpo);
const naEmpresaComoDonoDeX: PedidoNaEmpresa = (metodo, caminho, empresa, corpo) =>
  pedir(x.token, metodo, caminho, empresa, corpo);

describe('API keys (por empresa)', () => {
  testarIsolamento(() => ({ http: naEmpresaComoDonoDeX, empresas: { a1: x.x1, a2: x.x2 } }), {
    rota: '/v1/api-keys',
    ids: chaves,
    edicao: { nome: 'invadida' },
    linha: (id) =>
      linha(`SELECT empresa_id, nome, escopos, revogada_em FROM api_key WHERE id = $1`, id),
  });
});

describe('empresas (conta)', () => {
  testarIsolamentoDaConta(() => comoDonoDeX, {
    rota: '/v1/empresas',
    ids: empresas,
    ler: true,
    escritas: [{ metodo: 'patch', corpo: { nome_fantasia: 'Invadida' } }, { metodo: 'delete' }],
    linha: (id) =>
      linha(`SELECT tenant_id, razao_social, nome_fantasia, ativo FROM empresa WHERE id = $1`, id),
  });
});

describe('membros (conta)', () => {
  testarIsolamentoDaConta(() => comoDonoDeX, {
    rota: '/v1/membros',
    ids: membros,
    ler: true,
    escritas: [
      { metodo: 'patch', corpo: { cargo: 'Invadido', status: 'SUSPENSO' } },
      // O papel é de X: mesmo válido para X, não alcança o membro de Y.
      {
        metodo: 'put',
        sufixo: '/atribuicoes',
        get corpo() {
          return { atribuicoes: [{ papel_id: x.papelDono, empresa_id: null }] };
        },
      },
    ],
    linha: (id) =>
      linha(
        `SELECT m.status, m.cargo,
                (SELECT json_agg(a.papel_id ORDER BY a.papel_id) FROM atribuicao_papel a
                  WHERE a.membro_id = m.id) AS papeis
           FROM membro m WHERE m.id = $1`,
        id,
      ),
  });
});

describe('convites (conta)', () => {
  testarIsolamentoDaConta(() => comoDonoDeX, {
    rota: '/v1/membros/convites',
    ids: convites,
    ler: false,
    escritas: [{ metodo: 'post', sufixo: '/reenviar' }, { metodo: 'delete' }],
    linha: (id) =>
      linha(
        `SELECT cv.revogado_em, cv.token_hash, cv.expira_em,
                (SELECT count(*)::int FROM email_saida e WHERE e.convite_id = cv.id) AS emails
           FROM convite cv WHERE cv.id = $1`,
        id,
      ),
  });
});
