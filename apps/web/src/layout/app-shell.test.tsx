import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { violacoesA11y } from '../teste/axe';
import { AppShell } from './app-shell';
import { NAVEGACAO } from './navegacao';

describe('AppShell (layout base, F12)', () => {
  afterEach(cleanup);

  it('tem cabeçalho, menu principal e conteúdo com link para pular o menu', () => {
    render(<AppShell caminhoAtual="/contatos">conteúdo da página</AppShell>);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main').textContent).toContain('conteúdo da página');
    const pular = screen.getByRole('link', { name: 'Pular para o conteúdo' });
    expect(pular.getAttribute('href')).toBe('#conteudo');
    expect(screen.getByRole('main').id).toBe('conteudo');
  });

  it('lista todos os módulos e marca o atual com aria-current', () => {
    render(<AppShell caminhoAtual="/contatos">x</AppShell>);
    const menu = screen.getByRole('navigation', { name: 'Menu principal' });
    const links = within(menu).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(NAVEGACAO.map((i) => i.rotulo));
    const atuais = links.filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atuais.map((l) => l.textContent)).toEqual(['Contatos']);
  });

  it('no celular, o botão abre o menu em painel e fecha ao navegar', async () => {
    const usuario = userEvent.setup();
    render(<AppShell>x</AppShell>);
    await usuario.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const painel = await screen.findByRole('dialog');
    expect(within(painel).getByRole('heading', { name: 'ebisuCRM' })).toBeTruthy();
    await usuario.click(within(painel).getByRole('link', { name: 'Estoque' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('não tem violações de acessibilidade (axe)', async () => {
    const { container } = render(<AppShell caminhoAtual="/">conteúdo</AppShell>);
    expect(await violacoesA11y(container)).toEqual([]);
  });
});
