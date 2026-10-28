import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { estaAtivo } from './app-shell';
import { NAVEGACAO } from './navegacao';

const menuLateral = () => screen.getByRole('navigation', { name: 'Menu principal' });

describe('AppShell (layout base, F12)', () => {
  it('tem cabeçalho, menu principal e conteúdo com link para pular o menu', async () => {
    renderizarApp('/contatos');
    expect(await screen.findByRole('heading', { name: 'Contatos' })).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    const pular = screen.getByRole('link', { name: 'Pular para o conteúdo' });
    expect(pular.getAttribute('href')).toBe('#conteudo');
    expect(screen.getByRole('main').id).toBe('conteudo');
  });

  it('lista todos os módulos e marca o atual com aria-current', async () => {
    renderizarApp('/contatos');
    await screen.findByRole('heading', { name: 'Contatos' });
    const links = within(menuLateral()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(NAVEGACAO.map((i) => i.rotulo));
    const atuais = links.filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atuais.map((l) => l.textContent)).toEqual(['Contatos']);
  });

  it('clicar num módulo do menu navega e move o item ativo', async () => {
    const usuario = userEvent.setup();
    const { router } = renderizarApp('/');
    await screen.findByRole('heading', { name: 'Painel' });
    await usuario.click(within(menuLateral()).getByRole('link', { name: 'Bancada' }));
    expect(await screen.findByRole('heading', { name: 'Bancada' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/bancada');
    const ativo = within(menuLateral()).getByRole('link', { current: 'page' });
    expect(ativo.textContent).toBe('Bancada');
  });

  it('no celular, o botão abre o menu em painel e fecha ao navegar', async () => {
    const usuario = userEvent.setup();
    renderizarApp('/');
    await usuario.click(await screen.findByRole('button', { name: 'Abrir menu' }));
    const painel = await screen.findByRole('dialog');
    expect(within(painel).getByRole('heading', { name: 'ebisuCRM' })).toBeTruthy();
    await usuario.click(within(painel).getByRole('link', { name: 'Estoque' }));
    expect(await screen.findByRole('heading', { name: 'Estoque' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('não tem violações de acessibilidade (axe)', async () => {
    const { container } = renderizarApp('/');
    await screen.findByText('API disponível');
    expect(await violacoesA11y(container)).toEqual([]);
  });
});

describe('estaAtivo', () => {
  it.each([
    ['/', '/', true],
    ['/', '/contatos', false],
    ['/contatos', '/contatos', true],
    ['/contatos', '/contatos/123', true],
    ['/contatos', '/contatos-antigos', false],
    ['/contatos', undefined, false],
  ] as const)('%s com página %s → %s', (caminho, atual, esperado) => {
    expect(estaAtivo(caminho, atual)).toBe(esperado);
  });
});
