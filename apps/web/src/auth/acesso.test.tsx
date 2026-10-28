import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROTAS_AUTH, type RespostaEu } from '@ebisu/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMemoryHistory } from '@tanstack/react-router';
import { NAVEGACAO } from '../layout/navegacao';
import { criarRouter, criarSessaoECliente } from '../router';
import { CONTAS, USUARIOS } from '../simulacao/dados';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { servidor, simulada } from '../teste/servidor';
import { temPermissao } from './acesso';
import { donoDaPreferencia } from './empresa';

const ana = USUARIOS.find((u) => u.email === 'ana@demo.test')!;
const [centro, shopping] = ana.contas[0]!.empresas;
const menuLateral = () => screen.getByRole('navigation', { name: 'Menu principal' });
const modulosDoMenu = () =>
  within(menuLateral())
    .getAllByRole('link')
    .map((l) => l.textContent);

/** Captura o X-Empresa-Id de uma requisição de domínio (rota de sonda, só no teste). */
function sondaEmpresa() {
  const recebidos: Array<string | null> = [];
  servidor.use(
    http.get('*/v1/sonda', ({ request }) => {
      recebidos.push(request.headers.get('x-empresa-id'));
      return HttpResponse.json({ ok: true });
    }),
  );
  return recebidos;
}
const Ok = z.object({ ok: z.boolean() });

/** O leitor de tela junta "Empresa:" (sr-only) e o nome; o espaço entre eles pode sumir. */
const botaoEmpresa = (nome = '') =>
  screen.findByRole('button', { name: new RegExp(`^Empresa:\\s*${nome}`) });

async function trocarEmpresa(nome: string) {
  const u = userEvent.setup();
  await u.click(await botaoEmpresa());
  await u.click(await screen.findByRole('menuitemradio', { name: nome }));
}

