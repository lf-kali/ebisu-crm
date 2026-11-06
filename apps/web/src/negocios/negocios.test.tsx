import { criarProblema, ROTAS_NEGOCIOS } from '@ebisu/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { USUARIOS } from '../simulacao/dados';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { servidor, simulada } from '../teste/servidor';

// Quadro e ficha do negócio (plano docs/planos/f4-web-2-negocios.md). Semeados na Ebisu Centro:
// "Bateria do notebook" (Maria, Novo contato, requisitos atendidos), "Troca de tela" (João,
// Qualificação, faltam tipo e problema) e "Upgrade de memória" (Pedro, perdido).

const EMPRESA = USUARIOS[0]!.contas[0]!.empresas[0]!.id;
const usuario = () => userEvent.setup();
const coluna = (nome: string) => screen.getByRole('region', { name: new RegExp(`^${nome}`) });
const idDo = (titulo: string) =>
  simulada.negocios.dados(EMPRESA).negocios.find((n) => n.titulo === titulo)!.id;

async function moverPeloMenu(u: ReturnType<typeof usuario>, titulo: string, etapa: string) {
  await u.click(screen.getByRole('button', { name: new RegExp(`Mover para… ${titulo}`) }));
  await u.click(await screen.findByRole('menuitem', { name: etapa }));
}

