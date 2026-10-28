import { criarProblema } from '@ebisu/contracts';
import { Carregando, EstadoVazio } from '@ebisu/ui/components/estados';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { violacoesA11y } from '../teste/axe';
import { ErroDaApi } from './erro-da-api';

describe('estados vazio/erro/carregando (F12)', () => {
  afterEach(cleanup);

  it('erro da API mostra a mensagem do catálogo, o detalhe e o código para o suporte', () => {
    const problema = criarProblema('conflito_versao', {
      detail: 'Outra pessoa editou a OS.',
      request_id: 'req-42',
    });
    render(<ErroDaApi erro={problema} />);
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain(
      'O registro foi alterado por outra pessoa. Recarregue e tente de novo.',
    );
    expect(alerta.textContent).toContain('Outra pessoa editou a OS.');
    expect(alerta.textContent).toContain('req-42');
  });

  it('erro sem envelope válido (rede/servidor fora) mostra mensagem de conexão', () => {
    render(<ErroDaApi erro={undefined} />);
    expect(screen.getByRole('alert').textContent).toContain(
      'Não foi possível falar com o servidor',
    );
  });

  it('carregando é anunciado como status; vazio mostra título e descrição', () => {
    render(
      <>
        <Carregando />
        <EstadoVazio titulo="Nenhum contato ainda" descricao="Capture o primeiro lead." />
      </>,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando…');
    expect(screen.getByText('Nenhum contato ainda')).toBeTruthy();
  });

  it('não tem violações de acessibilidade (axe)', async () => {
    const { container } = render(
      <>
        <Carregando />
        <EstadoVazio titulo="Vazio" />
        <ErroDaApi erro={criarProblema('erro_interno', { request_id: 'r1' })} />
      </>,
    );
    expect(await violacoesA11y(container)).toEqual([]);
  });
});
