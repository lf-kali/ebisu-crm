import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarAppDeTeste } from './app-de-teste.js';
import { ExemploController, ID_EXEMPLO } from './exemplo.controller.js';

const PROBLEMA = /^application\/problem\+json/;

describe('contrato: validação de entrada e saída, envelope de erro (§5.1, §5.2)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await criarAppDeTeste([ExemploController]);
  });
  afterAll(async () => {
    await app?.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('entrada válida → status do contrato e corpo validado', async () => {
    const r = await http().post('/v1/exemplo').send({ nome: 'Tela', valor: '900.00' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: ID_EXEMPLO, nome: 'Tela', valor: '900.00' });
  });

  it('SEG-5: campo não declarado no contrato é removido da resposta', async () => {
    const r = await http()
      .post('/v1/exemplo?modo=vaza_campo')
      .send({ nome: 'Tela', valor: '900.00' });
    expect(r.status).toBe(201);
    expect(r.body).not.toHaveProperty('custo_medio');
  });

  it('corpo inválido → 422 validacao com os campos e o request_id', async () => {
    const r = await http().post('/v1/exemplo').send({ nome: '', valor: 900 });
    expect(r.status).toBe(422);
    expect(r.headers['content-type']).toMatch(PROBLEMA);
    expect(r.body).toMatchObject({
      type: 'urn:ebisu:erro:validacao',
      code: 'validacao',
      status: 422,
      title: 'Alguns campos estão inválidos.',
      instance: '/v1/exemplo',
      request_id: r.headers['x-request-id'],
    });
    expect(r.body.campos.map((c: { campo: string }) => c.campo).sort()).toEqual(['nome', 'valor']);
  });

  it('query inválida → 422 com o campo da query', async () => {
    const r = await http().post('/v1/exemplo?modo=invasor').send({ nome: 'Tela', valor: '1.00' });
    expect(r.status).toBe(422);
    expect(r.body.campos).toEqual([expect.objectContaining({ campo: 'modo' })]);
  });

  it('JSON malformado → 422 validacao', async () => {
    const r = await http()
      .post('/v1/exemplo')
      .set('content-type', 'application/json')
      .send('{"nome":');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validacao');
  });

  it('corpo grande demais (body-parser) → 422 validacao com detalhe, sem log de erro', async () => {
    const logErro = vi.spyOn(Logger.prototype, 'error');
    const r = await http()
      .post('/v1/exemplo')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ nome: 'x'.repeat(200_000), valor: '1.00' }));
    expect(r.status).toBe(422);
    expect(r.headers['content-type']).toMatch(PROBLEMA);
    expect(r.body).toMatchObject({
      code: 'validacao',
      detail: 'O corpo da requisição excede o tamanho máximo.',
    });
    expect(logErro).not.toHaveBeenCalled();
  });

  it('erro do cliente (4xx) não gera log de erro; falha do servidor (5xx) gera', async () => {
    const logErro = vi.spyOn(Logger.prototype, 'error');
    await http().get('/v1/nao-existe');
    await http().post('/v1/exemplo').send({ nome: '' });
    expect(logErro).not.toHaveBeenCalled();
    await http().post('/v1/exemplo?modo=erro_inesperado').send({ nome: 'Tela', valor: '1.00' });
    expect(logErro).toHaveBeenCalledTimes(1);
  });

  it('parâmetro de rota inválido → 422; válido → 200', async () => {
    expect((await http().get('/v1/exemplo/nao-e-uuid')).status).toBe(422);
    const r = await http().get(`/v1/exemplo/${ID_EXEMPLO}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(ID_EXEMPLO);
  });

  it('resposta fora do contrato → 500 erro_interno, sem detalhes internos', async () => {
    const r = await http()
      .post('/v1/exemplo?modo=resposta_invalida')
      .send({ nome: 'Tela', valor: '1.00' });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'erro_interno', status: 500 });
    expect(JSON.stringify(r.body)).not.toMatch(/contrato|nao-e-uuid|Exemplo/);
  });

  it.each(['nest_503', 'nest_500', 'nest_502', 'nest_409'])(
    'HttpException sem código no catálogo (%s) → 500 erro_interno logado, nunca 422',
    async (modo) => {
      const logErro = vi.spyOn(Logger.prototype, 'error');
      const r = await http().post(`/v1/exemplo?modo=${modo}`).send({ nome: 'Tela', valor: '1.00' });
      expect(r.status).toBe(500);
      expect(r.body.code).toBe('erro_interno');
      expect(JSON.stringify(r.body)).not.toMatch(
        /10\.0\.0\.1|detalhe interno|gateway|conflito sem/,
      );
      expect(logErro).toHaveBeenCalledTimes(1);
    },
  );

  it('ErroDominio → status e mensagem do catálogo, invariante e extras', async () => {
    const r = await http()
      .post('/v1/exemplo?modo=erro_dominio')
      .send({ nome: 'Tela', valor: '1.00' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      code: 'estoque_insuficiente',
      title: 'Estoque insuficiente para esta peça.',
      invariante: 'EST-6',
      item_id: ID_EXEMPLO,
    });
  });

  it('erro inesperado → 500 erro_interno sem vazar a mensagem', async () => {
    const r = await http()
      .post('/v1/exemplo?modo=erro_inesperado')
      .send({ nome: 'Tela', valor: '1.00' });
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('erro_interno');
    expect(JSON.stringify(r.body)).not.toMatch(/senha|segredo|banco/);
  });

  it('ler parâmetro sem schema no contrato → 500 (bug de programação, não 422)', async () => {
    const r = await http().post('/v1/exemplo/sem-schema').send({ a: 1 });
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('erro_interno');
  });

  it('rota inexistente → 404 nao_encontrado no envelope', async () => {
    const r = await http().get('/v1/nao-existe');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(PROBLEMA);
    expect(r.body).toMatchObject({ code: 'nao_encontrado', title: 'Registro não encontrado.' });
  });

  it('request_id: reaproveita o do proxy se for seguro; senão gera outro', async () => {
    const seguro = await http().get('/v1/saude').set('x-request-id', 'proxy-123.abc');
    expect(seguro.headers['x-request-id']).toBe('proxy-123.abc');
    const inseguro = await http().get('/v1/nao-existe').set('x-request-id', 'a b<script>');
    expect(inseguro.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(inseguro.body.request_id).toBe(inseguro.headers['x-request-id']);
  });
});
