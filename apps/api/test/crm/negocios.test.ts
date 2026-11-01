import { randomUUID } from 'node:crypto';
import {
  Contato,
  type EdicaoEtapa,
  Funil,
  ListaMotivosPerda,
  ListaOrigens,
  ListaTarefas,
  NegocioDetalhado,
  RespostaEu,
  Tarefa,
} from '@ebisu/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CenarioConta, contaNova, criarCenarioConta, novoMembro } from '../conta/cenario.js';

// Funil, negócios, tarefas e completude (plano docs/planos/f4-2a-funil-negocios-tarefas.md). O
// funil padrão (seed): Novo contato → Qualificação → Diagnóstico/Orçamento → Orçamento enviado →
// Negociação → Ganho | Perdido | Nutrição.

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

async function conta(nome: string): Promise<Conta> {
  const { token, tenantId } = await contaNova(c.app, { conta: { nome } });
  const eu = RespostaEu.parse(
    (await request(c.app.getHttpServer()).get('/v1/eu').set('Authorization', `Bearer ${token}`))
      .body,
  );
  return { token, tenantId, empresaId: eu.empresas[0]!.id, donoId: eu.membro.id };
}

type Metodo = 'get' | 'post' | 'patch' | 'delete';

function pedir(
  x: { token: string; empresaId: string },
  metodo: Metodo,
  rota: string,
  corpo?: object,
) {
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

const funil = (x: Conta) => ok(pedir(x, 'get', '/v1/funil'), Funil);

/** O corpo do PATCH com o funil como está. */
const paraEdicao = (f: Funil): EdicaoEtapa[] =>
  f.etapas.map(({ id, nome, ordem, probabilidade, sla_horas, cor, requisitos }) => ({
    id,
    nome,
    ordem,
    probabilidade,
    sla_horas,
    cor,
    requisitos: requisitos.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      chave: r.chave,
      descricao: r.descricao,
      obrigatorio: r.obrigatorio,
      ...(r.titulo_tarefa ? { titulo_tarefa: r.titulo_tarefa } : {}),
    })),
  }));

const criarContato = (x: Conta, corpo: object = {}) =>
  ok(
    pedir(x, 'post', '/v1/contatos', {
      nome: 'Lia Prado',
      email: `${randomUUID()}@n.test`,
      ...corpo,
    }),
    Contato,
    201,
  );

const criarNegocio = (x: Conta, contatoId: string, corpo: object = {}) =>
  ok(
    pedir(x, 'post', '/v1/negocios', { contato_id: contatoId, titulo: 'Tela quebrada', ...corpo }),
    NegocioDetalhado,
    201,
  );

const mover = (
  x: { token: string; empresaId: string },
  n: { id: string; versao_registro: number },
  etapaId: string,
) =>
  pedir(x, 'post', `/v1/negocios/${n.id}/mover`, {
    etapa_id: etapaId,
    versao_registro: n.versao_registro,
  });

const tarefasDo = async (x: Conta, negocioId: string) =>
  ListaTarefas.parse((await pedir(x, 'get', `/v1/tarefas?filtro[negocio_id]=${negocioId}`)).body)
    .dados;

/** Atende os requisitos de Novo contato e Qualificação (contato e negócio). */
async function qualificar(x: Conta, contatoId: string, negocio: NegocioDetalhado) {
  const origem = ListaOrigens.parse((await pedir(x, 'get', '/v1/origens')).body).dados[0]!;
  await ok(
    pedir(x, 'patch', `/v1/contatos/${contatoId}`, {
      origem_id: origem.id,
      canal_preferido: 'WHATSAPP',
    }),
    Contato,
  );
  await pedir(x, 'post', `/v1/contatos/${contatoId}/consentimentos`, {
    canal: 'WHATSAPP',
    finalidade: 'TRANSACIONAL',
    concedido: true,
    base_legal: 'consentimento',
  });
  return ok(
    pedir(x, 'patch', `/v1/negocios/${negocio.id}`, {
      versao_registro: negocio.versao_registro,
      tipo_dispositivo: 'CELULAR',
      descricao_problema: 'Tela trincada',
    }),
    NegocioDetalhado,
  );
}