describe('menus e páginas por permissão (F12)', () => {
  it('o técnico só vê os módulos que pode usar', async () => {
    renderizarApp('/', { logado: 'bruno@demo.test' });
    await screen.findByRole('heading', { name: 'Painel' });
    expect(modulosDoMenu()).toEqual(['Painel', 'Dispositivos', 'Bancada', 'Configurações']);
  });

  it('quem tem tudo vê o menu completo', async () => {
    renderizarApp('/');
    await screen.findByRole('heading', { name: 'Painel' });
    expect(modulosDoMenu()).toEqual(NAVEGACAO.map((i) => i.rotulo));
  });

  it('URL direta de módulo oculto mostra "sem acesso", dentro do layout', async () => {
    renderizarApp('/financeiro', { logado: 'bruno@demo.test' });
    expect(await screen.findByText('Sem acesso a este módulo')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Financeiro' })).toBeNull();
    expect(menuLateral()).toBeTruthy();
  });

  it('subcaminho de módulo oculto também é barrado (/contatos/123)', async () => {
    renderizarApp('/contatos/123', { logado: 'bruno@demo.test' });
    expect(await screen.findByText('Sem acesso a este módulo')).toBeTruthy();
  });

  it('membro sem nenhuma empresa vê o aviso em vez das páginas', async () => {
    servidor.use(
      http.get(`*${ROTAS_AUTH.eu}`, async () => {
        const eu: RespostaEu = {
          usuario: { id: ana.id, nome: ana.nome, email: ana.email, avatar_url: null },
          membro: { id: ana.contas[0]!.membroId, cargo: null },
          conta: CONTAS.ebisu,
          empresas: [],
        };
        return HttpResponse.json(eu);
      }),
    );
    renderizarApp('/contatos');
    expect(await screen.findByText('Nenhuma empresa disponível')).toBeTruthy();
    expect(modulosDoMenu()).toEqual(['Painel', 'Configurações']);
  });

  it('permissão vinda do protótipo não conta ("toString" não é permissão)', () => {
    expect(temPermissao({ 'contato.read': 'EMPRESA' }, 'contato.read')).toBe(true);
    expect(temPermissao({}, 'toString')).toBe(false);
    expect(temPermissao({}, 'constructor')).toBe(false);
  });

  it('toda permissão do menu existe no catálogo do seed', () => {
    // O vitest roda com o diretório do apps/web como atual.
    const catalogo = readFileSync(
      resolve(process.cwd(), '../../packages/db/src/seeds/catalogo-permissoes.ts'),
      'utf8',
    );
    const chaves = new Set(
      [...catalogo.matchAll(/definir\('([a-z_]+)', \{([^}]*)\}/g)].flatMap(([, recurso, acoes]) =>
        [...acoes!.matchAll(/^\s*([a-z_]+):/gm)].map(([, acao]) => `${recurso}.${acao}`),
      ),
    );
    expect(chaves.size).toBeGreaterThan(20);
    const doMenu = NAVEGACAO.flatMap((i) => (i.permissao ? [i.permissao] : []));
    expect(doMenu.filter((p) => !chaves.has(p))).toEqual([]);
  });
});

describe('empresa atual (X-Empresa-Id)', () => {
  it('começa na primeira empresa e manda o X-Empresa-Id nas requisições', async () => {
    const recebidos = sondaEmpresa();
    const { cliente } = renderizarApp('/');
    expect(await botaoEmpresa(centro!.nome_fantasia)).toBeTruthy();
    await cliente.get('/v1/sonda', { resposta: Ok });
    expect(recebidos).toEqual([centro!.id]);
  });

  it('a empresa já está escolhida quando o loader termina, antes de qualquer página buscar dados', async () => {
    // Os efeitos dos filhos rodam antes dos do layout: resolver só no efeito deixaria a primeira
    // consulta de uma página sair sem X-Empresa-Id.
    simulada.jaLogado('ana@demo.test');
    const { sessao, cliente, empresa } = criarSessaoECliente();
    const router = criarRouter({
      sessao,
      cliente,
      empresa,
      history: createMemoryHistory({ initialEntries: ['/contatos'] }),
    });
    await router.load();
    expect(empresa.obter()).toBe(centro!.id);
  });

  it('trocar de empresa muda o cabeçalho, refaz os dados e é lembrada por conta', async () => {
    const recebidos = sondaEmpresa();
    const { cliente, queryClient } = renderizarApp('/');
    await botaoEmpresa();
    queryClient.setQueryData(['contatos'], ['da empresa anterior']);
    await trocarEmpresa(shopping!.nome_fantasia);
    expect(await botaoEmpresa(shopping!.nome_fantasia)).toBeTruthy();
    await cliente.get('/v1/sonda', { resposta: Ok });
    expect(recebidos).toEqual([shopping!.id]);
    expect(queryClient.getQueryData(['contatos'])).toBeUndefined();
    expect(queryClient.getQueryData(['eu'])).toBeTruthy();
    expect(window.localStorage.getItem(`ebisu.empresa.${CONTAS.ebisu.tenant_id}.${ana.id}`)).toBe(
      shopping!.id,
    );
  });

  it('ao voltar (F5), abre na empresa lembrada', async () => {
    window.localStorage.setItem(`ebisu.empresa.${CONTAS.ebisu.tenant_id}.${ana.id}`, shopping!.id);
    renderizarApp('/');
    expect(await botaoEmpresa(shopping!.nome_fantasia)).toBeTruthy();
  });

  it('a empresa lembrada é do usuário: outro usuário da mesma conta não a herda', () => {
    const bruno = USUARIOS.find((u) => u.email === 'bruno@demo.test')!;
    const de = (id: string) => donoDaPreferencia({ usuario: { id }, conta: CONTAS.ebisu });
    expect(de(ana.id)).not.toBe(de(bruno.id));
  });

  it('empresa lembrada que não está mais no /v1/eu é ignorada', async () => {
    window.localStorage.setItem(`ebisu.empresa.${CONTAS.ebisu.tenant_id}.${ana.id}`, 'removida');
    renderizarApp('/');
    expect(await botaoEmpresa(centro!.nome_fantasia)).toBeTruthy();
  });

  it('perder acesso à empresa atual escolhe outra das que restam', async () => {
    const { queryClient } = renderizarApp('/');
    await botaoEmpresa(centro!.nome_fantasia);
    const eu = queryClient.getQueryData<RespostaEu>(['eu'])!;
    queryClient.setQueryData(['eu'], { ...eu, empresas: [shopping] });
    expect(await screen.findByText(shopping!.nome_fantasia, { selector: 'span' })).toBeTruthy();
  });

  it('com uma empresa só, mostra o nome sem menu de troca', async () => {
    renderizarApp('/', { logado: 'bruno@demo.test' });
    expect(await screen.findByText('Ebisu Centro', { selector: 'span' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Empresa:/ })).toBeNull();
  });

  it('cada conta tem a sua empresa: trocar de conta usa as empresas da outra', async () => {
    const u = userEvent.setup();
    renderizarApp('/escolher-conta');
    await u.click(await screen.findByRole('button', { name: 'Oficina do Bairro' }));
    await waitFor(() =>
      expect(screen.getByText('Oficina do Bairro', { selector: 'span.truncate' })).toBeTruthy(),
    );
  });

  it('trocar de conta não manda o X-Empresa-Id da conta anterior', async () => {
    const recebidos: Array<string | null> = [];
    servidor.use(
      http.get(`*${ROTAS_AUTH.eu}`, ({ request }) => {
        recebidos.push(request.headers.get('x-empresa-id'));
        return undefined;
      }),
    );
    const u = userEvent.setup();
    const { empresa, router } = renderizarApp('/');
    await waitFor(() => expect(empresa.obter()).toBe(centro!.id));
    await router.navigate({ to: '/escolher-conta' });
    recebidos.length = 0;
    await u.click(await screen.findByRole('button', { name: 'Oficina do Bairro' }));
    await screen.findByRole('heading', { name: 'Painel' });
    expect(recebidos.length).toBeGreaterThan(0);
    expect(recebidos).not.toContain(centro!.id);
    expect(empresa.obter()).toBe(ana.contas[1]!.empresas[0]!.id);
  });

  it('cabeçalho com seletor e menu aberto sem violações de acessibilidade (axe)', async () => {
    const { container } = renderizarApp('/');
    await trocarEmpresa(shopping!.nome_fantasia);
    await userEvent.setup().click(await botaoEmpresa());
    await screen.findByRole('menu');
    // O menu aberto fica num portal fora dos landmarks (padrão do Radix para menus
    // passageiros): a regra "region" do axe é boa prática, não entra na nota do Lighthouse.
    expect(await violacoesA11y(container.ownerDocument.body, ['region'])).toEqual([]);
  });
});
