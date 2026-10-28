import { criarProblema, RespostaEu, ROTAS_AUTH } from '@ebisu/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { criarSessaoECliente } from '../router';
import { CONTAS, SENHA_DEMO } from '../simulacao/dados';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { servidor, simulada } from '../teste/servidor';
import { destinoSeguro } from './destino';

const usuario = () => userEvent.setup();

async function entrar(email: string, senha = SENHA_DEMO) {
  const u = usuario();
  await u.type(await screen.findByLabelText('E-mail'), email);
  await u.type(screen.getByLabelText('Senha'), senha);
  await u.click(screen.getByRole('button', { name: 'Entrar' }));
  return u;
}

const abrirMenuUsuario = async (u: ReturnType<typeof usuario>, nome: string) => {
  await u.click(await screen.findByRole('button', { name: new RegExp(nome) }));
  return screen.findByRole('menu');
};

describe('login e proteção das páginas (F12)', () => {
  it('sem sessão, a página protegida leva ao login e volta para ela depois', async () => {
    const { router } = renderizarApp('/contatos', { logado: null });
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/contatos' });

    await entrar('bruno@demo.test');
    expect(await screen.findByRole('heading', { level: 1, name: 'Contatos' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/contatos');
    expect(screen.getByRole('button', { name: /Bruno Lima/ })).toBeTruthy();
  });

  it('o e-mail é aceito com maiúsculas e espaços nas pontas (normalizado na API)', async () => {
    renderizarApp('/', { logado: null });
    await entrar('  Bruno@Demo.test ');
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy();
  });

  it('senha errada mostra mensagem genérica e não sai do login', async () => {
    const { router } = renderizarApp('/', { logado: null });
    await entrar('bruno@demo.test', 'errada');
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('validação no navegador com mensagens em português, sem chamar a API', async () => {
    renderizarApp('/', { logado: null });
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Entrar' }));
    const email = screen.getByLabelText('E-mail');
    const senha = screen.getByLabelText('Senha');
    const erroDe = (campo: HTMLElement) =>
      document.getElementById(campo.getAttribute('aria-describedby') ?? '')?.textContent;
    await waitFor(() => expect(erroDe(email)).toBe('Campo obrigatório.'));
    expect(erroDe(senha)).toBe('Campo obrigatório.');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    await u.type(email, 'nao-e-email');
    await u.type(senha, 'x');
    await u.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/e-mail inválido/)).toBeTruthy();
    const descricao = document.getElementById(email.getAttribute('aria-describedby')!);
    expect(descricao?.textContent).toMatch(/e-mail inválido/);
  });

  it('422 da API aparece no campo certo', async () => {
    servidor.use(
      http.post(`*${ROTAS_AUTH.login}`, () =>
        HttpResponse.json(
          criarProblema('validacao', {
            campos: [{ campo: 'email', code: 'custom', mensagem: 'Conta bloqueada para login.' }],
          }),
          { status: 422 },
        ),
      ),
    );
    renderizarApp('/', { logado: null });
    await entrar('bruno@demo.test');
    expect(await screen.findByText('Conta bloqueada para login.')).toBeTruthy();
  });

  it('429 mostra a mensagem do catálogo', async () => {
    servidor.use(
      http.post(`*${ROTAS_AUTH.login}`, () =>
        HttpResponse.json(criarProblema('limite_excedido'), { status: 429 }),
      ),
    );
    renderizarApp('/', { logado: null });
    await entrar('bruno@demo.test');
    expect((await screen.findByRole('alert')).textContent).toContain('Muitas requisições');
  });

  it('?redirect para outro site é ignorado (sem open redirect)', async () => {
    const { router } = renderizarApp('/login?redirect=%2F%2Fmal.example%2Fx', { logado: null });
    await entrar('bruno@demo.test');
    await screen.findByRole('heading', { name: 'Painel' });
    expect(router.state.location.pathname).toBe('/');
  });

  it('quem já tem sessão e abre o login segue direto', async () => {
    const { router } = renderizarApp('/login?redirect=%2Festoque', { logado: 'bruno@demo.test' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Estoque' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/estoque');
  });
});

describe('várias contas (decisão do usuário: escolher após o login)', () => {
  it('com duas contas, escolhe depois do login; outra conta = troca de sessão', async () => {
    const { router, sessao } = renderizarApp('/bancada', { logado: null });
    await entrar('ana@demo.test');
    expect(await screen.findByRole('heading', { name: 'Escolha a conta' })).toBeTruthy();
    const atual = screen.getByRole('button', { name: /Assistência Ebisu/ });
    expect(atual.getAttribute('aria-current')).toBe('true');

    await usuario().click(screen.getByRole('button', { name: 'Oficina do Bairro' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bancada' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/bancada');
    expect(sessao.obter()?.conta).toEqual(CONTAS.oficina);
    expect(await screen.findByText('Oficina do Bairro', { selector: 'span' })).toBeTruthy();
  });

  it('o menu do usuário troca de conta e volta para a mesma página', async () => {
    const { sessao, router } = renderizarApp('/estoque');
    const u = usuario();
    const menu = await abrirMenuUsuario(u, 'Ana Souza');
    await u.click(within(menu).getByRole('menuitem', { name: 'Trocar de conta' }));
    await u.click(await screen.findByRole('button', { name: 'Oficina do Bairro' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Estoque' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/estoque');
    expect(sessao.obter()?.conta.slug).toBe('oficina');
  });

  it('com uma conta só, o menu não oferece troca', async () => {
    renderizarApp('/', { logado: 'bruno@demo.test' });
    const menu = await abrirMenuUsuario(usuario(), 'Bruno Lima');
    expect(within(menu).queryByRole('menuitem', { name: 'Trocar de conta' })).toBeNull();
  });
});

describe('sessão: refresh e saída', () => {
  it('sair encerra a sessão na API e volta ao login', async () => {
    const { router } = renderizarApp('/contatos');
    const u = usuario();
    const menu = await abrirMenuUsuario(u, 'Ana Souza');
    await u.click(within(menu).getByRole('menuitem', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(simulada.temRefresh()).toBe(false);
    await router.navigate({ to: '/contatos' });
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });

  it('quem entra depois de um "Sair" não vê dados da sessão anterior', async () => {
    renderizarApp('/');
    const u = usuario();
    const menu = await abrirMenuUsuario(u, 'Ana Souza');
    await u.click(within(menu).getByRole('menuitem', { name: 'Sair' }));
    await entrar('bruno@demo.test');
    expect(await screen.findByRole('button', { name: /Bruno Lima/ })).toBeTruthy();
    expect(screen.queryByText('Ana Souza')).toBeNull();
  });

  it('ao sair, os dados da sessão somem do cache já na tela de login', async () => {
    const { queryClient } = renderizarApp('/');
    const u = usuario();
    await abrirMenuUsuario(u, 'Ana Souza');
    expect(queryClient.getQueryData(['eu'])).toBeTruthy();
    await u.click(screen.getByRole('menuitem', { name: 'Sair' }));
    await screen.findByRole('heading', { name: 'Entrar' });
    await waitFor(() => expect(queryClient.getQueryData(['eu'])).toBeUndefined());
  });

  it('401 que chega depois de outra requisição já ter renovado não pede outro refresh', async () => {
    const { sessao, cliente } = criarSessaoECliente();
    await sessao.entrar({ email: 'ana@demo.test', senha: SENHA_DEMO });
    const tokenAntigo = sessao.obter()!.accessToken;
    simulada.expirarAcessos();
    let liberar = () => {};
    const gate = new Promise<void>((resolver) => (liberar = resolver));
    let comTokenAntigo = 0;
    servidor.use(
      http.get(`*${ROTAS_AUTH.eu}`, async ({ request }) => {
        if (request.headers.get('authorization') !== `Bearer ${tokenAntigo}`) return undefined;
        comTokenAntigo += 1;
        // A primeira responde 401 já; a segunda só depois que a primeira renovou.
        if (comTokenAntigo === 2) await gate;
        return HttpResponse.json(criarProblema('nao_autenticado'), { status: 401 });
      }),
    );
    const a = cliente.get(ROTAS_AUTH.eu, { resposta: RespostaEu });
    const b = cliente.get(ROTAS_AUTH.eu, { resposta: RespostaEu });
    await a;
    liberar();
    expect((await b).usuario.nome).toBe('Ana Souza');
    expect(simulada.contagem.refresh).toBe(1);
  });

  it('access token vencido: renova uma vez só e repete as requisições', async () => {
    simulada.jaLogado('ana@demo.test');
    const { sessao, cliente } = criarSessaoECliente();
    await sessao.garantir();
    expect(simulada.contagem.refresh).toBe(1);

    simulada.expirarAcessos();
    const [a, b] = await Promise.all([
      cliente.get(ROTAS_AUTH.eu, { resposta: RespostaEu }),
      cliente.get(ROTAS_AUTH.eu, { resposta: RespostaEu }),
    ]);
    expect([a.usuario.nome, b.usuario.nome]).toEqual(['Ana Souza', 'Ana Souza']);
    expect(simulada.contagem.refresh).toBe(2);
  });

  it('refresh recusado (sessão encerrada em outro lugar) leva ao login', async () => {
    const { queryClient } = renderizarApp('/contatos');
    await screen.findByRole('heading', { level: 1, name: 'Contatos' });
    simulada.expirarAcessos();
    servidor.use(
      http.post(`*${ROTAS_AUTH.refresh}`, () =>
        HttpResponse.json(criarProblema('nao_autenticado'), { status: 401 }),
      ),
    );
    await queryClient.refetchQueries({ queryKey: ['eu'] }).catch(() => undefined);
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });

  it('sem rede ao abrir, mostra "sem conexão" em vez de mandar para o login', async () => {
    servidor.use(http.post(`*${ROTAS_AUTH.refresh}`, () => HttpResponse.error()));
    renderizarApp('/contatos');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível falar com o servidor',
    );
    expect(screen.queryByRole('heading', { name: 'Entrar' })).toBeNull();
  });
});

describe('destinoSeguro', () => {
  it.each([
    [undefined, '/'],
    ['/contatos?busca=a#x', '/contatos?busca=a#x'],
    ['//mal.example', '/'],
    ['/\\mal.example', '/'],
    ['https://mal.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/login', '/'],
    ['/escolher-conta?redirect=/x', '/'],
  ])('%s → %s', (valor, esperado) => {
    expect(destinoSeguro(valor)).toBe(esperado);
  });
});

describe('acessibilidade das telas de entrada (axe)', () => {
  it('login', async () => {
    const { container } = renderizarApp('/', { logado: null });
    await screen.findByRole('heading', { name: 'Entrar' });
    expect(await violacoesA11y(container)).toEqual([]);
  });

  it('escolha de conta', async () => {
    const { container } = renderizarApp('/escolher-conta');
    await screen.findByRole('heading', { name: 'Escolha a conta' });
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    expect(await violacoesA11y(container)).toEqual([]);
  });
});