describe('funil', () => {
  it('lê o funil padrão com as etapas em ordem e os requisitos', async () => {
    const f = await funil(await conta('Conta Funil'));
    expect(f.etapas.map((e) => [e.nome, e.tipo])).toEqual([
      ['Novo contato', 'ABERTA'],
      ['Qualificação', 'ABERTA'],
      ['Diagnóstico / Orçamento', 'ABERTA'],
      ['Orçamento enviado', 'ABERTA'],
      ['Negociação', 'ABERTA'],
      ['Ganho', 'GANHO'],
      ['Perdido', 'PERDIDO'],
      ['Nutrição', 'NUTRICAO'],
    ]);
    expect(f.etapas[0]!.requisitos.map((r) => r.chave)).toEqual([
      'contato.nome',
      'contato_tem_meio_contato',
      'contato_tem_origem',
    ]);
  });

  it('edita nomes, ordem e requisitos; recusa chave desconhecida, etapa faltando e fechada antes da aberta', async () => {
    const x = await conta('Conta Editar Funil');
    const etapas = paraEdicao(await funil(x));
    const [novo, , , enviado, negociacao] = etapas;
    novo!.nome = 'Entrada';
    novo!.requisitos = [
      novo!.requisitos[0]!,
      {
        tipo: 'TAREFA',
        chave: 'ligar_cliente',
        descricao: 'Primeira ligação',
        obrigatorio: true,
        titulo_tarefa: 'Ligar para o cliente',
      },
    ];
    [enviado!.ordem, negociacao!.ordem] = [negociacao!.ordem, enviado!.ordem];
    const editado = await ok(pedir(x, 'patch', '/v1/funil', { etapas }), Funil);
    expect(editado.etapas.map((e) => e.nome).slice(0, 5)).toEqual([
      'Entrada',
      'Qualificação',
      'Diagnóstico / Orçamento',
      'Negociação',
      'Orçamento enviado',
    ]);
    expect(editado.etapas[0]!.requisitos.map((r) => [r.chave, r.titulo_tarefa])).toEqual([
      ['contato.nome', null],
      ['ligar_cliente', 'Ligar para o cliente'],
    ]);

    const base = paraEdicao(editado);
    const desconhecida = structuredClone(base);
    desconhecida[0]!.requisitos.push({
      tipo: 'CAMPO',
      chave: 'contato.senha',
      descricao: 'X',
      obrigatorio: true,
    });
    const r1 = await pedir(x, 'patch', '/v1/funil', { etapas: desconhecida });
    expect(r1.status).toBe(422);
    expect(r1.body.campos[0].campo).toBe('etapas.0.requisitos.2.chave');
    expect((await pedir(x, 'patch', '/v1/funil', { etapas: base.slice(1) })).status).toBe(422);
    const ganhoPrimeiro = structuredClone(base);
    [ganhoPrimeiro[0]!.ordem, ganhoPrimeiro[5]!.ordem] = [
      ganhoPrimeiro[5]!.ordem,
      ganhoPrimeiro[0]!.ordem,
    ];
    expect((await pedir(x, 'patch', '/v1/funil', { etapas: ganhoPrimeiro })).status).toBe(422);
  });

  it('ler pede negocio.read; editar pede config.crm', async () => {
    const x = await conta('Conta Permissão Funil');
    const leitor = await novoMembro(c, x.tenantId, { 'negocio.read': 'EMPRESA' }, x.empresaId);
    const l = { token: leitor.token, empresaId: x.empresaId };
    const f = await ok(pedir(l, 'get', '/v1/funil'), Funil);
    expect((await pedir(l, 'patch', '/v1/funil', { etapas: paraEdicao(f) })).status).toBe(403);
  });

  it('editar recalcula a completude do perfil dos contatos', async () => {
    const x = await conta('Conta Recalcular');
    const k = await criarContato(x);
    // nome e meio de contato de 5 requisitos de contato (sem origem, canal e consentimento).
    expect(k.completude_perfil).toBe(40);
    const etapas = paraEdicao(await funil(x));
    etapas[0]!.requisitos = etapas[0]!.requisitos.filter((r) => r.chave !== 'contato_tem_origem');
    await ok(pedir(x, 'patch', '/v1/funil', { etapas }), Funil);
    const depois = await ok(pedir(x, 'get', `/v1/contatos/${k.id}`), Contato);
    expect(depois.completude_perfil).toBe(50);
    expect(depois.campos_faltantes).toEqual([
      'contato.canal_preferido',
      'consentimento_transacional',
    ]);
  });
});

