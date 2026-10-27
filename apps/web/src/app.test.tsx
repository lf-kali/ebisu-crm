import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mostra API disponível quando /v1/saude responde 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok"}')));
    render(<App />);
    expect(await screen.findByText('API disponível')).toBeTruthy();
  });

  it('mostra API indisponível quando a requisição falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede')));
    render(<App />);
    expect(await screen.findByText('API indisponível')).toBeTruthy();
  });
});
