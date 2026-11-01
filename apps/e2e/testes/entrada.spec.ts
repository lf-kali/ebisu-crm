import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { URL_API } from '../ambiente';
import { esperarEmail, linkDoConvite } from '../mailpit';

// Caminho feliz da entrada pública (plano docs/planos/f3-web-1-cadastro-convite.md): cadastrar
// pela UI, convidar (pela API, até as telas de Configurações), receber o e-mail no Mailpit e
// aceitar pelo link.

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

/** Convida pela API, como o dono (login próprio, sem mexer na sessão do navegador). */
async function convidar(email: string) {
  const json = async <T>(resposta: Response): Promise<T> => {
    if (!resposta.ok) throw new Error(`${resposta.status}: ${await resposta.text()}`);
    return (await resposta.json()) as T;
  };
  const sessao = await json<{ access_token: string }>(
    await fetch(`${URL_API}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: dono.email, senha: SENHA }),
    }),
  );
  const auth = { Authorization: `Bearer ${sessao.access_token}` };
  const eu = await json<{ empresas: Array<{ id: string }> }>(
    await fetch(`${URL_API}/v1/eu`, { headers: auth }),
  );
  const papeis = await json<{ dados: Array<{ id: string; chave: string }> }>(
    await fetch(`${URL_API}/v1/papeis`, { headers: auth }),
  );
  const atendente = papeis.dados.find((p) => p.chave === 'ATENDENTE')!;
  await json(
    await fetch(`${URL_API}/v1/membros/convites`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        email,
        atribuicoes: [{ papel_id: atendente.id, empresa_id: eu.empresas[0]!.id }],
      }),
    }),
  );
}

test('cadastrar, convidar e aceitar o convite pelo link do e-mail', async ({ page, browser }) => {
  await cadastrar(page);
  await expect(page.getByRole('button', { name: new RegExp(dono.nome) })).toBeVisible();

  await convidar(convidado.email);
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
