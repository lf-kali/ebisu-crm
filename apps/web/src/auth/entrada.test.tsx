import { criarProblema, ROTAS_AUTH, ROTAS_CONVITES } from '@ebisu/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { quandoTentarDeNovo } from '../componentes/entrada';
import { MENSAGEM_SENHA_FRACA } from '../simulacao/api-simulada';
import { SENHA_DEMO } from '../simulacao/dados';
import { criarSessaoECliente } from '../router';
import { CONTAS } from '../simulacao/dados';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { servidor, simulada } from '../teste/servidor';

// Cadastro e aceite do convite (plano docs/planos/f3-web-1-cadastro-convite.md).

const SENHA_BOA = 'cavalo-bateria-grampo-42';
const usuario = () => userEvent.setup();

async function preencherCadastro(dados: Partial<Record<string, string>> = {}) {
  const u = usuario();
  const valores = {
    'Seu nome': 'Marina Duarte',
    'E-mail': 'marina@nova.test',
    Senha: SENHA_BOA,
    'Nome da conta': 'Assistência Duarte',
    'Razão social': 'Duarte Assistência Técnica Ltda',
    'Nome fantasia': 'Duarte Centro',
    ...dados,
  };
  for (const [rotulo, valor] of Object.entries(valores))
    if (valor) await u.type(await screen.findByLabelText(rotulo), valor);
  await u.click(screen.getByRole('button', { name: 'Criar conta' }));
  return u;
}

describe('cadastro', () => {
  it('cria a conta e entra no Painel, com a conta nova no menu do usuário', async () => {
    const { router, container } = renderizarApp('/cadastro', { logado: null });
    expect(await screen.findByRole('heading', { name: 'Criar conta' })).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
    await preencherCadastro();
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: /Marina Duarte/ })).toBeTruthy();
  });

  it('a regra da senha aparece antes do envio, ligada ao campo', async () => {
    renderizarApp('/cadastro', { logado: null });
    const senha = await screen.findByLabelText('Senha');
    const descricao = (senha.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(descricao).toContain('De 12 a 128 caracteres');
  });

  it('senha fraca (422 da API) aparece no campo senha', async () => {
    renderizarApp('/cadastro', { logado: null });
    await preencherCadastro({ Senha: 'marina-duarte-2026' });
    expect(await screen.findByText(MENSAGEM_SENHA_FRACA)).toBeTruthy();
    expect(screen.getByLabelText('Senha').getAttribute('aria-invalid')).toBe('true');
  });

  it('e-mail já cadastrado com outra senha: explica e oferece o login', async () => {
    renderizarApp('/cadastro', { logado: null });
    await preencherCadastro({ 'E-mail': 'ana@demo.test' });
    const alerta = await screen.findByText(/Este e-mail já tem cadastro/);
    expect(alerta.querySelector('a')?.getAttribute('href')).toBe('/login');
  });

  it('CNPJ vazio não vai para a API; inválido é recusado no navegador', async () => {
    let corpo: unknown;
    servidor.use(
      http.post(`*${ROTAS_AUTH.registrar}`, async ({ request }) => {
        corpo = await request.json();
        return HttpResponse.json(criarProblema('erro_interno'), { status: 500 });
      }),
    );
    renderizarApp('/cadastro', { logado: null });
    const u = await preencherCadastro();
    await waitFor(() => expect(corpo).toBeDefined());
    expect((corpo as { empresa: object }).empresa).not.toHaveProperty('cnpj');

    corpo = undefined;
    await u.type(screen.getByLabelText('CNPJ (opcional)'), '11.111.111/1111-11');
    await u.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('CNPJ inválido')).toBeTruthy();
    expect(corpo).toBeUndefined();
  });

  it('429 diz quando tentar de novo (Retry-After)', async () => {
    servidor.use(
      http.post(`*${ROTAS_AUTH.registrar}`, () =>
        HttpResponse.json(criarProblema('limite_excedido'), {
          status: 429,
          headers: { 'Retry-After': '1800' },
        }),
      ),
    );
    renderizarApp('/cadastro', { logado: null });
    await preencherCadastro();
    expect(await screen.findByText(/Tente de novo em 30 minutos/)).toBeTruthy();
    expect(quandoTentarDeNovo(null)).toBe('Tente de novo daqui a pouco.');
    expect(quandoTentarDeNovo(30)).toBe('Tente de novo em 1 minuto.');
  });

  it('login e cadastro apontam um para o outro', async () => {
    const u = usuario();
    const { router } = renderizarApp('/login', { logado: null });
    await u.click(await screen.findByRole('link', { name: 'Criar conta' }));
    expect(await screen.findByRole('heading', { name: 'Criar conta' })).toBeTruthy();
    await u.click(screen.getByRole('link', { name: 'Entrar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('quem já tem sessão e abre o cadastro vai para o Painel', async () => {
    renderizarApp('/cadastro');
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy();
  });
});

describe('aceite do convite', () => {
  const abrirConvite = (token: string) =>
    renderizarApp(`/convite#token=${token}`, { logado: null });

  it('e-mail novo cria o acesso e entra na conta que convidou; o token some da URL', async () => {
    const token = simulada.criarConvite('caio@novo.test', 'CRIAR_ACESSO');
    const { router, container } = abrirConvite(token);
    expect(
      await screen.findByRole('heading', { name: 'Convite de Oficina do Bairro' }),
    ).toBeTruthy();
    expect(screen.getByText('caio@novo.test')).toBeTruthy();
    expect(router.state.location.hash).toBe('');
    expect(router.state.location.href).not.toContain(token);
    expect(await violacoesA11y(container)).toEqual([]);

    const u = usuario();
    await u.type(screen.getByLabelText('Seu nome'), 'Caio Prado');
    await u.type(screen.getByLabelText('Crie uma senha'), SENHA_BOA);
    await u.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Caio Prado/ })).toBeTruthy();
  });

  it('quem já tem acesso confirma com a senha atual; senha errada avisa', async () => {
    const token = simulada.criarConvite('bruno@demo.test', 'SENHA_ATUAL');
    abrirConvite(token);
    const senha = await screen.findByLabelText('Sua senha');
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    const u = usuario();
    await u.type(senha, 'senha-errada');
    await u.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(await screen.findByText('Senha incorreta.')).toBeTruthy();
    await u.clear(senha);
    await u.type(senha, SENHA_DEMO);
    await u.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy();
  });

  it('e-mail não confirmado define senha nova e é avisado sobre as outras sessões', async () => {
    const token = simulada.criarConvite('dora@pendente.test', 'NOVA_SENHA');
    abrirConvite(token);
    expect(await screen.findByLabelText('Nova senha')).toBeTruthy();
    expect(
      screen.getByText(/outras sessões abertas com este e-mail serão encerradas/),
    ).toBeTruthy();
  });

  it('convite vencido, usado ou cancelado (410): "não vale mais"', async () => {
    abrirConvite('x'.repeat(43));
    expect(await screen.findByText('Este convite não vale mais')).toBeTruthy();
  });

  it('o mesmo link de novo, depois de usado, também não vale mais', async () => {
    const token = simulada.criarConvite('eva@novo.test', 'CRIAR_ACESSO');
    const primeiro = abrirConvite(token);
    const u = usuario();
    await u.type(await screen.findByLabelText('Seu nome'), 'Eva Lins');
    await u.type(screen.getByLabelText('Crie uma senha'), SENHA_BOA);
    await u.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeTruthy();
    primeiro.unmount();
    abrirConvite(token);
    expect(await screen.findByText('Este convite não vale mais')).toBeTruthy();
  });

  it('já membro (409): avisa e oferece o login', async () => {
    servidor.use(
      http.post(`*${ROTAS_CONVITES.aceitar}`, () =>
        HttpResponse.json(criarProblema('duplicado'), { status: 409 }),
      ),
    );
    const token = simulada.criarConvite('fabio@novo.test', 'CRIAR_ACESSO');
    abrirConvite(token);
    const u = usuario();
    await u.type(await screen.findByLabelText('Seu nome'), 'Fábio');
    await u.type(screen.getByLabelText('Crie uma senha'), SENHA_BOA);
    await u.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(await screen.findByText(/Você já é membro desta conta/)).toBeTruthy();
  });

  it('sem token na URL (ex.: página recarregada): pede para abrir o link de novo, sem chamar a API', async () => {
    let consultas = 0;
    servidor.use(
      http.post(`*${ROTAS_CONVITES.consultar}`, () => {
        consultas += 1;
        return HttpResponse.json(criarProblema('link_invalido'), { status: 410 });
      }),
    );
    renderizarApp('/convite', { logado: null });
    expect(await screen.findByText('Abra de novo o link do e-mail')).toBeTruthy();
    // Dá tempo de uma consulta indevida sair antes de conferir.
    await new Promise((r) => setTimeout(r, 50));
    expect(consultas).toBe(0);
  });

  it('senha curta para acesso novo é recusada no navegador', async () => {
    const token = simulada.criarConvite('gil@novo.test', 'CRIAR_ACESSO');
    abrirConvite(token);
    const u = usuario();
    await u.type(await screen.findByLabelText('Seu nome'), 'Gil');
    await u.type(screen.getByLabelText('Crie uma senha'), 'curta');
    await u.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    const senha = screen.getByLabelText('Crie uma senha');
    await waitFor(() => expect(senha.getAttribute('aria-invalid')).toBe('true'));
  });
});

