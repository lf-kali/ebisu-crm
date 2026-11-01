import { criarProblema, ROTAS_CONTATOS } from '@ebisu/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { USUARIOS } from '../simulacao/dados';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { servidor, simulada } from '../teste/servidor';

// Telas de contatos (plano docs/planos/f4-web-1-contatos.md). Ana é dona da conta Ebisu; a
// empresa atual é a Ebisu Centro, semeada com João Araújo, Maria Sá e Pedro Henrique (cliente).

const EMPRESA = USUARIOS[0]!.contas[0]!.empresas[0]!.id;
const usuario = () => userEvent.setup();
const idDe = (nome: string) => simulada.contatos.contatos(EMPRESA).find((k) => k.nome === nome)!.id;
const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const situacao = () => screen.getByRole('table', { name: 'Situação atual por canal e finalidade' });

describe('lista', () => {
  it('mostra os contatos com telefone e origem; o nome abre a ficha; sem violações', async () => {
    const { container, router } = renderizarApp('/contatos');
    const joao = await screen.findByRole('link', { name: 'João Araújo' });
    const linha = joao.closest('tr')!;
    expect(within(linha).getByText('(11) 98765-4321')).toBeTruthy();
    await waitFor(() => expect(within(linha).getByText('Indicação')).toBeTruthy());
    // Maria só tem telefone; Pedro só e-mail e é cliente.
    const pedro = screen.getByRole('link', { name: 'Pedro Henrique' }).closest('tr')!;
    expect(within(pedro).getByText('Cliente')).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
    await usuario().click(joao);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/contatos/${idDe('João Araújo')}`),
    );
  });

  it('busca sem acento, depois da espera e só com 2 caracteres; fica na URL', async () => {
    const { router } = renderizarApp('/contatos');
    await screen.findByRole('link', { name: 'Maria Sá' });
    const u = usuario();
    await u.type(screen.getByLabelText('Buscar'), 'j');
    await pausa(400);
    expect(router.state.location.search).toEqual({});
    await u.type(screen.getByLabelText('Buscar'), 'oao araujo');
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'joao araujo' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Maria Sá' })).toBeNull());
    expect(screen.getByRole('link', { name: 'João Araújo' })).toBeTruthy();
  });

  it('filtros vêm da URL e voltam para ela; sem resultado mostra o estado vazio', async () => {
    const { router } = renderizarApp('/contatos?ciclo=CLIENTE&lixo=1');
    expect(await screen.findByRole('link', { name: 'Pedro Henrique' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'João Araújo' })).toBeNull();
    expect((screen.getByLabelText('Ciclo de vida') as HTMLSelectElement).value).toBe('CLIENTE');
    const origem = screen.getByLabelText('Origem');
    await waitFor(() =>
      expect(within(origem).getByRole('option', { name: 'Instagram' })).toBeTruthy(),
    );
    await usuario().selectOptions(origem, 'Instagram');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        ciclo: 'CLIENTE',
        origem: expect.any(String),
      }),
    );
    expect(await screen.findByText('Nenhum contato encontrado')).toBeTruthy();
  });

  it('erro da API na lista aparece com "tentar de novo"', async () => {
    servidor.use(
      http.get(`*${ROTAS_CONTATOS.contatos}`, () =>
        HttpResponse.json(criarProblema('erro_interno'), { status: 500 }),
      ),
    );
    renderizarApp('/contatos');
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('quem só lê não vê "Novo contato", nem Editar, Excluir e Registrar na ficha', async () => {
    simulada.definirPermissoes('ana@demo.test', { 'contato.read': 'EMPRESA' });
    renderizarApp(`/contatos/${idDe('João Araújo')}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'João Araújo' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar consentimento' })).toBeNull();
    await usuario().click(within(screen.getByRole('main')).getByRole('link', { name: 'Contatos' }));
    await screen.findByRole('heading', { level: 1, name: 'Contatos' });
    expect(screen.queryByRole('link', { name: 'Novo contato' })).toBeNull();
  });
});

