import { criarProblema, paginado } from '@ebisu/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { api } from '../api/cliente';
import { violacoesA11y } from '../teste/axe';
import { servidor } from '../teste/servidor';
import { type Coluna, TabelaCursor, usePaginacaoCursor } from './tabela-cursor';

const Contato = z.object({ id: z.string(), nome: z.string() });
type Contato = z.infer<typeof Contato>;
const TODOS = Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, nome: `Contato ${i + 1}` }));

/** API simulada: 2 por página; o cursor é o índice do próximo item; `busca` filtra pelo nome. */
function apiDeContatos() {
  const recebidas: URLSearchParams[] = [];
  servidor.use(
    http.get('*/v1/contatos', ({ request }) => {
      const params = new URL(request.url).searchParams;
      recebidas.push(params);
      const filtrados = TODOS.filter((c) => c.nome.includes(params.get('busca') ?? ''));
      const inicio = Number(params.get('cursor') ?? 0);
      const fim = inicio + Number(params.get('limit'));
      return HttpResponse.json({
        dados: filtrados.slice(inicio, fim),
        proximo_cursor: fim < filtrados.length ? String(fim) : null,
      });
    }),
  );
  return recebidas;
}

const COLUNAS: Coluna<Contato>[] = [
  { id: 'nome', cabecalho: 'Nome', celula: (c) => c.nome },
  { id: 'id', cabecalho: 'Código', celula: (c) => c.id },
];

function ListaDeContatos() {
  const [busca, setBusca] = useState('');
  const paginacao = usePaginacaoCursor({
    chave: ['contatos'],
    filtros: { busca },
    limite: 2,
    buscar: ({ filtros, cursor, limit, signal }) =>
      api.get('/v1/contatos', {
        resposta: paginado(Contato),
        query: { ...filtros, cursor, limit },
        sinal: signal,
      }),
  });
  return (
    <>
      <label>
        Buscar
        <input value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>
      <TabelaCursor
        paginacao={paginacao}
        colunas={COLUNAS}
        rotulo="Contatos"
        chaveLinha={(c) => c.id}
        vazio={{ titulo: 'Nenhum contato' }}
      />
    </>
  );
}

function renderizar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ListaDeContatos />
    </QueryClientProvider>,
  );
}

const nomes = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((linha) => within(linha).getAllByRole('cell')[0]!.textContent);
const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement;
const esperarPagina = async (n: number) => screen.findByText(`Página ${n}`);

describe('TabelaCursor (F12)', () => {
  it('avança com o proximo_cursor e volta pela pilha de cursores', async () => {
    const usuario = userEvent.setup();
    const recebidas = apiDeContatos();
    renderizar();
    await esperarPagina(1);
    expect(nomes()).toEqual(['Contato 1', 'Contato 2']);
    expect(botao('Anterior').disabled).toBe(true);
    expect(recebidas[0]!.get('cursor')).toBeNull();
    expect(recebidas[0]!.get('limit')).toBe('2');

    await usuario.click(botao('Próxima'));
    await esperarPagina(2);
    expect(await screen.findByText('Contato 3')).toBeTruthy();
    expect(nomes()).toEqual(['Contato 3', 'Contato 4']);
    expect(recebidas.at(-1)!.get('cursor')).toBe('2');

    await usuario.click(botao('Próxima'));
    expect(await screen.findByText('Contato 5')).toBeTruthy();
    expect(nomes()).toEqual(['Contato 5']);
    expect(botao('Próxima').disabled).toBe(true);

    await usuario.click(botao('Anterior'));
    await usuario.click(botao('Anterior'));
    await esperarPagina(1);
    expect(nomes()).toEqual(['Contato 1', 'Contato 2']);
    expect(botao('Anterior').disabled).toBe(true);
  });

  it('mudar o filtro volta para a primeira página e envia o filtro sem cursor', async () => {
    const usuario = userEvent.setup();
    const recebidas = apiDeContatos();
    renderizar();
    await esperarPagina(1);
    await usuario.click(botao('Próxima'));
    await esperarPagina(2);

    await usuario.type(screen.getByLabelText('Buscar'), '5');
    expect(await screen.findByText('Contato 5')).toBeTruthy();
    await esperarPagina(1);
    expect(nomes()).toEqual(['Contato 5']);
    const ultima = recebidas.at(-1)!;
    expect([ultima.get('busca'), ultima.get('cursor')]).toEqual(['5', null]);
    expect(botao('Próxima').disabled).toBe(true);
  });

  it('enquanto a próxima página carrega, "Próxima" fica desativada (sem empilhar cursor repetido)', async () => {
    const usuario = userEvent.setup();
    apiDeContatos();
    renderizar();
    await esperarPagina(1);
    let liberar = () => {};
    const gate = new Promise<void>((resolver) => (liberar = resolver));
    servidor.use(
      http.get(
        '*/v1/contatos',
        async () => {
          await gate;
          return HttpResponse.json({ dados: TODOS.slice(2, 4), proximo_cursor: '4' });
        },
        { once: true },
      ),
    );
    await usuario.click(botao('Próxima'));
    // Página 1 continua na tela (sem piscar), mas não dá para avançar de novo.
    expect(nomes()).toEqual(['Contato 1', 'Contato 2']);
    expect(botao('Próxima').disabled).toBe(true);
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    liberar();
    expect(await screen.findByText('Contato 3')).toBeTruthy();
    await esperarPagina(2);
  });

  it('sem registros mostra o estado vazio', async () => {
    servidor.use(
      http.get('*/v1/contatos', () => HttpResponse.json({ dados: [], proximo_cursor: null })),
    );
    renderizar();
    expect(await screen.findByText('Nenhum contato')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('erro mostra a mensagem da API e "Tentar de novo" refaz a busca', async () => {
    const usuario = userEvent.setup();
    apiDeContatos();
    // O handler mais recente tem prioridade: só a primeira busca falha.
    servidor.use(
      http.get(
        '*/v1/contatos',
        () =>
          HttpResponse.json(criarProblema('erro_interno', { request_id: 'r-9' }), { status: 500 }),
        { once: true },
      ),
    );
    renderizar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('r-9');
    expect(screen.queryByRole('button', { name: 'Voltar à página anterior' })).toBeNull();
    await usuario.click(botao('Tentar de novo'));
    await esperarPagina(1);
    expect(nomes()).toEqual(['Contato 1', 'Contato 2']);
  });

  it('erro numa página seguinte permite voltar à anterior', async () => {
    const usuario = userEvent.setup();
    apiDeContatos();
    renderizar();
    await esperarPagina(1);
    servidor.use(
      http.get('*/v1/contatos', () =>
        HttpResponse.json(criarProblema('erro_interno'), { status: 500 }),
      ),
    );
    await usuario.click(botao('Próxima'));
    await screen.findByRole('alert');
    servidor.resetHandlers();
    apiDeContatos();
    await usuario.click(botao('Voltar à página anterior'));
    await esperarPagina(1);
    expect(nomes()).toEqual(['Contato 1', 'Contato 2']);
  });

  it('não tem violações de acessibilidade (axe)', async () => {
    apiDeContatos();
    const { container } = renderizar();
    await esperarPagina(1);
    expect(screen.getByRole('table', { name: 'Contatos' })).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
  });
});
