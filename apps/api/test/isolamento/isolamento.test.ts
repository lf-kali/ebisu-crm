import { Controller, Get } from '@nestjs/common';
import type { PrismaClient } from '@ebisu/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PRISMA_APP } from '../../src/core/banco/banco.module.js';
import { Contrato } from '../../src/core/contrato/contrato.js';
import { Permissao, Publica, SoAutenticado } from '../../src/core/rbac/marcas.js';
import { gerarDocumento, listarRotas } from '../../src/core/openapi/gerar-documento.js';
import { criarAppDeTeste } from '../app-de-teste.js';
import { type CenarioIsolamento, criarCenarioIsolamento, IDS } from './cenario.js';
import { pedir, testarIsolamento } from './suite.js';

let cenario: CenarioIsolamento;
const http = pedir(() => cenario);
const ROTA = '/v1/teste/contatos';
const { a1, a2, a3, b1, c1 } = IDS.empresas;
const { contatos } = IDS;

beforeAll(async () => {
  cenario = await criarCenarioIsolamento();
}, 180_000);
afterAll(async () => {
  await cenario?.fechar();
});

const linhaDoContato = async (id: string) =>
  (
    await cenario.sql(
      'SELECT empresa_id, nome, responsavel_id, origem_id FROM contato WHERE id = $1',
      [id],
    )
  ).rows[0];

describe('isolamento entre empresas e contas (contatos de teste)', () => {
  testarIsolamento(() => cenario, {
    rota: ROTA,
    ids: { a1: contatos.a1DoM1, a2: contatos.a2, b1: contatos.b1 },
    edicao: { nome: 'invadido' },
    linha: linhaDoContato,
  });

  it('membro só de A1 não lista A2 nem a empresa de outra conta (403)', async () => {
    expect((await http('m1', 'get', ROTA, a1)).status).toBe(200);
    for (const empresa of [a2, b1]) {
      const r = await http('m1', 'get', ROTA, empresa);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('empresa_nao_autorizada');
    }
  });

  it('criar com referência a um registro de outra empresa falha como referência inexistente', async () => {
    const ok = await http('m1', 'post', ROTA, a1, { nome: 'novo', origem_id: IDS.origens.a1 });
    expect(ok.status).toBe(201);
    expect(ok.body.empresa_id).toBe(a1);

    const daOutra = await http('m1', 'post', ROTA, a1, { nome: 'x', origem_id: IDS.origens.a2 });
    const inexistente = await http('m1', 'post', ROTA, a1, {
      nome: 'x',
      origem_id: '0190d7c0-0000-7000-8000-00000000dead',
    });
    const membroDeB = await http('m1', 'post', ROTA, a1, {
      nome: 'x',
      responsavel_id: IDS.membros.mB,
    });
    for (const r of [daOutra, inexistente, membroDeB]) {
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('validacao');
    }
    // A resposta não diferencia "existe em outra empresa" de "não existe".
    expect(daOutra.body.detail).toBe(inexistente.body.detail);
    expect(
      (await cenario.sql("SELECT count(*)::int AS n FROM contato WHERE nome = 'x'")).rows[0],
    ).toEqual({ n: 0 });
  });

  it('sem contexto de tenant, o cliente ebisu_app da API não vê nenhuma linha', async () => {
    const app = cenario.app.get<PrismaClient>(PRISMA_APP);
    expect(await app.contato.count()).toBe(0);
    expect(await app.empresa.count()).toBe(0);
  });
});