describe('negócios', () => {
  it('cria na primeira etapa com o "o que falta"; edita com a versão; exclui', async () => {
    const x = await conta('Conta Negócios');
    const f = await funil(x);
    const k = await criarContato(x);
    const n = await criarNegocio(x, k.id, {
      valor_estimado: '350.00',
      previsao_fechamento: '2026-12-01',
    });
    expect(n).toMatchObject({
      etapa_id: f.etapas[0]!.id,
      status: 'ABERTO',
      versao_registro: 0,
      valor_estimado: '350.00',
      previsao_fechamento: '2026-12-01',
      completude: 67,
    });
    expect(n.requisitos.map((r) => [r.chave, r.atendido])).toEqual([
      ['contato.nome', true],
      ['contato_tem_meio_contato', true],
      ['contato_tem_origem', false],
    ]);
    const { rows } = await c.sql(
      `SELECT de_etapa_id, para_etapa_id FROM historico_etapa_negocio WHERE negocio_id = $1`,
      [n.id],
    );
    expect(rows).toEqual([{ de_etapa_id: null, para_etapa_id: f.etapas[0]!.id }]);

    const editado = await ok(
      pedir(x, 'patch', `/v1/negocios/${n.id}`, { versao_registro: 0, titulo: 'Troca de tela' }),
      NegocioDetalhado,
    );
    expect(editado).toMatchObject({ titulo: 'Troca de tela', versao_registro: 1 });
    const velho = await pedir(x, 'patch', `/v1/negocios/${n.id}`, {
      versao_registro: 0,
      titulo: 'X',
    });
    expect(velho.status).toBe(409);
    expect(velho.body.code).toBe('conflito_versao');
    // Etapa e completude não entram pelo PATCH.
    expect(
      (await pedir(x, 'patch', `/v1/negocios/${n.id}`, { versao_registro: 1, completude: 100 }))
        .status,
    ).toBe(422);

    expect((await pedir(x, 'delete', `/v1/negocios/${n.id}`)).status).toBe(204);
    expect((await pedir(x, 'get', `/v1/negocios/${n.id}`)).status).toBe(404);
  });

  it('contato de outra empresa ou excluído dá 422', async () => {
    const x = await conta('Conta Contato Negócio');
    const y = await conta('Outra Contato Negócio');
    const deY = await criarContato(y);
    expect(
      (await pedir(x, 'post', '/v1/negocios', { contato_id: deY.id, titulo: 'X' })).status,
    ).toBe(422);
    const excluido = await criarContato(x);
    await pedir(x, 'delete', `/v1/contatos/${excluido.id}`);
    expect(
      (await pedir(x, 'post', '/v1/negocios', { contato_id: excluido.id, titulo: 'X' })).status,
    ).toBe(422);
  });

  it('avançar exige os requisitos (409 com a lista); voltar não exige; pular etapa não escapa', async () => {
    const x = await conta('Conta Mover');
    const [novo, qualificacao, diagnostico, enviado] = (await funil(x)).etapas;
    const k = await criarContato(x);
    let n = await criarNegocio(x, k.id);
    const barrado = await mover(x, n, qualificacao!.id);
    expect(barrado.status).toBe(409);
    expect(barrado.body.code).toBe('requisitos_pendentes');
    expect(barrado.body.requisitos.map((r: { chave: string }) => r.chave)).toEqual([
      'contato_tem_origem',
    ]);

    n = await qualificar(x, k.id, n);
    // Pular do Novo contato direto para Orçamento enviado esbarra na tarefa do Diagnóstico.
    const pulo = await mover(x, n, enviado!.id);
    expect(pulo.status).toBe(409);
    expect(pulo.body.requisitos.map((r: { chave: string }) => r.chave)).toEqual([
      'dispositivo_ou_orcamento_remoto',
      'elaborar_orcamento',
    ]);
    const velho = await mover(
      x,
      { ...n, versao_registro: n.versao_registro - 1 },
      qualificacao!.id,
    );
    expect([velho.status, velho.body.code]).toEqual([409, 'conflito_versao']);
    n = await ok(mover(x, n, qualificacao!.id), NegocioDetalhado);
    expect(n).toMatchObject({ etapa_id: qualificacao!.id, versao_registro: 2 });
    n = await ok(mover(x, n, diagnostico!.id), NegocioDetalhado);
    n = await ok(mover(x, n, novo!.id), NegocioDetalhado);
    expect(n.etapa_id).toBe(novo!.id);
    const { rows } = await c.sql(
      `SELECT count(*)::int AS total FROM historico_etapa_negocio WHERE negocio_id = $1`,
      [n.id],
    );
    expect(rows[0]!.total).toBe(4);
  });

  it('entrar na etapa cria as tarefas, sem duplicar; concluir atende o requisito; o contato é qualificado', async () => {
    const x = await conta('Conta Tarefas Etapa');
    const [, qualificacao, diagnostico, enviado] = (await funil(x)).etapas;
    const k = await criarContato(x);
    let n = await qualificar(x, k.id, await criarNegocio(x, k.id));
    n = await ok(mover(x, n, qualificacao!.id), NegocioDetalhado);
    expect((await ok(pedir(x, 'get', `/v1/contatos/${k.id}`), Contato)).ciclo_vida).toBe('LEAD');
    n = await ok(mover(x, n, diagnostico!.id), NegocioDetalhado);
    expect((await ok(pedir(x, 'get', `/v1/contatos/${k.id}`), Contato)).ciclo_vida).toBe(
      'LEAD_QUALIFICADO',
    );
    n = await ok(mover(x, n, qualificacao!.id), NegocioDetalhado);
    n = await ok(mover(x, n, diagnostico!.id), NegocioDetalhado);
    const tarefas = await tarefasDo(x, n.id);
    expect(tarefas.map((t) => [t.titulo, t.origem, t.status])).toEqual([
      ['Elaborar orçamento', 'REQUISITO_ETAPA', 'PENDENTE'],
    ]);
    expect(n.completude).toBe(0);

    await ok(pedir(x, 'post', `/v1/tarefas/${tarefas[0]!.id}/concluir`), Tarefa);
    const lido = await ok(pedir(x, 'get', `/v1/negocios/${n.id}`), NegocioDetalhado);
    expect(lido.requisitos.map((r) => [r.chave, r.atendido])).toEqual([
      ['dispositivo_ou_orcamento_remoto', false],
      ['elaborar_orcamento', true],
    ]);
    expect(lido.completude).toBe(50);
    // Sem dispositivo (F5) ainda não avança.
    const barrado = await mover(x, lido, enviado!.id);
    expect(barrado.body.requisitos.map((r: { chave: string }) => r.chave)).toEqual([
      'dispositivo_ou_orcamento_remoto',
    ]);
  });

  it('Ganho dá 409; perder exige motivo ativo, fecha e cancela as tarefas; perdido não reabre', async () => {
    const x = await conta('Conta Perder');
    const etapas = (await funil(x)).etapas;
    const ganho = etapas.find((e) => e.tipo === 'GANHO')!;
    const perdido = etapas.find((e) => e.tipo === 'PERDIDO')!;
    const k = await criarContato(x);
    const n = await criarNegocio(x, k.id);
    await ok(pedir(x, 'post', '/v1/tarefas', { titulo: 'Ligar', negocio_id: n.id }), Tarefa, 201);
    const g = await mover(x, n, ganho.id);
    expect([g.status, g.body.code]).toEqual([409, 'transicao_invalida']);

    const [motivo, inativo] = ListaMotivosPerda.parse(
      (await pedir(x, 'get', '/v1/motivos-perda')).body,
    ).dados;
    await pedir(x, 'delete', `/v1/motivos-perda/${inativo!.id}`);
    const semMotivo = await pedir(x, 'post', `/v1/negocios/${n.id}/perder`, {
      motivo_perda_id: inativo!.id,
      versao_registro: 0,
    });
    expect(semMotivo.status).toBe(422);
    const p = await ok(
      pedir(x, 'post', `/v1/negocios/${n.id}/perder`, {
        motivo_perda_id: motivo!.id,
        versao_registro: 0,
      }),
      NegocioDetalhado,
    );
    expect(p).toMatchObject({
      status: 'PERDIDO',
      etapa_id: perdido.id,
      motivo_perda_id: motivo!.id,
    });
    expect(p.fechado_em).not.toBeNull();
    expect((await tarefasDo(x, n.id)).map((t) => t.status)).toEqual(['CANCELADA']);
    const reabrir = await mover(x, p, etapas[0]!.id);
    expect(reabrir.status).toBe(409);
  });

  it('nutrir exige data futura e cancela só as tarefas de requisito; mover reativa', async () => {
    const x = await conta('Conta Nutrir');
    const etapas = (await funil(x)).etapas;
    const [novo] = etapas;
    const k = await criarContato(x);
    const funilComTarefa = paraEdicao(await funil(x));
    funilComTarefa[0]!.requisitos.push({
      tipo: 'TAREFA',
      chave: 'ligar',
      descricao: 'Ligar',
      obrigatorio: false,
      titulo_tarefa: 'Ligar',
    });
    await ok(pedir(x, 'patch', '/v1/funil', { etapas: funilComTarefa }), Funil);
    const n = await criarNegocio(x, k.id);
    await ok(pedir(x, 'post', '/v1/tarefas', { titulo: 'Manual', negocio_id: n.id }), Tarefa, 201);
    const passado = await pedir(x, 'post', `/v1/negocios/${n.id}/nutrir`, {
      nba_adiada_ate: '2020-01-01T00:00:00Z',
      versao_registro: 0,
    });
    expect(passado.status).toBe(422);
    const nutrido = await ok(
      pedir(x, 'post', `/v1/negocios/${n.id}/nutrir`, {
        nba_adiada_ate: '2099-01-01T00:00:00Z',
        versao_registro: 0,
      }),
      NegocioDetalhado,
    );
    expect(nutrido).toMatchObject({
      status: 'NUTRICAO',
      nba_adiada_ate: '2099-01-01T00:00:00.000Z',
      completude: 100,
    });
    const status = Object.fromEntries((await tarefasDo(x, n.id)).map((t) => [t.titulo, t.status]));
    expect(status).toEqual({ Ligar: 'CANCELADA', Manual: 'PENDENTE' });
    const reativado = await ok(mover(x, nutrido, novo!.id), NegocioDetalhado);
    expect(reativado).toMatchObject({ status: 'ABERTO', etapa_id: novo!.id, nba_adiada_ate: null });
    // A tarefa da etapa volta (a cancelada não conta).
    expect(
      (await tarefasDo(x, n.id))
        .filter((t) => t.titulo === 'Ligar')
        .map((t) => t.status)
        .sort(),
    ).toEqual(['CANCELADA', 'PENDENTE']);
  });

  it('PROPRIO: só vê e mantém os seus; cria como responsável; contato precisa ser dele', async () => {
    const x = await conta('Conta Negócio Próprio');
    const vendedor = await novoMembro(
      c,
      x.tenantId,
      {
        'contato.read': 'PROPRIO',
        'contato.create': 'PROPRIO',
        'negocio.read': 'PROPRIO',
        'negocio.create': 'PROPRIO',
        'negocio.update': 'PROPRIO',
      },
      x.empresaId,
    );
    const v = { token: vendedor.token, empresaId: x.empresaId };
    const doDono = await criarContato(x, { responsavel_id: x.donoId });
    const negocioDoDono = await criarNegocio(x, doDono.id, { responsavel_id: x.donoId });
    expect(
      (await pedir(v, 'post', '/v1/negocios', { contato_id: doDono.id, titulo: 'X' })).status,
    ).toBe(422);
    const meu = await ok(
      pedir(v, 'post', '/v1/contatos', { nome: 'Meu', email: 'meu@n.test' }),
      Contato,
      201,
    );
    const n = await ok(
      pedir(v, 'post', '/v1/negocios', { contato_id: meu.id, titulo: 'Meu negócio' }),
      NegocioDetalhado,
      201,
    );
    expect(n.responsavel_id).toBe(vendedor.membroId);
    const lista = (await pedir(v, 'get', '/v1/negocios')).body.dados.map(
      (k: { id: string }) => k.id,
    );
    expect(lista).toEqual([n.id]);
    expect((await pedir(v, 'get', `/v1/negocios/${negocioDoDono.id}`)).status).toBe(404);
    expect((await mover(v, negocioDoDono, n.etapa_id)).status).toBe(404);
    const filtrado = await pedir(v, 'get', `/v1/negocios?filtro[responsavel_id]=${x.donoId}`);
    expect(filtrado.body.dados).toEqual([]);
    const passar = await pedir(v, 'patch', `/v1/negocios/${n.id}`, {
      versao_registro: 0,
      responsavel_id: x.donoId,
    });
    expect(passar.status).toBe(403);
  });
});

