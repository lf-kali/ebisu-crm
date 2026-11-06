import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Jornada do funil pela UI (plano docs/planos/f4-web-2-negocios.md, decisão 9), contra a API real
// e o funil padrão do seed: criar o negócio pela ficha do contato, esbarrar no que falta, completar
// os dados e mover, concluir a tarefa do funil, registrar uma ligação e perder com um motivo.

const SENHA = 'cavalo-bateria-grampo-42';
const sufixo = randomUUID().slice(0, 8);

test('criar, mover com o que falta, concluir a tarefa, registrar e perder um negócio', async ({
  page,
}) => {
  await page.goto('/cadastro');
  await page.getByLabel('Seu nome').fill('Davi Lopes');
  await page.getByLabel('E-mail').fill(`davi.${sufixo}@e2e.test`);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByLabel('Nome da conta').fill(`Assistência Funil ${sufixo}`);
  await page.getByLabel('Razão social').fill('Lopes Assistência Ltda');
  await page.getByLabel('Nome fantasia').fill('Lopes Centro');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();

  // Contato com origem, canal preferido e consentimento: os requisitos de contato do funil.
  await page.getByRole('link', { name: 'Contatos' }).click();
  await page.getByRole('link', { name: 'Novo contato' }).click();
  await page.getByLabel('Nome').fill('Helena Prado');
  await page.getByLabel('Telefone').fill('(11) 97654-3210');
  await page.getByLabel('Canal preferido').selectOption({ label: 'WhatsApp' });
  await page.getByLabel('Origem').selectOption({ label: 'Indicação' });
  await page.getByRole('button', { name: 'Criar contato' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Helena Prado' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar consentimento' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Novo negócio pela ficha do contato, ainda sem o tipo e o problema.
  const negocios = page.getByRole('region', { name: 'Negócios' });
  await negocios.getByRole('button', { name: 'Novo negócio' }).click();
  await page.getByRole('dialog').getByLabel('Título').fill('Tela quebrada');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar negócio' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tela quebrada' })).toBeVisible();

  // Pular a Qualificação sem o tipo e o problema mostra o que falta.
  await page.getByRole('button', { name: 'Mover para… Tela quebrada' }).click();
  await page.getByRole('menuitem', { name: 'Diagnóstico / Orçamento' }).click();
  await expect(page.getByText('Falta para avançar:')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Tipo do dispositivo' })).toBeVisible();

  // Completar e mover.
  await page.getByRole('button', { name: 'Editar' }).click();
  const janela = page.getByRole('dialog');
  await janela.getByLabel('Tipo de dispositivo').selectOption({ label: 'Celular' });
  await janela.getByLabel('Problema ou interesse').fill('Tela trincada após queda');
  await janela.getByRole('button', { name: 'Salvar' }).click();
  await expect(janela).toBeHidden();
  await page.getByRole('button', { name: 'Mover para… Tela quebrada' }).click();
  await page.getByRole('menuitem', { name: 'Diagnóstico / Orçamento' }).click();
  const oQueFalta = page.getByRole('region', { name: 'O que falta' });
  await expect(oQueFalta.getByText('Orçamento elaborado')).toBeVisible();

  // A tarefa do funil nasce com a etapa; concluí-la atende o requisito.
  const tarefas = page.getByRole('region', { name: 'Tarefas' });
  await expect(tarefas.getByText('Do funil')).toBeVisible();
  await tarefas.getByRole('button', { name: 'Concluir Elaborar orçamento' }).click();
  await expect(
    oQueFalta.getByRole('listitem').filter({ hasText: 'Orçamento elaborado' }),
  ).toContainText('feito');

  // Registrar uma ligação na timeline.
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await timeline.getByRole('button', { name: 'Registrar atividade' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Resultado (opcional)')
    .fill('pediu orçamento por WhatsApp');
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(timeline.getByText('Resultado: pediu orçamento por WhatsApp')).toBeVisible();

  // Perder com um motivo; o negócio vai para a aba Perdidos do quadro.
  await page.getByRole('button', { name: 'Perder' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Motivo da perda')
    .selectOption({ label: 'Preço acima do esperado' });
  await page.getByRole('dialog').getByRole('button', { name: 'Perder negócio' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('main').getByRole('link', { name: 'Negócios' }).click();
  await page.getByRole('tab', { name: 'Perdidos' }).click();
  await expect(
    page.getByRole('tabpanel').getByRole('link', { name: 'Tela quebrada' }),
  ).toBeVisible();
});