describe('sessão aberta pelo cadastro e pelo aceite', () => {
  it.each(['registrar', 'aceitarConvite'] as const)(
    '%s: refresh da sessão anterior que chega depois não a reinstala',
    async (metodo) => {
      simulada.jaLogado('ana@demo.test');
      const { sessao } = criarSessaoECliente();
      await sessao.garantir();
      let liberar = () => {};
      const gate = new Promise<void>((resolver) => (liberar = resolver));
      servidor.use(
        http.post(
          `*${ROTAS_AUTH.refresh}`,
          async () => {
            await gate;
            return HttpResponse.json({
              access_token: 'sim-atrasado',
              token_type: 'Bearer',
              expira_em: 900,
              conta: CONTAS.ebisu,
              contas: [CONTAS.ebisu],
            });
          },
          { once: true },
        ),
      );
      const renovacao = sessao.renovar();
      const nova =
        metodo === 'registrar'
          ? await sessao.registrar({
              nome: 'Helena Reis',
              email: 'helena@nova.test',
              senha: SENHA_BOA,
              conta: { nome: 'Reis Celulares' },
              empresa: { razao_social: 'Reis Ltda', nome_fantasia: 'Reis' },
            })
          : await sessao.aceitarConvite({
              token: simulada.criarConvite('ivo@novo.test', 'CRIAR_ACESSO'),
              nome: 'Ivo',
              senha: SENHA_BOA,
            });
      liberar();
      await renovacao;
      expect(sessao.obter()?.accessToken).toBe(nova.accessToken);
      expect(sessao.obter()?.accessToken).not.toBe('sim-atrasado');
    },
  );
});
