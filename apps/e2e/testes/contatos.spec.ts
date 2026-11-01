import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Jornada de contatos pela UI (plano docs/planos/f4-web-1-contatos.md, decisão 11): o dono cria um
// contato, esbarra no telefone repetido e segue para o existente, acha o contato pelo nome sem
// acento, edita, registra um consentimento e exclui.

const SENHA = 'cavalo-bateria-grampo-42';
const sufixo = randomUUID().slice(0, 8);

test('criar, deduplicar, buscar, editar, consentir e excluir um contato', async ({ page }) => {
  await page.goto('/cadastro');
  await page.getByLabel('Seu nome').fill('Rita Campos');
  await page.getByLabel('E-mail').fill(`rita.${sufixo}@e2e.test`);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByLabel('Nome da conta').fill(`Assistência Contatos ${sufixo}`);
  await page.getByLabel('Razão social').fill('Campos Assistência Ltda');
  await page.getByLabel('Nome fantasia').fill('Campos Centro');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();

  // Criar.
  await page.getByRole('link', { name: 'Contatos' }).click();
  await expect(page.getByText('Nenhum contato ainda')).toBeVisible();
  await page.getByRole('link', { name: 'Novo contato' }).click();
  await page.getByLabel('Nome').fill('Conceição Araújo');
  await page.getByLabel('Telefone').fill('(11) 98765-4321');
  await page.getByLabel('Origem').selectOption({ label: 'Indicação' });
  await page.getByRole('button', { name: 'Criar contato' }).click();
  const titulo = page.getByRole('heading', { level: 1, name: 'Conceição Araújo' });
  await expect(titulo).toBeVisible();
  const ficha = page.url();

  // Telefone repetido (outro formato): o link leva ao existente.
  await page.goto('/contatos/novo');
  await page.getByLabel('Nome').fill('Outra Pessoa');
  await page.getByLabel('Telefone').fill('+55 11 98765-4321');
  await page.getByRole('button', { name: 'Criar contato' }).click();
  await expect(page.getByText('Já existe um contato com este telefone.')).toBeVisible();
  await page.getByRole('link', { name: 'Abrir contato existente' }).click();
  await expect(titulo).toBeVisible();
  expect(page.url()).toBe(ficha);

  // Busca sem acento.
  await page.getByRole('main').getByRole('link', { name: 'Contatos' }).click();
  await page.getByLabel('Buscar').fill('conceicao');
  await expect(page).toHaveURL(/q=conceicao/);
  await expect(page.getByRole('link', { name: 'Conceição Araújo' })).toBeVisible();

  // Editar.
  await page.getByRole('link', { name: 'Conceição Araújo' }).click();
  await page.getByRole('link', { name: 'Editar' }).click();
  await page.getByLabel('E-mail').fill('conceicao@cliente.test');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(titulo).toBeVisible();
  await expect(page.getByText('conceicao@cliente.test')).toBeVisible();

  // Consentimento.
  await page.getByRole('button', { name: 'Registrar consentimento' }).click();
  const janela = page.getByRole('dialog');
  await janela.getByLabel('Canal').selectOption({ label: 'E-mail' });
  await janela.getByLabel('Finalidade').selectOption({ label: 'Marketing' });
  await janela.getByRole('button', { name: 'Registrar' }).click();
  const situacao = page.getByRole('table', { name: 'Situação atual por canal e finalidade' });
  await expect(situacao.getByRole('row', { name: /E-mail/ })).toContainText('Concedido');
  await expect(
    page.getByRole('table', { name: 'Histórico de consentimentos' }).getByRole('row'),
  ).toHaveCount(2);

  // Excluir.
  await page.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page).toHaveURL(/\/contatos$/);
  await expect(page.getByText('Nenhum contato ainda')).toBeVisible();
});
