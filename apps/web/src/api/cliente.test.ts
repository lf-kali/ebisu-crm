import { criarProblema } from '@ebisu/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { servidor } from '../teste/servidor';
import { criarClienteApi } from './cliente';
import { ErroApi, ehConflitoDeVersao } from './erro-api';

const Item = z.object({ id: z.string(), nome: z.string() });
const api = criarClienteApi({ cabecalhos: () => ({ Authorization: 'Bearer t' }) });

/** Captura a última requisição que chegou ao servidor simulado. */
function capturar(metodo: 'get' | 'post' | 'patch' | 'delete', resposta: () => Response) {
  const recebidas: Request[] = [];
  servidor.use(
    http[metodo]('*/v1/itens*', ({ request }) => {
      recebidas.push(request.clone());
      return resposta();
    }),
  );
  return recebidas;
}

const falhaCom = async (promessa: Promise<unknown>) => {
  const erro = await promessa.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(ErroApi);
  return erro as ErroApi;
};

describe('cliente HTTP (F12)', () => {
  it('GET valida a resposta, envia os cabeçalhos e ignora query vazia', async () => {
    const recebidas = capturar('get', () => HttpResponse.json({ id: '1', nome: 'A', extra: 1 }));
    const item = await api.get('/v1/itens/1', {
      resposta: Item,
      query: { busca: 'joão', vazio: '', nulo: null, limite: 10 },
    });
    expect(item).toEqual({ id: '1', nome: 'A' });
    const req = recebidas[0]!;
    expect(new URL(req.url).search).toBe('?busca=jo%C3%A3o&limite=10');
    expect(req.headers.get('authorization')).toBe('Bearer t');
    expect(req.headers.get('idempotency-key')).toBeNull();
  });

  it('POST gera Idempotency-Key nova por chamada e respeita a chave informada', async () => {
    const recebidas = capturar('post', () =>
      HttpResponse.json({ id: '1', nome: 'A' }, { status: 201 }),
    );
    await api.post('/v1/itens', { resposta: Item, corpo: { nome: 'A' } });
    await api.post('/v1/itens', { resposta: Item, corpo: { nome: 'A' } });
    await api.post('/v1/itens', {
      resposta: Item,
      corpo: { nome: 'A' },
      chaveIdempotencia: 'fixa',
    });
    const chaves = recebidas.map((r) => r.headers.get('idempotency-key'));
    expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(chaves[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(chaves[0]).not.toBe(chaves[1]);
    expect(chaves[2]).toBe('fixa');
    expect(recebidas[0]!.headers.get('content-type')).toBe('application/json');
    expect(await recebidas[0]!.json()).toEqual({ nome: 'A' });
  });

  it('PATCH e DELETE não enviam Idempotency-Key; 204 com resposta null devolve undefined', async () => {
    const patch = capturar('patch', () => HttpResponse.json({ id: '1', nome: 'B' }));
    await api.patch('/v1/itens/1', { resposta: Item, corpo: { nome: 'B' } });
    const del = capturar('delete', () => new HttpResponse(null, { status: 204 }));
    expect(await api.delete('/v1/itens/1', { resposta: null })).toBeUndefined();
    expect(patch[0]!.headers.get('idempotency-key')).toBeNull();
    expect(del[0]!.headers.get('idempotency-key')).toBeNull();
  });

  it('422 vira ErroApi com erros por campo', async () => {
    const problema = criarProblema('validacao', {
      campos: [{ campo: 'endereco.cep', code: 'invalido', mensagem: 'CEP inválido' }],
    });
    capturar('post', () => HttpResponse.json(problema, { status: 422 }));
    const erro = await falhaCom(api.post('/v1/itens', { resposta: Item, corpo: {} }));
    expect(erro.status).toBe(422);
    expect(erro.codigo).toBe('validacao');
    expect(erro.errosDeCampo).toEqual({ 'endereco.cep': 'CEP inválido' });
    expect(ehConflitoDeVersao(erro)).toBe(false);
  });

  it('409 conflito_versao é reconhecido', async () => {
    capturar('patch', () => HttpResponse.json(criarProblema('conflito_versao'), { status: 409 }));
    const erro = await falhaCom(api.patch('/v1/itens/1', { resposta: Item, corpo: {} }));
    expect(ehConflitoDeVersao(erro)).toBe(true);
  });

  it('erro fora do envelope (HTML de proxy) vira erro_interno com o status recebido', async () => {
    capturar('get', () => new HttpResponse('<h1>Bad Gateway</h1>', { status: 502 }));
    const erro = await falhaCom(api.get('/v1/itens', { resposta: Item }));
    expect([erro.status, erro.codigo]).toEqual([502, 'erro_interno']);
  });

  it('sucesso fora do contrato vira erro_interno 500', async () => {
    capturar('get', () => HttpResponse.json({ id: 1 }));
    const erro = await falhaCom(api.get('/v1/itens/1', { resposta: Item }));
    expect([erro.status, erro.codigo]).toEqual([500, 'erro_interno']);
  });

  it('falha de rede vira ErroApi com status 0', async () => {
    capturar('get', () => HttpResponse.error());
    const erro = await falhaCom(api.get('/v1/itens/1', { resposta: Item }));
    expect(erro.status).toBe(0);
  });

  it('cancelamento repassa o AbortError (o TanStack Query cancela consultas antigas)', async () => {
    capturar('get', () => HttpResponse.json({ id: '1', nome: 'A' }));
    const controle = new AbortController();
    controle.abort();
    const erro = await api
      .get('/v1/itens/1', { resposta: Item, sinal: controle.signal })
      .catch((e: unknown) => e);
    expect(erro).not.toBeInstanceOf(ErroApi);
    expect((erro as Error).name).toBe('AbortError');
  });
});