describe('formulário', () => {
  async function preencherNovo(u: ReturnType<typeof usuario>, campos: Record<string, string>) {
    for (const [rotulo, valor] of Object.entries(campos))
      await u.type(screen.getByLabelText(rotulo), valor);
  }
  const criar = (u: ReturnType<typeof usuario>) =>
    u.click(screen.getByRole('button', { name: 'Criar contato' }));

  it('cria com origem e responsável e abre a ficha; sem violações', async () => {
    const { container } = renderizarApp('/contatos/novo');
    await screen.findByRole('heading', { level: 1, name: 'Novo contato' });
    expect(await violacoesA11y(container)).toEqual([]);
    const u = usuario();
    await preencherNovo(u, {
      Nome: 'Carla Mendes',
      'E-mail': 'carla@cliente.test',
      Telefone: '(11) 91234-5678',
    });
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Origem')).getByRole('option', { name: 'Site' }),
      ).toBeTruthy(),
    );
    await u.selectOptions(screen.getByLabelText('Origem'), 'Site');
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Responsável')).getByRole('option', { name: 'Bruno Lima' }),
      ).toBeTruthy(),
    );
    await u.selectOptions(screen.getByLabelText('Responsável'), 'Bruno Lima');
    await criar(u);
    expect(await screen.findByRole('heading', { level: 1, name: 'Carla Mendes' })).toBeTruthy();
    expect(screen.getByText('(11) 91234-5678')).toBeTruthy();
    expect(await screen.findByText('Site')).toBeTruthy();
    expect(await screen.findByText('Bruno Lima')).toBeTruthy();
  });

  it('sem nenhum meio de contato, avisa no campo e não chama a API', async () => {
    renderizarApp('/contatos/novo');
    await screen.findByRole('heading', { level: 1, name: 'Novo contato' });
    const u = usuario();
    await preencherNovo(u, { Nome: 'Sem Meio' });
    const antes = simulada.contatos.contatos(EMPRESA).length;
    await criar(u);
    expect(await screen.findByText('Informe e-mail, telefone ou WhatsApp.')).toBeTruthy();
    expect(simulada.contatos.contatos(EMPRESA)).toHaveLength(antes);
  });

  it('telefone repetido: mensagem no campo e link para o contato que já existe', async () => {
    renderizarApp('/contatos/novo');
    await screen.findByRole('heading', { level: 1, name: 'Novo contato' });
    const u = usuario();
    await preencherNovo(u, { Nome: 'Outro João', Telefone: '11987654321' });
    await criar(u);
    expect(await screen.findByText('Já existe um contato com este telefone.')).toBeTruthy();
    expect(screen.getByLabelText('Telefone').getAttribute('aria-invalid')).toBe('true');
    await u.click(screen.getByRole('link', { name: 'Abrir contato existente' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'João Araújo' })).toBeTruthy();
  });

  it('duplicado sem id (contato de outra pessoa): só a mensagem, sem link', async () => {
    servidor.use(
      http.post(`*${ROTAS_CONTATOS.contatos}`, () =>
        HttpResponse.json(criarProblema('duplicado', { extras: { campo: 'email' } }), {
          status: 409,
        }),
      ),
    );
    renderizarApp('/contatos/novo');
    await screen.findByRole('heading', { level: 1, name: 'Novo contato' });
    const u = usuario();
    await preencherNovo(u, { Nome: 'Cópia', 'E-mail': 'alguem@cliente.test' });
    await criar(u);
    expect(await screen.findByText('Já existe um contato com este e-mail.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Abrir contato existente' })).toBeNull();
  });

  it('422 da API cai no campo (telefone que a API não aceita)', async () => {
    renderizarApp('/contatos/novo');
    await screen.findByRole('heading', { level: 1, name: 'Novo contato' });
    const u = usuario();
    await preencherNovo(u, { Nome: 'Fone Ruim', Telefone: '123456789' });
    await criar(u);
    expect(await screen.findByText('Telefone inválido.')).toBeTruthy();
    expect(screen.getByLabelText('Telefone').getAttribute('aria-invalid')).toBe('true');
  });

  it('PROPRIO não escolhe responsável: a API grava a própria pessoa', async () => {
    simulada.definirPermissoes('ana@demo.test', {
      'contato.read': 'PROPRIO',
      'contato.create': 'PROPRIO',
    });
    renderizarApp('/contatos/novo');
    await screen.findByRole('heading', { level: 1, name: 'Novo contato' });
    await waitFor(() =>
      expect(within(screen.getByLabelText('Origem')).getAllByRole('option').length).toBeGreaterThan(
        1,
      ),
    );
    expect(screen.queryByLabelText('Responsável')).toBeNull();
    const u = usuario();
    await preencherNovo(u, { Nome: 'Lead Próprio', 'E-mail': 'proprio@cliente.test' });
    await criar(u);
    expect(await screen.findByRole('heading', { level: 1, name: 'Lead Próprio' })).toBeTruthy();
    const responsavel = () => screen.getByText('Responsável').nextElementSibling!.textContent;
    await waitFor(() => expect(responsavel()).toBe('Ana Souza'));
  });

  it('editar manda só o que mudou; esvaziar um campo manda null', async () => {
    const corpos: unknown[] = [];
    servidor.use(
      http.patch(`*${ROTAS_CONTATOS.contatos}/:id`, async ({ request }) => {
        corpos.push(await request.clone().json());
        // Sem resposta: segue para o handler da simulação.
      }),
    );
    renderizarApp(`/contatos/${idDe('João Araújo')}/editar`);
    const nome = await screen.findByLabelText('Nome');
    const u = usuario();
    await u.clear(nome);
    await u.type(nome, 'João A. Araújo');
    await u.clear(screen.getByLabelText('E-mail'));
    await u.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'João A. Araújo' })).toBeTruthy();
    expect(corpos).toEqual([{ nome: 'João A. Araújo', email: null }]);
    const email = screen
      .getAllByText('E-mail')
      .find((el) => el.tagName === 'DT')!.nextElementSibling!;
    expect(email.textContent).toBe('—');
  });
});

