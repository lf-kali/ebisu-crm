import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { esperarEmail, linkDoConvite } from '../mailpit';

// Caminhos felizes da F3 pela UI (planos docs/planos/f3-web-1-cadastro-convite.md e
// f3-web-2-configuracoes.md): cadastrar, convidar pela tela de membros, receber o e-mail no Mailpit
// e aceitar pelo link; criar uma API key, ver o token uma vez e revogá-la.

const SENHA = 'cavalo-bateria-grampo-42';
const sufixo = randomUUID().slice(0, 8);
const dono = { nome: 'Marina Duarte', email: `marina.${sufixo}@e2e.test` };
const convidado = { nome: 'Caio Prado', email: `caio.${sufixo}@e2e.test` };
const CONTA = `Assistência E2E ${sufixo}`;

async function cadastrar(page: Page) {
  await page.goto('/cadastro');
  await page.getByLabel('Seu nome').fill(dono.nome);
  await page.getByLabel('E-mail').fill(dono.email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByLabel('Nome da conta').fill(CONTA);
  await page.getByLabel('Razão social').fill('Duarte Assistência Técnica Ltda');
  await page.getByLabel('Nome fantasia').fill('Duarte Centro');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
}

/** Convida pela tela de membros, como o dono. */
async function convidar(page: Page, email: string) {
  await page.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('link', { name: /Membros e convites/ }).click();
  await page.getByRole('button', { name: 'Convidar' }).click();
  const janela = page.getByRole('dialog');
  await janela.getByLabel('E-mail').fill(email);
  await janela.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible();
}

test('cadastrar, convidar e aceitar o convite pelo link do e-mail', async ({ page, browser }) => {
  await cadastrar(page);
  await expect(page.getByRole('button', { name: new RegExp(dono.nome) })).toBeVisible();

  await convidar(page, convidado.email);
  const link = linkDoConvite(await esperarEmail(convidado.email));

  // Outra pessoa, outro navegador: sem nada da sessão do dono.
  const contexto = await browser.newContext();
  const aceite = await contexto.newPage();
  await aceite.goto(link);
  await expect(aceite.getByRole('heading', { name: `Convite de ${CONTA}` })).toBeVisible();
  await expect(aceite).toHaveURL(/\/convite$/);
  await aceite.getByLabel('Seu nome').fill(convidado.nome);
  await aceite.getByLabel('Crie uma senha').fill(SENHA);
  await aceite.getByRole('button', { name: 'Aceitar e entrar' }).click();
  await expect(aceite.getByRole('heading', { name: 'Painel' })).toBeVisible();
  await expect(aceite.getByRole('button', { name: new RegExp(convidado.nome) })).toBeVisible();
  await contexto.close();

  // O link já usado não vale mais.
  const depois = await browser.newContext();
  const repetido = await depois.newPage();
  await repetido.goto(link);
  await expect(repetido.getByText('Este convite não vale mais')).toBeVisible();
  await depois.close();
});

test('criar uma API key de servidor, ver o token uma vez e revogar', async ({ page }) => {
  dono.email = `marina.chave.${sufixo}@e2e.test`;
  await cadastrar(page);
  await page.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('link', { name: /API keys/ }).click();
  await page.getByRole('button', { name: 'Nova chave' }).click();
  const janela = page.getByRole('dialog');
  await janela.getByLabel('Nome', { exact: true }).fill('n8n');
  await janela.getByRole('checkbox', { name: 'contato.read' }).check();
  await janela.getByRole('button', { name: 'Criar chave' }).click();

  const campo = page.getByLabel('Chave (cabeçalho X-Api-Key)');
  await expect(campo).toHaveValue(/^ebk_live_[A-Za-z0-9_-]{43}$/);
  const token = await campo.inputValue();
  await page.getByRole('button', { name: 'Já copiei' }).click();
  const linha = page.getByRole('row', { name: /n8n/ });
  await expect(linha).toContainText(token.slice(0, 17));
  await expect(page.getByText(token)).toHaveCount(0);

  await page.getByRole('button', { name: 'Revogar n8n' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revogar' }).click();
  await expect(linha.getByText('Revogada')).toBeVisible();
});
