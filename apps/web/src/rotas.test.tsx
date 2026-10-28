import { criarProblema } from '@ebisu/contracts';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ErroApi } from './api/erro-api';
import { NAVEGACAO } from './layout/navegacao';
import { criarQueryClient } from './router';
import { renderizarApp } from './teste/app';
import { servidor } from './teste/servidor';

describe('Painel (/)', () => {
  it('mostra API disponível quando /v1/saude responde conforme o contrato', async () => {
    renderizarApp('/');
    expect(await screen.findByText('API disponível')).toBeTruthy();
  });

  it('mostra a mensagem do catálogo e o request_id quando a API responde um erro', async () => {
    servidor.use(
      http.get('*/v1/saude', () =>
        HttpResponse.json(criarProblema('erro_interno', { request_id: 'req-123' }), {
          status: 500,
        }),
      ),
    );
    renderizarApp('/');
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Erro inesperado. Tente de novo mais tarde.');
    expect(alerta.textContent).toContain('req-123');
  });

  it('resposta de sucesso fora do contrato vira erro inesperado, não "disponível"', async () => {
    servidor.use(http.get('*/v1/saude', () => HttpResponse.json({ status: 'talvez' })));
    renderizarApp('/');
    expect((await screen.findByRole('alert')).textContent).toContain('Erro inesperado');
    expect(screen.queryByText('API disponível')).toBeNull();
  });

  it('falha de rede mostra "sem conexão"', async () => {
    servidor.use(http.get('*/v1/saude', () => HttpResponse.error()));
    renderizarApp('/');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível falar com o servidor',
    );
  });
});

describe('rotas dos módulos', () => {
  it.each(NAVEGACAO.filter((item) => item.caminho !== '/').map((i) => [i.caminho, i.rotulo]))(
    '%s abre a página de %s',
    async (caminho, rotulo) => {
      renderizarApp(caminho);
      expect(await screen.findByRole('heading', { level: 1, name: rotulo })).toBeTruthy();
      expect(screen.getByText('Em construção')).toBeTruthy();
    },
  );

  it('caminho inexistente mostra "Página não encontrada" dentro do layout', async () => {
    renderizarApp('/nao-existe');
    expect(await screen.findByText('Página não encontrada')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeTruthy();
  });
});

describe('política de repetição das consultas', () => {
  const repetir = criarQueryClient().getDefaultOptions().queries?.retry as (
    tentativas: number,
    erro: unknown,
  ) => boolean;
  const erro = (status: number) => new ErroApi(criarProblema('erro_interno'), status);

  it.each([
    ['falha de rede', erro(0), true],
    ['5xx', erro(503), true],
    ['erro fora da API', new Error('x'), true],
    ['4xx', erro(404), false],
    ['422', erro(422), false],
  ])('%s → repete: %s', (_, e, esperado) => {
    expect(repetir(0, e)).toBe(esperado);
  });

  it('desiste depois de 2 repetições', () => {
    expect(repetir(1, erro(0))).toBe(true);
    expect(repetir(2, erro(0))).toBe(false);
  });
});
