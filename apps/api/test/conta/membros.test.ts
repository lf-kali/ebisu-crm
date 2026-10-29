import { ListaMembros, ListaPapeis, Membro, RespostaEu } from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGEM_WEB } from '../app-de-teste.js';
import {
  type CenarioConta,
  contaNova,
  criarCenarioConta,
  membroCom,
  novoMembro,
  SENHA,
} from './cenario.js';

// Membros e papéis (plano docs/planos/f3-4b1-membros-papeis.md): rotas da conta com
// `config.membros` e `config.rbac`; só um dono mexe no dono; a conta nunca fica sem dono ativo.

let c: CenarioConta;

beforeAll(async () => {
  c = await criarCenarioConta();
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

type Metodo = 'get' | 'patch' | 'put';
const pedir = (token: string, metodo: Metodo, rota: string, corpo?: object) => {
  const req = request(c.app.getHttpServer())[metodo](rota).set('Authorization', `Bearer ${token}`);
  return corpo ? req.send(corpo) : req;
};

interface Conta {
  token: string;
  tenantId: string;
  donoId: string;
  empresaId: string;
  papeis: Record<string, string>;
}

/** Conta nova pelo cadastro, com o id do dono, da empresa e dos papéis padrão. */
async function conta(nome: string): Promise<Conta> {
  const { token, tenantId } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse((await pedir(token, 'get', '/v1/eu')).body);
  const papeis = ListaPapeis.parse((await pedir(token, 'get', '/v1/papeis')).body).dados;
  return {
    token,
    tenantId,
    donoId: eu.membro.id,
    empresaId: eu.empresas[0]!.id,
    papeis: Object.fromEntries(papeis.map((p) => [p.chave, p.id])),
  };
}

const atribuir = (token: string, membroId: string, atribuicoes: object[]) =>
  pedir(token, 'put', `/v1/membros/${membroId}/atribuicoes`, { atribuicoes });
const dono = (x: Conta) => ({ papel_id: x.papeis.OWNER, empresa_id: null });
const papeisDe = (membro: Membro) =>
  membro.atribuicoes.map((a) => `${a.papel.chave}:${a.empresa_id ?? '*'}`).sort();

describe('membros', () => {
  it('lista (paginada) e lê, com nome, e-mail e atribuições', async () => {
    const x = await conta('Conta Lista');
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    const lista = ListaMembros.parse((await pedir(x.token, 'get', '/v1/membros')).body);
    expect(lista.dados.map((m) => m.id).sort()).toEqual([x.donoId, outro.membroId].sort());
    const donoNaLista = lista.dados.find((m) => m.id === x.donoId)!;
    expect(donoNaLista).toMatchObject({ status: 'ATIVO', usuario: { nome: 'Marina Duarte' } });
    expect(papeisDe(donoNaLista)).toEqual(['OWNER:*']);

    const pagina = ListaMembros.parse((await pedir(x.token, 'get', '/v1/membros?limit=1')).body);
    expect(pagina.dados).toHaveLength(1);
    const resto = ListaMembros.parse(
      (await pedir(x.token, 'get', `/v1/membros?limit=1&cursor=${pagina.proximo_cursor}`)).body,
    );
    expect(resto.proximo_cursor).toBeNull();
    expect([...pagina.dados, ...resto.dados].map((m) => m.id)).toEqual(
      lista.dados.map((m) => m.id),
    );

    const lido = await pedir(x.token, 'get', `/v1/membros/${outro.membroId}`);
    expect(lido.status).toBe(200);
    expect(papeisDe(Membro.parse(lido.body))).toEqual([`ATENDENTE:${x.empresaId}`]);
    expect(lido.body.usuario.email).toBe(outro.email);
  });

  it('edita o cargo e o remove com null', async () => {
    const x = await conta('Conta Cargo');
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    const r = await pedir(x.token, 'patch', `/v1/membros/${outro.membroId}`, { cargo: 'Balcão' });
    expect(r.body.cargo).toBe('Balcão');
    const sem = await pedir(x.token, 'patch', `/v1/membros/${outro.membroId}`, { cargo: null });
    expect(sem.body.cargo).toBeNull();
    expect((await pedir(x.token, 'patch', `/v1/membros/${outro.membroId}`, {})).status).toBe(422);
  });

  it('suspender corta a sessão na hora (requisição e refresh); reativar devolve o acesso', async () => {
    const x = await conta('Conta Suspensão');
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    const login = await request(c.app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: outro.email, senha: SENHA });
    const cookie = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .find((l) => l.startsWith('__Host-ebisu_refresh='))!
      .split(';')[0]!;

    const suspenso = await pedir(x.token, 'patch', `/v1/membros/${outro.membroId}`, {
      status: 'SUSPENSO',
    });
    expect(suspenso.body.status).toBe('SUSPENSO');
    expect((await pedir(outro.token, 'get', '/v1/eu')).status).toBe(401);
    const refresh = await request(c.app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', ORIGEM_WEB)
      .set('Cookie', cookie);
    expect(refresh.status).toBe(401);

    await pedir(x.token, 'patch', `/v1/membros/${outro.membroId}`, { status: 'ATIVO' });
    expect((await pedir(outro.token, 'get', '/v1/eu')).status).toBe(200);
  });

  it('ninguém muda o próprio status (409)', async () => {
    const x = await conta('Conta Autossuspensão');
    const admin = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const r = await pedir(admin.token, 'patch', `/v1/membros/${admin.membroId}`, {
      status: 'SUSPENSO',
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('transicao_invalida');
  });
});

describe('atribuições', () => {
  it('troca o conjunto e a próxima requisição do membro já usa os papéis novos', async () => {
    const x = await conta('Conta Atribuições');
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    const antes = RespostaEu.parse((await pedir(outro.token, 'get', '/v1/eu')).body);
    expect(antes.empresas[0]!.permissoes['config.crm']).toBeUndefined();

    const r = await atribuir(x.token, outro.membroId, [
      { papel_id: x.papeis.GERENTE, empresa_id: x.empresaId },
      { papel_id: x.papeis.TECNICO, empresa_id: null },
    ]);
    expect(r.status).toBe(200);
    expect(papeisDe(Membro.parse(r.body))).toEqual([`GERENTE:${x.empresaId}`, 'TECNICO:*']);
    const depois = RespostaEu.parse((await pedir(outro.token, 'get', '/v1/eu')).body);
    expect(depois.empresas[0]!.permissoes['config.crm']).toBe('EMPRESA');

    // A atribuição que fica não é recriada (mesmo id).
    const idTecnico = r.body.atribuicoes.find(
      (a: { papel: { chave: string } }) => a.papel.chave === 'TECNICO',
    ).id;
    const deNovo = await atribuir(x.token, outro.membroId, [
      { papel_id: x.papeis.TECNICO, empresa_id: null },
    ]);
    expect(deNovo.body.atribuicoes.map((a: { id: string }) => a.id)).toEqual([idTecnico]);
  });

  it('papel ou empresa de outra conta, empresa inativa, lista vazia ou repetida dão 422', async () => {
    const x = await conta('Conta Referências');
    const y = await conta('Conta Alheia');
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    const inativa = (
      await c.sql(
        `INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, ativo, updated_at)
         VALUES (gen_random_uuid(), $1, 'Fechada', 'Fechada', false, now()) RETURNING id`,
        [x.tenantId],
      )
    ).rows[0]!.id as string;
    const casos = [
      [{ papel_id: y.papeis.ATENDENTE, empresa_id: x.empresaId }],
      [{ papel_id: x.papeis.ATENDENTE, empresa_id: y.empresaId }],
      [{ papel_id: x.papeis.ATENDENTE, empresa_id: inativa }],
      [],
      [
        { papel_id: x.papeis.ATENDENTE, empresa_id: x.empresaId },
        { papel_id: x.papeis.ATENDENTE, empresa_id: x.empresaId },
      ],
    ];
    for (const atribuicoes of casos) {
      const r = await atribuir(x.token, outro.membroId, atribuicoes);
      expect([JSON.stringify(atribuicoes), r.status]).toEqual([JSON.stringify(atribuicoes), 422]);
    }
    const lido = Membro.parse((await pedir(x.token, 'get', `/v1/membros/${outro.membroId}`)).body);
    expect(papeisDe(lido)).toEqual([`ATENDENTE:${x.empresaId}`]);
  });

  it('OWNER numa empresa só dá 422', async () => {
    const x = await conta('Conta Dono Parcial');
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    const r = await atribuir(x.token, outro.membroId, [
      { papel_id: x.papeis.OWNER, empresa_id: x.empresaId },
    ]);
    expect(r.status).toBe(422);
  });
});

describe('regra do dono', () => {
  it('ADMIN não se promove, não tira o dono nem suspende o dono (403); mexe nos outros papéis', async () => {
    const x = await conta('Conta Admin');
    const admin = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const outro = await novoMembro(c, x.tenantId, 'ATENDENTE', x.empresaId);
    expect((await atribuir(admin.token, admin.membroId, [dono(x)])).status).toBe(403);
    expect((await atribuir(admin.token, outro.membroId, [dono(x)])).status).toBe(403);
    expect(
      (await atribuir(admin.token, x.donoId, [{ papel_id: x.papeis.ADMIN, empresa_id: null }]))
        .status,
    ).toBe(403);
    expect(
      (await pedir(admin.token, 'patch', `/v1/membros/${x.donoId}`, { status: 'SUSPENSO' })).status,
    ).toBe(403);
    // O cargo do dono, sim (não é a regra do dono).
    expect(
      (await pedir(admin.token, 'patch', `/v1/membros/${x.donoId}`, { cargo: 'Sócio' })).status,
    ).toBe(200);
    const r = await atribuir(admin.token, outro.membroId, [
      { papel_id: x.papeis.GERENTE, empresa_id: x.empresaId },
    ]);
    expect(r.status).toBe(200);
    const lido = Membro.parse((await pedir(x.token, 'get', `/v1/membros/${x.donoId}`)).body);
    expect(papeisDe(lido)).toEqual(['OWNER:*']);
  });

  it('dono dá o dono a outro; o novo dono tira o do antigo; o último dono não sai (409)', async () => {
    const x = await conta('Conta Sucessão');
    const herdeiro = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const dado = await atribuir(x.token, herdeiro.membroId, [dono(x)]);
    expect(dado.status).toBe(200);
    expect(papeisDe(Membro.parse(dado.body))).toEqual(['OWNER:*']);

    const tirado = await atribuir(herdeiro.token, x.donoId, [
      { papel_id: x.papeis.ADMIN, empresa_id: null },
    ]);
    expect(tirado.status).toBe(200);
    // O antigo dono, agora ADMIN, não mexe mais no dono.
    expect(
      (await pedir(x.token, 'patch', `/v1/membros/${herdeiro.membroId}`, { status: 'SUSPENSO' }))
        .status,
    ).toBe(403);

    const ultimo = await atribuir(herdeiro.token, herdeiro.membroId, [
      { papel_id: x.papeis.ADMIN, empresa_id: null },
    ]);
    expect(ultimo.status).toBe(409);
    expect(ultimo.body.code).toBe('transicao_invalida');
    const lido = Membro.parse(
      (await pedir(herdeiro.token, 'get', `/v1/membros/${herdeiro.membroId}`)).body,
    );
    expect(papeisDe(lido)).toEqual(['OWNER:*']);
  });

  it('com dois donos, um suspende o outro; reativar também exige ser dono', async () => {
    const x = await conta('Conta Dois Donos');
    const socio = await novoMembro(c, x.tenantId, 'OWNER', null);
    const admin = await novoMembro(c, x.tenantId, 'ADMIN', null);
    const r = await pedir(socio.token, 'patch', `/v1/membros/${x.donoId}`, { status: 'SUSPENSO' });
    expect(r.status).toBe(200);
    expect(
      (await pedir(admin.token, 'patch', `/v1/membros/${x.donoId}`, { status: 'ATIVO' })).status,
    ).toBe(403);
    expect(
      (await pedir(socio.token, 'patch', `/v1/membros/${x.donoId}`, { status: 'ATIVO' })).status,
    ).toBe(200);
  });

  it('mudança concorrente: espera a outra transação dos donos e não deixa a conta sem dono', async () => {
    const x = await conta('Conta Corrida de Donos');
    const socio = await novoMembro(c, x.tenantId, 'OWNER', null);
    // Outra transação (o sócio tirando o dono do fundador) segura a trava dos donos; o fundador,
    // ao mesmo tempo, tenta tirar o dono do sócio.
    const outra = await c.banco.conectar(c.banco.urlAdmin);
    try {
      await outra.query('BEGIN');
      await outra.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `donos:${x.tenantId}`,
      ]);
      await outra.query(`DELETE FROM atribuicao_papel WHERE membro_id = $1 AND papel_id = $2`, [
        x.donoId,
        x.papeis.OWNER,
      ]);
      let respondeu = false;
      const pedido = atribuir(x.token, socio.membroId, [
        { papel_id: x.papeis.ADMIN, empresa_id: null },
      ]).then((r) => {
        respondeu = true;
        return r;
      });
      await new Promise((fim) => setTimeout(fim, 500));
      expect(respondeu).toBe(false);
      await outra.query('COMMIT');
      // Depois da outra, o fundador já não é dono.
      expect((await pedido).status).toBe(403);
    } finally {
      await outra.end();
    }
    const donos = (
      await c.sql(
        `SELECT count(*) AS n FROM atribuicao_papel a JOIN papel p ON p.id = a.papel_id
          WHERE a.tenant_id = $1 AND p.chave = 'OWNER' AND a.empresa_id IS NULL`,
        [x.tenantId],
      )
    ).rows[0]!;
    expect(Number(donos.n)).toBe(1);
  });
});

describe('suspensão concorrente de donos', () => {
  it('dois donos se suspendendo ao mesmo tempo: o segundo espera e perde (403)', async () => {
    const x = await conta('Conta Suspensão Cruzada');
    const socio = await novoMembro(c, x.tenantId, 'OWNER', null);
    // Outra transação (o sócio suspendendo o fundador) segura a trava dos donos; o fundador, ao
    // mesmo tempo, tenta suspender o sócio.
    const outra = await c.banco.conectar(c.banco.urlAdmin);
    try {
      await outra.query('BEGIN');
      await outra.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `donos:${x.tenantId}`,
      ]);
      await outra.query(`UPDATE membro SET status = 'SUSPENSO' WHERE id = $1`, [x.donoId]);
      let respondeu = false;
      const pedido = pedir(x.token, 'patch', `/v1/membros/${socio.membroId}`, {
        status: 'SUSPENSO',
      }).then((r) => {
        respondeu = true;
        return r;
      });
      await new Promise((fim) => setTimeout(fim, 500));
      expect(respondeu).toBe(false);
      await outra.query('COMMIT');
      expect((await pedido).status).toBe(403);
    } finally {
      await outra.end();
    }
    const [{ status }] = (await c.sql(`SELECT status FROM membro WHERE id = $1`, [socio.membroId]))
      .rows as [{ status: string }];
    expect(status).toBe('ATIVO');
  });
});