describe('tarefas', () => {
  it('CRUD; ordem de vencimento com páginas; concluída e cancelada não mudam', async () => {
    const x = await conta('Conta Tarefas');
    for (const [titulo, vence] of [
      ['Sem prazo', undefined],
      ['Depois', '2026-12-20T12:00:00Z'],
      ['Antes', '2026-12-10T12:00:00Z'],
    ] as const)
      await ok(
        pedir(x, 'post', '/v1/tarefas', { titulo, ...(vence ? { vence_em: vence } : {}) }),
        Tarefa,
        201,
      );
    const p1 = ListaTarefas.parse((await pedir(x, 'get', '/v1/tarefas?limit=2')).body);
    expect(p1.dados.map((t) => t.titulo)).toEqual(['Antes', 'Depois']);
    const p2 = ListaTarefas.parse(
      (await pedir(x, 'get', `/v1/tarefas?limit=2&cursor=${p1.proximo_cursor}`)).body,
    );
    expect(p2).toMatchObject({ dados: [{ titulo: 'Sem prazo' }], proximo_cursor: null });

    const t = p1.dados[0]!;
    const editada = await ok(
      pedir(x, 'patch', `/v1/tarefas/${t.id}`, { status: 'EM_ANDAMENTO', prioridade: 'ALTA' }),
      Tarefa,
    );
    expect(editada).toMatchObject({ status: 'EM_ANDAMENTO', prioridade: 'ALTA' });
    const concluida = await ok(pedir(x, 'post', `/v1/tarefas/${t.id}/concluir`), Tarefa);
    expect(concluida.concluida_em).not.toBeNull();
    expect((await pedir(x, 'patch', `/v1/tarefas/${t.id}`, { titulo: 'X' })).status).toBe(409);
    expect((await pedir(x, 'post', `/v1/tarefas/${t.id}/concluir`)).status).toBe(409);

    const outra = p1.dados[1]!;
    expect((await pedir(x, 'delete', `/v1/tarefas/${outra.id}`)).status).toBe(204);
    expect((await ok(pedir(x, 'get', `/v1/tarefas/${outra.id}`), Tarefa)).status).toBe('CANCELADA');
    expect((await pedir(x, 'delete', `/v1/tarefas/${outra.id}`)).status).toBe(409);
  });

  it('com negócio, o contato é o dele; negócio e contato que não combinam dão 422', async () => {
    const x = await conta('Conta Vínculo Tarefa');
    const k = await criarContato(x);
    const outro = await criarContato(x);
    const n = await criarNegocio(x, k.id);
    const t = await ok(
      pedir(x, 'post', '/v1/tarefas', { titulo: 'Ligar', negocio_id: n.id }),
      Tarefa,
      201,
    );
    expect(t.contato_id).toBe(k.id);
    const errado = await pedir(x, 'post', '/v1/tarefas', {
      titulo: 'X',
      negocio_id: n.id,
      contato_id: outro.id,
    });
    expect(errado.status).toBe(422);
  });

  it('PROPRIO: só vê e mexe nas suas; responsável é quem age', async () => {
    const x = await conta('Conta Tarefa Própria');
    const tecnico = await novoMembro(
      c,
      x.tenantId,
      { 'tarefa.read': 'PROPRIO', 'tarefa.create': 'PROPRIO', 'tarefa.update': 'PROPRIO' },
      x.empresaId,
    );
    const tk = { token: tecnico.token, empresaId: x.empresaId };
    const doDono = await ok(
      pedir(x, 'post', '/v1/tarefas', { titulo: 'Do dono', responsavel_id: x.donoId }),
      Tarefa,
      201,
    );
    const minha = await ok(pedir(tk, 'post', '/v1/tarefas', { titulo: 'Minha' }), Tarefa, 201);
    expect(minha.responsavel_id).toBe(tecnico.membroId);
    const vistas = ListaTarefas.parse((await pedir(tk, 'get', '/v1/tarefas')).body).dados.map(
      (t) => t.id,
    );
    expect(vistas).toEqual([minha.id]);
    expect((await pedir(tk, 'post', `/v1/tarefas/${doDono.id}/concluir`)).status).toBe(404);
    expect(
      (await pedir(tk, 'post', '/v1/tarefas', { titulo: 'X', responsavel_id: x.donoId })).status,
    ).toBe(403);
  });
});

