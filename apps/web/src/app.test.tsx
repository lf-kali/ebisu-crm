import { criarProblema } from '@ebisu/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';

const responder = (corpo: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(corpo), { status }));

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mostra API disponível quando /v1/saude responde conforme o contrato', async () => {
    vi.stubGlobal('fetch', responder({ status: 'ok' }));
    render(<App />);
    expect(await screen.findByText('API disponível')).toBeTruthy();
  });

  it('mostra a mensagem do catálogo quando a API responde um erro', async () => {
    vi.stubGlobal('fetch', responder(criarProblema('erro_interno', { request_id: 'abc' }), 500));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Erro inesperado. Tente de novo mais tarde.',
    );
  });

  it('resposta fora do contrato ou falha de rede contam como indisponível', async () => {
    vi.stubGlobal('fetch', responder({ status: 'talvez' }));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível falar com o servidor',
    );
    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede')));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível falar com o servidor',
    );
  });
});