describe('acesso', () => {
  it('sem config.membros ou sem config.rbac dá 403; escopo EMPRESA ou papel de uma empresa só também', async () => {
    const x = await conta('Conta Acesso');
    const alvo = `/v1/membros/${x.donoId}`;
    const soMembros = await membroCom(c, x.tenantId, { 'config.membros': 'TENANT' }, null);
    expect((await pedir(soMembros, 'get', '/v1/membros')).status).toBe(200);
    expect((await pedir(soMembros, 'get', '/v1/papeis')).status).toBe(403);
    expect((await atribuir(soMembros, x.donoId, [dono(x)])).status).toBe(403);

    const soRbac = await membroCom(c, x.tenantId, { 'config.rbac': 'TENANT' }, null);
    expect((await pedir(soRbac, 'get', '/v1/papeis')).status).toBe(200);
    expect((await pedir(soRbac, 'get', '/v1/membros')).status).toBe(403);
    expect((await pedir(soRbac, 'patch', alvo, { cargo: 'x' })).status).toBe(403);

    const empresa = await membroCom(
      c,
      x.tenantId,
      { 'config.membros': 'EMPRESA', 'config.rbac': 'EMPRESA' },
      null,
    );
    const umaSo = await membroCom(
      c,
      x.tenantId,
      { 'config.membros': 'TENANT', 'config.rbac': 'TENANT' },
      x.empresaId,
    );
    for (const token of [empresa, umaSo]) {
      expect((await pedir(token, 'get', '/v1/membros')).status).toBe(403);
      expect((await pedir(token, 'get', '/v1/papeis')).status).toBe(403);
    }
  });

  it('membro de outra conta dá 404 e não muda', async () => {
    const x = await conta('Conta Daqui');
    const y = await conta('Conta de Lá');
    const rota = `/v1/membros/${y.donoId}`;
    expect((await pedir(x.token, 'get', rota)).status).toBe(404);
    expect((await pedir(x.token, 'patch', rota, { status: 'SUSPENSO' })).status).toBe(404);
    expect(
      (await atribuir(x.token, y.donoId, [{ papel_id: x.papeis.ADMIN, empresa_id: null }])).status,
    ).toBe(404);
    expect((await pedir(y.token, 'get', '/v1/eu')).status).toBe(200);
  });
});

describe('papéis', () => {
  it('lista os papéis padrão com permissões e escopos', async () => {
    const x = await conta('Conta Papéis');
    const { dados } = ListaPapeis.parse((await pedir(x.token, 'get', '/v1/papeis')).body);
    expect(dados.map((p) => p.chave)).toEqual(
      expect.arrayContaining(['OWNER', 'ADMIN', 'GERENTE', 'ATENDENTE', 'TECNICO']),
    );
    const owner = dados.find((p) => p.chave === 'OWNER')!;
    expect(owner.sistema).toBe(true);
    expect(new Set(Object.values(owner.permissoes))).toEqual(new Set(['TENANT']));
    expect(dados.find((p) => p.chave === 'GERENTE')!.permissoes['config.crm']).toBe('EMPRESA');
  });
});