describe('completude', () => {
  it('o perfil do contato acompanha os dados e o consentimento no canal preferido', async () => {
    const x = await conta('Conta Completude');
    const k = await criarContato(x);
    expect([k.completude_perfil, k.campos_faltantes]).toEqual([
      40,
      ['contato_tem_origem', 'contato.canal_preferido', 'consentimento_transacional'],
    ]);
    const origem = ListaOrigens.parse((await pedir(x, 'get', '/v1/origens')).body).dados[0]!;
    const editado = await ok(
      pedir(x, 'patch', `/v1/contatos/${k.id}`, { origem_id: origem.id, canal_preferido: 'EMAIL' }),
      Contato,
    );
    expect([editado.completude_perfil, editado.campos_faltantes]).toEqual([
      80,
      ['consentimento_transacional'],
    ]);
    // Consentimento em outro canal não conta.
    await pedir(x, 'post', `/v1/contatos/${k.id}/consentimentos`, {
      canal: 'WHATSAPP',
      finalidade: 'TRANSACIONAL',
      concedido: true,
      base_legal: 'consentimento',
    });
    expect((await ok(pedir(x, 'get', `/v1/contatos/${k.id}`), Contato)).completude_perfil).toBe(80);
    await pedir(x, 'post', `/v1/contatos/${k.id}/consentimentos`, {
      canal: 'EMAIL',
      finalidade: 'TRANSACIONAL',
      concedido: true,
      base_legal: 'consentimento',
    });
    const completo = await ok(pedir(x, 'get', `/v1/contatos/${k.id}`), Contato);
    expect([completo.completude_perfil, completo.campos_faltantes]).toEqual([100, []]);
  });

  it('mudar o contato atualiza a completude dos negócios abertos dele', async () => {
    const x = await conta('Conta Completude Negócio');
    const k = await criarContato(x);
    const n = await criarNegocio(x, k.id);
    expect(n.completude).toBe(67);
    const origem = ListaOrigens.parse((await pedir(x, 'get', '/v1/origens')).body).dados[0]!;
    await pedir(x, 'patch', `/v1/contatos/${k.id}`, { origem_id: origem.id });
    expect((await ok(pedir(x, 'get', `/v1/negocios/${n.id}`), NegocioDetalhado)).completude).toBe(
      100,
    );
  });

  it('criar contato e negócio grava um registro só no audit log (a completude vai junto)', async () => {
    const x = await conta('Conta Audit Completude');
    const k = await criarContato(x);
    const n = await criarNegocio(x, k.id);
    for (const id of [k.id, n.id]) {
      const { rows } = await c.sql(`SELECT acao FROM audit_log WHERE entidade_id = $1`, [id]);
      expect(rows.map((r) => r.acao)).toEqual(['create']);
    }
  });
});