describe('quadro', () => {
  it('colunas por etapa aberta, com os cartões; sem violações', async () => {
    const { container } = renderizarApp('/negocios');
    const tela = await screen.findByRole('link', { name: 'Troca de tela' });
    const colunas = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(colunas.slice(0, 5).map((c) => c?.replace(/\d+\+?$/, ''))).toEqual([
      'Novo contato',
      'Qualificação',
      'Diagnóstico / Orçamento',
      'Orçamento enviado',
      'Negociação',
    ]);
    const cartao = tela.closest('li')!;
    expect(
      within(coluna('Qualificação')).getByRole('link', { name: 'Troca de tela' }),
    ).toBeTruthy();
    expect(within(cartao).getByText('R$ 450,00')).toBeTruthy();
    expect(await within(cartao).findByText('João Araújo')).toBeTruthy();
    expect(within(cartao).getByText('0% completo')).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
  });

  it('mover com requisito pendente mostra o que falta e o cartão fica', async () => {
    renderizarApp('/negocios');
    await screen.findByRole('link', { name: 'Troca de tela' });
    await moverPeloMenu(usuario(), 'Troca de tela', 'Diagnóstico / Orçamento');
    const alerta = await screen.findByText('Falta para avançar:');
    expect(alerta.closest('[role="alert"]')!.textContent).toMatch(/Tipo do dispositivo/);
    expect(
      within(coluna('Qualificação')).getByRole('link', { name: 'Troca de tela' }),
    ).toBeTruthy();
  });

  it('mover com os requisitos atendidos leva o cartão para a outra coluna', async () => {
    renderizarApp('/negocios');
    await screen.findByRole('link', { name: 'Bateria do notebook' });
    await moverPeloMenu(usuario(), 'Bateria do notebook', 'Qualificação');
    await waitFor(() =>
      expect(
        within(coluna('Qualificação')).getByRole('link', { name: 'Bateria do notebook' }),
      ).toBeTruthy(),
    );
    expect(
      within(coluna('Novo contato')).queryByRole('link', { name: 'Bateria do notebook' }),
    ).toBeNull();
  });

  it('conflito de versão avisa que o negócio mudou', async () => {
    servidor.use(
      http.post(`*${ROTAS_NEGOCIOS.negocios}/:id/mover`, () =>
        HttpResponse.json(criarProblema('conflito_versao'), { status: 409 }),
      ),
    );
    renderizarApp('/negocios');
    await screen.findByRole('link', { name: 'Bateria do notebook' });
    await moverPeloMenu(usuario(), 'Bateria do notebook', 'Qualificação');
    expect(await screen.findByText(/O negócio mudou enquanto você olhava/)).toBeTruthy();
  });

  it('abas fora do quadro em lista; a aba e a busca ficam na URL', async () => {
    const { router } = renderizarApp('/negocios');
    await screen.findByRole('link', { name: 'Troca de tela' });
    const u = usuario();
    await u.click(screen.getByRole('tab', { name: 'Perdidos' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ aba: 'PERDIDO' }));
    const painel = screen.getByRole('tabpanel');
    expect(await within(painel).findByRole('link', { name: 'Upgrade de memória' })).toBeTruthy();

    await u.type(screen.getByLabelText('Buscar'), 'tela');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ aba: 'PERDIDO', q: 'tela' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Bateria do notebook' })).toBeNull(),
    );
    expect(screen.getByRole('link', { name: 'Troca de tela' })).toBeTruthy();
  });

  it('novo negócio pelo quadro, escolhendo o contato pela busca', async () => {
    renderizarApp('/negocios');
    await screen.findByRole('link', { name: 'Troca de tela' });
    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Novo negócio' }));
    const janela = await screen.findByRole('dialog');
    await u.type(within(janela).getByLabelText('Buscar contato'), 'mar');
    await u.click(await within(janela).findByRole('radio', { name: /Maria Sá/ }));
    await u.type(within(janela).getByLabelText('Título'), 'Película');
    await u.type(within(janela).getByLabelText('Valor estimado (R$)'), '80,5');
    await u.click(within(janela).getByRole('button', { name: 'Criar negócio' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Película' })).toBeTruthy();
    expect(screen.getByText('R$ 80,50')).toBeTruthy();
  });

  it('sem negocio.update não há "Mover para…" nem ações na ficha', async () => {
    simulada.definirPermissoes('ana@demo.test', {
      'negocio.read': 'EMPRESA',
      'contato.read': 'EMPRESA',
    });
    renderizarApp(`/negocios/${idDo('Troca de tela')}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Troca de tela' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mover para/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Perder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo negócio' })).toBeNull();
  });
});

describe('ficha do negócio', () => {
  it('mostra o que falta; perder exige o motivo e o perdido fica só para leitura', async () => {
    const { container } = renderizarApp(`/negocios/${idDo('Troca de tela')}`);
    await screen.findByRole('heading', { level: 1, name: 'Troca de tela' });
    const falta = screen.getByRole('region', { name: 'O que falta' });
    expect(within(falta).getByText('Tipo do dispositivo').closest('li')!.textContent).toMatch(
      /pendente/,
    );
    expect(await violacoesA11y(container)).toEqual([]);

    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Perder' }));
    const janela = await screen.findByRole('dialog');
    await u.click(within(janela).getByRole('button', { name: 'Perder negócio' }));
    expect(await within(janela).findByText('Escolha o motivo da perda.')).toBeTruthy();
    await u.selectOptions(within(janela).getByLabelText('Motivo da perda'), 'Preço');
    await u.click(within(janela).getByRole('button', { name: 'Perder negócio' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      (await screen.findAllByText('Perdido', { selector: '[data-slot="badge"]' })).length,
    ).toBe(2);
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mover para/ })).toBeNull();
  });

  it('nutrir recusa data no passado', async () => {
    renderizarApp(`/negocios/${idDo('Troca de tela')}`);
    await screen.findByRole('heading', { level: 1, name: 'Troca de tela' });
    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Nutrir' }));
    const janela = await screen.findByRole('dialog');
    const data = within(janela).getByLabelText('Reativar em');
    await u.clear(data);
    await u.type(data, '2020-01-01');
    await u.click(within(janela).getByRole('button', { name: 'Nutrir' }));
    expect(
      await within(janela).findByText('A data de reativação precisa estar no futuro.'),
    ).toBeTruthy();
  });

  it('editar atende os requisitos; mover cria a tarefa do funil; concluí-la atualiza o que falta', async () => {
    renderizarApp(`/negocios/${idDo('Troca de tela')}`);
    await screen.findByRole('heading', { level: 1, name: 'Troca de tela' });
    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Editar' }));
    const janela = await screen.findByRole('dialog');
    await u.selectOptions(within(janela).getByLabelText('Tipo de dispositivo'), 'Celular');
    await u.type(within(janela).getByLabelText('Problema ou interesse'), 'Tela trincada');
    // A tarefa do funil herda o responsável do negócio; Ana só conclui as próprias (PROPRIO).
    await u.selectOptions(within(janela).getByLabelText('Responsável'), 'Ana Souza');
    await u.click(within(janela).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Tudo pronto para avançar.')).toBeTruthy();

    await moverPeloMenu(u, 'Troca de tela', 'Diagnóstico / Orçamento');
    const tarefas = await screen.findByRole('region', { name: 'Tarefas' });
    const tarefa = (
      await within(tarefas).findByText('Elaborar orçamento', { selector: '.font-medium' })
    ).closest('li')!;
    expect(within(tarefa).getByText('Do funil')).toBeTruthy();
    const falta = screen.getByRole('region', { name: 'O que falta' });
    await waitFor(() =>
      expect(within(falta).getByText('Orçamento elaborado').closest('li')!.textContent).toMatch(
        /pendente/,
      ),
    );
    await u.click(within(tarefa).getByRole('button', { name: 'Concluir Elaborar orçamento' }));
    await waitFor(() =>
      expect(within(falta).getByText('Orçamento elaborado').closest('li')!.textContent).toMatch(
        /feito/,
      ),
    );
  });
});