describe('escopo PROPRIO (SEG-4)', () => {
  it('só lista, lê e edita os contatos em que é o responsável', async () => {
    const lista = await http('mP', 'get', ROTA, a1);
    expect(lista.status).toBe(200);
    expect(lista.body.dados.map((d: { id: string }) => d.id)).toEqual([contatos.a1DoP]);

    expect((await http('mP', 'get', `${ROTA}/${contatos.a1DoP}`, a1)).status).toBe(200);
    expect((await http('mP', 'get', `${ROTA}/${contatos.a1DoM1}`, a1)).status).toBe(404);

    const antes = await linhaDoContato(contatos.a1DoM1);
    expect(
      (await http('mP', 'patch', `${ROTA}/${contatos.a1DoM1}`, a1, { nome: 'meu' })).status,
    ).toBe(404);
    expect(await linhaDoContato(contatos.a1DoM1)).toEqual(antes);
    const meu = await http('mP', 'patch', `${ROTA}/${contatos.a1DoP}`, a1, { nome: 'A1 do P' });
    expect(meu.status).toBe(200);
  });

  it('EMPRESA vê todos os contatos da empresa, de qualquer responsável', async () => {
    const r = await http('m1', 'get', ROTA, a1);
    const ids = r.body.dados.map((d: { id: string }) => d.id);
    expect(ids).toEqual(expect.arrayContaining([contatos.a1DoP, contatos.a1DoM1]));
  });
});

describe('X-Empresa-Id e permissão (SEG-3)', () => {
  it('sem o cabeçalho ou com valor que não é UUID: 422 no campo X-Empresa-Id', async () => {
    for (const valor of [null, 'nao-e-uuid']) {
      const r = await http('m1', 'get', ROTA, valor);
      expect(r.status).toBe(422);
      expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'X-Empresa-Id' })]);
    }
  });

  it('empresa inativa, mesmo atribuída: 403', async () => {
    const r = await http('m1', 'get', ROTA, a3);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('empresa_nao_autorizada');
  });

  it('atribuição em todas as empresas (empresa_id nulo) vale para cada uma', async () => {
    for (const empresa of [a1, a2])
      expect((await http('admin', 'get', ROTA, empresa)).status).toBe(200);
  });

  it('empresa atribuída mas sem a permissão da rota: 403 sem_permissao', async () => {
    const r = await http('m1', 'delete', `${ROTA}/${contatos.a1DoM1}`, a1);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('sem_permissao');
    expect(await linhaDoContato(contatos.a1DoM1)).toBeDefined();
  });

  it('rota que não passa pelo filtro de escopo também exige a permissão (guard)', async () => {
    // mP tem contato.read e contato.update em A1, mas não contato.create.
    const r = await http('mP', 'post', ROTA, a1, { nome: 'sem permissão' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('sem_permissao');
    const { rows } = await cenario.sql("SELECT 1 FROM contato WHERE nome = 'sem permissão'");
    expect(rows).toEqual([]);
  });

  it('sem token ou com token inválido: 401 antes de olhar a empresa', async () => {
    const semToken = await request(cenario.app.getHttpServer()).get(ROTA).set('X-Empresa-Id', a1);
    expect(semToken.status).toBe(401);
    const lixo = await request(cenario.app.getHttpServer())
      .get(ROTA)
      .set('Authorization', 'Bearer lixo');
    expect(lixo.status).toBe(401);
  });
});