describe('ficha', () => {
  it('consentimento: concede, revoga, a situação acompanha e o histórico guarda os dois', async () => {
    const { container } = renderizarApp(`/contatos/${idDe('Maria Sá')}`);
    await screen.findByRole('heading', { level: 1, name: 'Maria Sá' });
    const whatsapp = () => within(situacao()).getByRole('row', { name: /WhatsApp/ });
    expect(within(whatsapp()).getAllByText('Sem registro')).toHaveLength(2);
    expect(await screen.findByText('Nenhum consentimento registrado.')).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);

    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Registrar consentimento' }));
    let janela = await screen.findByRole('dialog');
    await u.click(within(janela).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(within(whatsapp()).getByText('Concedido')).toBeTruthy());

    await u.click(screen.getByRole('button', { name: 'Registrar consentimento' }));
    janela = await screen.findByRole('dialog');
    await u.selectOptions(within(janela).getByLabelText('Situação'), 'Revogado');
    await u.click(within(janela).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(within(whatsapp()).getByText('Revogado')).toBeTruthy());
    const historico = await screen.findByRole('table', { name: 'Histórico de consentimentos' });
    await waitFor(() => expect(within(historico).getAllByRole('row')).toHaveLength(3));
    // Do mais recente ao mais antigo.
    const [, primeiro, segundo] = within(historico).getAllByRole('row');
    expect(primeiro!.textContent).toContain('Revogado');
    expect(segundo!.textContent).toContain('Concedido');
  });

  it('excluir pede confirmação e volta para a lista, já sem o contato', async () => {
    const { router } = renderizarApp(`/contatos/${idDe('Pedro Henrique')}`);
    await screen.findByRole('heading', { level: 1, name: 'Pedro Henrique' });
    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Excluir' }));
    await u.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/contatos'));
    expect(await screen.findByRole('link', { name: 'João Araújo' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Pedro Henrique' })).toBeNull();
  });

  it('contato que não existe (ou de outra empresa) mostra o erro, não uma tela quebrada', async () => {
    renderizarApp('/contatos/0190a000-0000-7000-8000-00000000dead');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
