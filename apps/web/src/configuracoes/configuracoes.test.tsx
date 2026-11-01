import { criarProblema, ROTAS_EMPRESAS } from '@ebisu/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CONTAS, USUARIOS } from '../simulacao/dados';
import { podeVerSecao, SECOES } from './secoes';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { servidor, simulada } from '../teste/servidor';

// Telas de Configurações (plano docs/planos/f3-web-2-configuracoes.md). Ana é dona da conta Ebisu
// (empresas Centro e Shopping); Bruno é técnico, sem nenhuma permissão de configuração.

const usuario = () => userEvent.setup();
const linhaCom = (texto: string) => screen.getByRole('row', { name: new RegExp(texto) });
const linhaComEspera = (link: HTMLElement) => link.closest('tr');
const dialogo = () => screen.findByRole('dialog');
const confirmar = async (u: ReturnType<typeof usuario>, rotulo: string) =>
  u.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: rotulo }));

describe('índice e acesso', () => {
  it('a dona vê as três seções; cada cartão leva à sua página', async () => {
    const { container, router } = renderizarApp('/configuracoes');
    expect(await screen.findByRole('heading', { level: 1, name: 'Configurações' })).toBeTruthy();
    const secoes = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(secoes).toEqual(['Empresas', 'Membros e convites', 'API keys']);
    expect(await violacoesA11y(container)).toEqual([]);
    await usuario().click(screen.getByRole('link', { name: /API keys/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/configuracoes/api-keys'));
  });

  it('seções da conta só com TENANT; API keys com qualquer escopo na empresa', () => {
    const [empresas, membros, chaves] = SECOES;
    const com = (escopo: string) => () => escopo;
    expect(podeVerSecao(empresas!, com('EMPRESA'))).toBe(false);
    expect(podeVerSecao(membros!, com('PROPRIO'))).toBe(false);
    expect(podeVerSecao(membros!, com('TENANT'))).toBe(true);
    expect(podeVerSecao(chaves!, com('EMPRESA'))).toBe(true);
    expect(podeVerSecao(chaves!, () => undefined)).toBe(false);
  });

  it('o técnico não vê Configurações no menu, e a URL direta mostra "sem acesso"', async () => {
    renderizarApp('/configuracoes/membros', { logado: 'bruno@demo.test' });
    expect(await screen.findByText('Sem acesso a este módulo')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Configurações' })).toBeNull();
  });

  it('a API negando (403) aparece como sem permissão, não como página quebrada', async () => {
    servidor.use(
      http.get(`*${ROTAS_EMPRESAS.empresas}`, () =>
        HttpResponse.json(criarProblema('sem_permissao'), { status: 403 }),
      ),
    );
    renderizarApp('/configuracoes/empresas');
    expect((await screen.findByRole('alert')).textContent).toMatch(/permissão/i);
  });
});

describe('empresas', () => {
  it('cria uma empresa com CNPJ; ela aparece na lista e no seletor de empresa', async () => {
    const { container } = renderizarApp('/configuracoes/empresas');
    expect(await screen.findByRole('cell', { name: 'Ebisu Centro' })).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Nova empresa' }));
    const janela = await dialogo();
    await u.type(within(janela).getByLabelText('Nome fantasia'), 'Ebisu Norte');
    await u.type(within(janela).getByLabelText('Razão social'), 'Ebisu Norte Ltda');
    await u.type(within(janela).getByLabelText('CNPJ (opcional)'), '11.222.333/0001-81');
    await u.click(within(janela).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('cell', { name: 'Ebisu Norte' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '11.222.333/0001-81' })).toBeTruthy();

    await u.click(await screen.findByRole('button', { name: /^Empresa:/ }));
    expect(await screen.findByRole('menuitemradio', { name: 'Ebisu Norte' })).toBeTruthy();
  });

  it('CNPJ repetido na conta aparece no campo', async () => {
    renderizarApp('/configuracoes/empresas');
    const u = usuario();
    for (const nome of ['Primeira', 'Segunda']) {
      await u.click(await screen.findByRole('button', { name: 'Nova empresa' }));
      const janela = await dialogo();
      await u.type(within(janela).getByLabelText('Nome fantasia'), nome);
      await u.type(within(janela).getByLabelText('Razão social'), `${nome} Ltda`);
      await u.type(within(janela).getByLabelText('CNPJ (opcional)'), '11222333000181');
      await u.click(within(janela).getByRole('button', { name: 'Salvar' }));
    }
    expect(await screen.findByText('Já existe uma empresa com este CNPJ na conta.')).toBeTruthy();
  });

  it('desativa com confirmação; a última empresa ativa não sai (409)', async () => {
    renderizarApp('/configuracoes/empresas');
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Desativar Ebisu Shopping' }));
    await confirmar(u, 'Desativar');
    await waitFor(() =>
      expect(within(linhaCom('Ebisu Shopping')).getByText('Inativa')).toBeTruthy(),
    );
    await u.click(screen.getByRole('button', { name: 'Desativar Ebisu Centro' }));
    await confirmar(u, 'Desativar');
    expect(await screen.findByText('A conta precisa de ao menos uma empresa ativa.')).toBeTruthy();
  });
});

describe('membros e convites', () => {
  it('lista os membros com papéis; convida pelo diálogo e o convite aparece nos pendentes', async () => {
    const { container } = renderizarApp('/configuracoes/membros');
    expect(await screen.findByRole('link', { name: 'Bruno Lima' })).toBeTruthy();
    expect(linhaCom('Ana Souza').textContent).toContain('Proprietário (todas)');
    expect(await screen.findByText('Nenhum convite pendente')).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);

    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Convidar' }));
    const janela = await dialogo();
    await u.type(within(janela).getByLabelText('E-mail'), 'nova@loja.test');
    expect((within(janela).getByLabelText('Papel 1') as HTMLSelectElement).value).toBeTruthy();
    await u.click(within(janela).getByRole('button', { name: 'Enviar convite' }));
    expect(await screen.findByRole('cell', { name: 'nova@loja.test' })).toBeTruthy();
    expect(linhaCom('nova@loja.test').textContent).toContain('Atendente');
  });

  it('e-mail inválido é recusado antes da API; quem já é membro recebe a mensagem da API', async () => {
    renderizarApp('/configuracoes/membros');
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Convidar' }));
    const janela = await dialogo();
    const email = within(janela).getByLabelText('E-mail');
    await u.type(email, 'nao-e-email');
    await u.click(within(janela).getByRole('button', { name: 'Enviar convite' }));
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    await u.clear(email);
    await u.type(email, 'bruno@demo.test');
    await u.click(within(janela).getByRole('button', { name: 'Enviar convite' }));
    expect(await within(janela).findByText('Esta pessoa já é membro da conta.')).toBeTruthy();
  });

  it('reenvia e revoga um convite pendente', async () => {
    renderizarApp('/configuracoes/membros');
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Convidar' }));
    const janela = await dialogo();
    await u.type(within(janela).getByLabelText('E-mail'), 'temp@loja.test');
    await u.click(within(janela).getByRole('button', { name: 'Enviar convite' }));
    await u.click(
      await screen.findByRole('button', { name: 'Reenviar convite para temp@loja.test' }),
    );
    expect(await screen.findByText(/Convite reenviado/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Revogar convite para temp@loja.test' }));
    await confirmar(u, 'Revogar');
    expect(await screen.findByText('Nenhum convite pendente')).toBeTruthy();
  });

  it('o papel de dono só vale em todas as empresas', async () => {
    renderizarApp('/configuracoes/membros');
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Convidar' }));
    const janela = await dialogo();
    const papel = within(janela).getByLabelText('Papel 1') as HTMLSelectElement;
    const empresa = within(janela).getByLabelText('Empresa do papel 1') as HTMLSelectElement;
    expect(empresa.disabled).toBe(false);
    await u.selectOptions(papel, 'Proprietário');
    expect(empresa.disabled).toBe(true);
    expect(empresa.value).toBe('');
    expect(empresa.selectedOptions[0]!.textContent).toBe('Todas as empresas');
  });
});

describe('página do membro', () => {
  /** Membro da conta Ebisu (o id é fixo nos dados da demonstração). */
  const idDe = (email: string) =>
    USUARIOS.find((u) => u.email === email)!.contas.find(
      (c) => c.conta.tenant_id === CONTAS.ebisu.tenant_id,
    )!.membroId;

  it('troca os papéis do técnico e o suspende com confirmação', async () => {
    const { container } = renderizarApp(`/configuracoes/membros/${idDe('bruno@demo.test')}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bruno Lima' })).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
    const u = usuario();
    await u.selectOptions(await screen.findByLabelText('Papel 1'), 'Atendente');
    await u.selectOptions(screen.getByLabelText('Empresa do papel 1'), 'Ebisu Shopping');
    await u.click(screen.getByRole('button', { name: 'Salvar papéis' }));
    expect(await screen.findByText(/Papéis salvos/)).toBeTruthy();
    const bruno = simulada.configuracoes
      .conta(CONTAS.ebisu.tenant_id)
      .membros.find((m) => m.id === idDe('bruno@demo.test'))!;
    expect(bruno.atribuicoes.map((a) => a.papel.chave)).toEqual(['ATENDENTE']);

    await u.click(screen.getByRole('button', { name: 'Suspender' }));
    await confirmar(u, 'Suspender');
    expect(await screen.findByRole('button', { name: 'Reativar' })).toBeTruthy();
  });

  it('depois de editar o membro, a lista já mostra o cargo, os papéis e a situação novos', async () => {
    renderizarApp('/configuracoes/membros');
    const u = usuario();
    // A lista carrega antes (fica no cache): a edição precisa invalidá-la.
    expect(linhaComEspera(await screen.findByRole('link', { name: 'Bruno Lima' }))).toBeTruthy();
    await u.click(screen.getByRole('link', { name: 'Bruno Lima' }));
    await u.type(await screen.findByLabelText('Cargo (opcional)'), 'Técnico líder');
    await u.click(screen.getByRole('button', { name: 'Salvar cargo' }));
    expect(await screen.findByText('Cargo salvo.')).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Papel 1'), 'Atendente');
    await u.click(screen.getByRole('button', { name: 'Salvar papéis' }));
    expect(await screen.findByText(/Papéis salvos/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Suspender' }));
    await confirmar(u, 'Suspender');
    expect(await screen.findByRole('button', { name: 'Reativar' })).toBeTruthy();

    await u.click(screen.getByRole('link', { name: 'Membros e convites' }));
    await waitFor(() => {
      const linha = linhaCom('Bruno Lima').textContent;
      expect(linha).toContain('Técnico líder');
      expect(linha).toContain('Atendente');
      expect(linha).toContain('Suspenso');
    });
  });

  it('na própria página não há botão de suspender; tirar o próprio dono mostra a regra da API', async () => {
    renderizarApp(`/configuracoes/membros/${idDe('ana@demo.test')}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ana Souza' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Suspender' })).toBeNull();
    const u = usuario();
    await u.selectOptions(await screen.findByLabelText('Papel 1'), 'Atendente');
    await u.click(screen.getByRole('button', { name: 'Salvar papéis' }));
    expect(await screen.findByText('A conta precisa de um dono ativo.')).toBeTruthy();
  });
});

describe('API keys', () => {
  it('cria uma chave de servidor; o token aparece uma vez e some ao fechar', async () => {
    const { container, queryClient } = renderizarApp('/configuracoes/api-keys');
    expect(await screen.findByText('Nenhuma API key')).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
    const u = usuario();
    await u.click(screen.getByRole('button', { name: 'Nova chave' }));
    const janela = await dialogo();
    await u.type(within(janela).getByLabelText('Nome'), 'n8n');
    // Só o que a pessoa pode dar: sem config.* e sem o que ela só tem nos próprios registros.
    expect(within(janela).queryByRole('checkbox', { name: 'config.api_keys' })).toBeNull();
    expect(within(janela).queryByRole('checkbox', { name: 'tarefa.update' })).toBeNull();
    await u.click(within(janela).getByRole('checkbox', { name: 'contato.read' }));
    await u.click(within(janela).getByRole('button', { name: 'Criar chave' }));

    const token = (await screen.findByLabelText('Chave (cabeçalho X-Api-Key)')) as HTMLInputElement;
    expect(token.value).toMatch(/^ebk_live_/);
    const segredo = token.value;
    await u.click(screen.getByRole('button', { name: 'Já copiei' }));
    expect(await screen.findByRole('cell', { name: 'n8n' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(segredo);
    await waitFor(() => {
      const caches = JSON.stringify([
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => m.state.data),
      ]);
      expect(caches).not.toContain(segredo);
    });
    expect(linhaCom('n8n').textContent).toContain(segredo.slice(0, 17));
  });

  it('chave de site com as origens; revogar com confirmação', async () => {
    renderizarApp('/configuracoes/api-keys');
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Nova chave' }));
    const janela = await dialogo();
    await u.selectOptions(within(janela).getByLabelText('Tipo'), 'NAVEGADOR');
    await u.type(within(janela).getByLabelText('Nome'), 'Site');
    await u.type(
      within(janela).getByLabelText('Endereços do site (um por linha)'),
      'https://www.ebisu.test',
    );
    await u.click(within(janela).getByRole('button', { name: 'Criar chave' }));
    await u.click(await screen.findByRole('button', { name: 'Já copiei' }));
    expect(linhaCom('Site').textContent).toContain('Captura de lead em https://www.ebisu.test');
    await u.click(screen.getByRole('button', { name: 'Revogar Site' }));
    await confirmar(u, 'Revogar');
    await waitFor(() => expect(within(linhaCom('Site')).getByText('Revogada')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Editar Site' })).toBeNull();
  });

  it('escopo que a API recusa aparece no diálogo', async () => {
    servidor.use(
      http.post('*/v1/api-keys', () =>
        HttpResponse.json(
          criarProblema('validacao', {
            campos: [{ campo: 'escopos', code: 'custom', mensagem: 'Escopo não permitido' }],
          }),
          { status: 422 },
        ),
      ),
    );
    renderizarApp('/configuracoes/api-keys');
    const u = usuario();
    await u.click(await screen.findByRole('button', { name: 'Nova chave' }));
    const janela = await dialogo();
    await u.type(within(janela).getByLabelText('Nome'), 'x');
    await u.click(within(janela).getByRole('button', { name: 'Criar chave' }));
    expect(await within(janela).findByRole('alert')).toBeTruthy();
  });
});