describe('revalidação da sessão em toda requisição (token ainda válido)', () => {
  const restaurar: Array<() => Promise<unknown>> = [];
  afterAll(async () => {
    for (const fn of restaurar) await fn();
  });

  const tentar = async (quem: 'vol' | 'mC', empresa: string) => {
    const dominio = await http(quem, 'get', ROTA, empresa);
    const eu = await http(quem, 'get', '/v1/eu', null);
    return [dominio.status, eu.status];
  };

  it('usuário desativado: 401 no domínio e no /v1/eu', async () => {
    expect(await tentar('vol', a1)).toEqual([200, 200]);
    await cenario.sql('UPDATE usuario SET ativo = false WHERE id = $1', [IDS.usuarios.vol]);
    restaurar.push(() =>
      cenario.sql('UPDATE usuario SET ativo = true WHERE id = $1', [IDS.usuarios.vol]),
    );
    expect(await tentar('vol', a1)).toEqual([401, 401]);
    await restaurar.pop()!();
    expect(await tentar('vol', a1)).toEqual([200, 200]);
  });

  it('membro suspenso ou removido: 401', async () => {
    await cenario.sql("UPDATE membro SET status = 'SUSPENSO' WHERE id = $1", [IDS.membros.vol]);
    restaurar.push(() =>
      cenario.sql("UPDATE membro SET status = 'ATIVO' WHERE id = $1", [IDS.membros.vol]),
    );
    expect(await tentar('vol', a1)).toEqual([401, 401]);
    await restaurar.pop()!();
    expect(await tentar('vol', a1)).toEqual([200, 200]);
  });

  it('conta suspensa ou cancelada: 401 (também no /v1/eu)', async () => {
    expect(await tentar('mC', c1)).toEqual([200, 200]);
    restaurar.push(() =>
      cenario.sql("UPDATE tenant SET status = 'ATIVO' WHERE id = $1", [IDS.contas.c]),
    );
    for (const status of ['SUSPENSO', 'CANCELADO']) {
      await cenario.sql('UPDATE tenant SET status = $2 WHERE id = $1', [IDS.contas.c, status]);
      expect(await tentar('mC', c1), status).toEqual([401, 401]);
    }
    await restaurar.pop()!();
    expect(await tentar('mC', c1)).toEqual([200, 200]);
  });

  it('atribuição removida: a empresa deixa de ser aceita na hora', async () => {
    const { rows } = await cenario.sql(
      'DELETE FROM atribuicao_papel WHERE membro_id = $1 RETURNING *',
      [IDS.membros.vol],
    );
    restaurar.push(async () => {
      for (const a of rows)
        await cenario.sql(
          'INSERT INTO atribuicao_papel (id, tenant_id, membro_id, papel_id, empresa_id) VALUES ($1, $2, $3, $4, $5)',
          [a.id, a.tenant_id, a.membro_id, a.papel_id, a.empresa_id],
        );
    });
    expect((await http('vol', 'get', ROTA, a1)).status).toBe(403);
    await restaurar.pop()!();
    expect((await http('vol', 'get', ROTA, a1)).status).toBe(200);
  });
});

describe('marcas de acesso (fechado por padrão)', () => {
  it('toda rota do app tem exatamente uma marca', () => {
    const semMarcaUnica = listarRotas(cenario.app)
      .filter((r) => r.marcas.length !== 1)
      .map((r) => `${r.metodo} ${r.caminho}`);
    expect(semMarcaUnica).toEqual([]);
  });

  it('@Permissao com chave fora do catálogo derruba a subida', () => {
    expect(() => Permissao('nao.existe')).toThrow(/fora do catálogo: nao\.existe/);
  });

  it('rota sem marca, ou com duas, recusa a chamada (500) e não gera o OpenAPI', async () => {
    const Resposta = z.object({ ok: z.boolean() });
    @Controller('marcas')
    class MarcasController {
      @Get('sem')
      @Contrato({ resumo: 'Sem marca', resposta: Resposta })
      sem() {
        return { ok: true };
      }

      @Get('duas')
      @Publica()
      @SoAutenticado()
      @Contrato({ resumo: 'Duas marcas', resposta: Resposta })
      duas() {
        return { ok: true };
      }
    }
    const app = await criarAppDeTeste({ controllers: [MarcasController] });
    try {
      for (const caminho of ['/v1/marcas/sem', '/v1/marcas/duas']) {
        const r = await request(app.getHttpServer()).get(caminho);
        expect(r.status, caminho).toBe(500);
        // A mensagem interna (erro de programação) não vai para o cliente.
        expect(r.body.code).toBe('erro_interno');
        expect(JSON.stringify(r.body)).not.toContain('exatamente uma marca');
      }
      expect(() => gerarDocumento(app)).toThrow(/Rota sem marca de acesso única/);
    } finally {
      await app.close();
    }
  });

  it('o OpenAPI da rota de domínio mostra X-Empresa-Id, a permissão e 401/403/422', () => {
    const doc = gerarDocumento(cenario.app) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const get = doc.paths['/v1/teste/contatos']!.get!;
    expect(get.parameters).toEqual([
      expect.objectContaining({ in: 'header', name: 'X-Empresa-Id', required: true }),
    ]);
    expect(get.description).toContain('`contato.read`');
    expect(Object.keys(get.responses as object)).toEqual(['200', '401', '403', '422', 'default']);
    expect(get.security).toEqual([{ bearer: [] }]);
  });
});
