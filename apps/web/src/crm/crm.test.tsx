import type { Atividade } from '@ebisu/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { USUARIOS } from '../simulacao/dados';
import { renderizarApp } from '../teste/app';
import { violacoesA11y } from '../teste/axe';
import { simulada } from '../teste/servidor';

// Tarefas, timeline e negócios na ficha do contato (plano docs/planos/f4-web-2-negocios.md,
// decisões 5 a 7). João Araújo tem o negócio "Troca de tela".

const ANA = USUARIOS[0]!.contas[0]!;
const EMPRESA = ANA.empresas[0]!.id;
const BRUNO = USUARIOS[1]!.contas[0]!.membroId;
const usuario = () => userEvent.setup();
const joao = () => simulada.contatos.contatos(EMPRESA).find((k) => k.nome === 'João Araújo')!;
const secao = (nome: string) => screen.findByRole('region', { name: nome });

function atividade(dados: Partial<Atividade>): Atividade {
  return {
    id: crypto.randomUUID(),
    empresa_id: EMPRESA,
    contato_id: joao().id,
    negocio_id: null,
    tipo: 'LIGACAO',
    direcao: 'SAIDA',
    assunto: null,
    conteudo: null,
    resultado: null,
    membro_id: ANA.membroId,
    ocorreu_em: new Date().toISOString(),
    registrada_em: new Date().toISOString(),
    ...dados,
  };
}

describe('ficha do contato', () => {
  it('mostra os negócios do contato e cria um novo já com ele; sem violações', async () => {
    const { container } = renderizarApp(`/contatos/${joao().id}`);
    await screen.findByRole('heading', { level: 1, name: 'João Araújo' });
    const negocios = await screen.findByRole('region', { name: 'Negócios' });
    expect(await within(negocios).findByRole('link', { name: 'Troca de tela' })).toBeTruthy();
    expect(await violacoesA11y(container)).toEqual([]);
    const u = usuario();
    await u.click(within(negocios).getByRole('button', { name: 'Novo negócio' }));
    const janela = await screen.findByRole('dialog');
    expect(within(janela).queryByLabelText('Buscar contato')).toBeNull();
    await u.type(within(janela).getByLabelText('Título'), 'Capinha');
    await u.click(within(janela).getByRole('button', { name: 'Criar negócio' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Capinha' })).toBeTruthy();
  });
});

describe('timeline', () => {
  it('registra uma ligação e uma nota; a nota não tem direção', async () => {
    renderizarApp(`/contatos/${joao().id}`);
    const timeline = await screen.findByRole('region', { name: 'Timeline' });
    expect(await within(timeline).findByText('Nenhuma atividade registrada.')).toBeTruthy();
    const u = usuario();
    await u.click(within(timeline).getByRole('button', { name: 'Registrar atividade' }));
    let janela = await screen.findByRole('dialog');
    expect(within(janela).getByLabelText('Direção')).toBeTruthy();
    await u.type(within(janela).getByLabelText('Resultado (opcional)'), 'não atendeu');
    await u.click(within(janela).getByRole('button', { name: 'Registrar' }));
    expect(await within(timeline).findByText('Resultado: não atendeu')).toBeTruthy();

    await u.click(within(timeline).getByRole('button', { name: 'Registrar atividade' }));
    janela = await screen.findByRole('dialog');
    await u.selectOptions(within(janela).getByLabelText('Tipo'), 'Nota');
    expect(within(janela).queryByLabelText('Direção')).toBeNull();
    await u.type(within(janela).getByLabelText('Conteúdo (opcional)'), 'Prefere WhatsApp');
    await u.click(within(janela).getByRole('button', { name: 'Registrar' }));
    expect(await within(timeline).findByText('Prefere WhatsApp')).toBeTruthy();
    const nota = simulada.negocios.dados(EMPRESA).atividades.find((a) => a.tipo === 'NOTA')!;
    expect(nota.direcao).toBe('INTERNA');
  });

  it('PROPRIO: "Corrigir" só nas próprias e nas primeiras 24 horas; nunca nas do sistema', async () => {
    simulada.definirPermissoes('ana@demo.test', {
      'contato.read': 'EMPRESA',
      'atividade.read': 'EMPRESA',
      'atividade.create': 'EMPRESA',
      'atividade.update': 'PROPRIO',
      'atividade.delete': 'PROPRIO',
    });
    const ontem = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    simulada.negocios
      .dados(EMPRESA)
      .atividades.push(
        atividade({ assunto: 'Minha recente' }),
        atividade({ assunto: 'Minha antiga', registrada_em: ontem, ocorreu_em: ontem }),
        atividade({ assunto: 'Do Bruno', membro_id: BRUNO }),
        atividade({ assunto: 'Do sistema', tipo: 'SISTEMA', direcao: 'INTERNA', membro_id: null }),
      );
    renderizarApp(`/contatos/${joao().id}`);
    const timeline = await screen.findByRole('region', { name: 'Timeline' });
    const item = async (assunto: string) =>
      (await within(timeline).findByText(assunto)).closest('li')!;
    expect(
      within(await item('Minha recente')).getByRole('button', { name: /^Corrigir/ }),
    ).toBeTruthy();
    for (const assunto of ['Minha antiga', 'Do Bruno', 'Do sistema'])
      expect(
        within(await item(assunto)).queryByRole('button', { name: /^Corrigir/ }),
        assunto,
      ).toBeNull();

    const u = usuario();
    await u.click(within(await item('Minha recente')).getByRole('button', { name: /^Corrigir/ }));
    const janela = await screen.findByRole('dialog');
    await u.clear(within(janela).getByLabelText('Assunto (opcional)'));
    await u.type(within(janela).getByLabelText('Assunto (opcional)'), 'Corrigida');
    await u.click(within(janela).getByRole('button', { name: 'Salvar' }));
    expect(await within(timeline).findByText('Corrigida')).toBeTruthy();
  });
});

describe('tarefas', () => {
  it('PROPRIO: sem ações na tarefa de outra pessoa e sem o select de responsável', async () => {
    simulada.definirPermissoes('ana@demo.test', {
      'contato.read': 'EMPRESA',
      'tarefa.read': 'EMPRESA',
      'tarefa.create': 'PROPRIO',
      'tarefa.update': 'PROPRIO',
      'tarefa.delete': 'PROPRIO',
    });
    const agora = new Date().toISOString();
    const base = {
      empresa_id: EMPRESA,
      contato_id: joao().id,
      negocio_id: null,
      descricao: null,
      status: 'PENDENTE' as const,
      prioridade: 'NORMAL' as const,
      origem: 'MANUAL' as const,
      requisito_id: null,
      vence_em: null,
      concluida_em: null,
      created_at: agora,
      updated_at: agora,
    };
    simulada.negocios
      .dados(EMPRESA)
      .tarefas.push(
        { ...base, id: crypto.randomUUID(), titulo: 'Minha', responsavel_id: ANA.membroId },
        { ...base, id: crypto.randomUUID(), titulo: 'Do Bruno', responsavel_id: BRUNO },
      );
    renderizarApp(`/contatos/${joao().id}`);
    const linha = async (titulo: string) =>
      (
        await within(await secao('Tarefas')).findByText(titulo, { selector: '.font-medium' })
      ).closest('li')!;
    expect(
      within(await linha('Minha')).getByRole('button', { name: 'Concluir Minha' }),
    ).toBeTruthy();
    expect(
      within(await linha('Do Bruno')).queryByRole('button', { name: /Concluir|Iniciar|Cancelar/ }),
    ).toBeNull();
    await usuario().click(
      within(await secao('Tarefas')).getByRole('button', { name: 'Nova tarefa' }),
    );
    const janela = await screen.findByRole('dialog');
    expect(within(janela).queryByLabelText('Responsável')).toBeNull();
  });

  it('as abertas aparecem mesmo com mais de 100 tarefas fechadas antes delas', async () => {
    const agora = new Date().toISOString();
    const fechada = (i: number) => ({
      id: crypto.randomUUID(),
      empresa_id: EMPRESA,
      contato_id: joao().id,
      negocio_id: null,
      titulo: `Antiga ${i}`,
      descricao: null,
      status: 'CONCLUIDA' as const,
      prioridade: 'NORMAL' as const,
      origem: 'MANUAL' as const,
      requisito_id: null,
      vence_em: '2020-01-01T00:00:00.000Z',
      responsavel_id: null,
      concluida_em: agora,
      created_at: agora,
      updated_at: agora,
    });
    simulada.negocios
      .dados(EMPRESA)
      .tarefas.push(...Array.from({ length: 120 }, (_, i) => fechada(i)), {
        ...fechada(999),
        titulo: 'Aberta no fim',
        status: 'PENDENTE',
        vence_em: null,
        concluida_em: null,
      });
    renderizarApp(`/contatos/${joao().id}`);
    expect(
      await within(await secao('Tarefas')).findByText('Aberta no fim', {
        selector: '.font-medium',
      }),
    ).toBeTruthy();
  });

  it('cria, inicia e cancela; as fechadas ficam em "mostrar todas"', async () => {
    renderizarApp(`/contatos/${joao().id}`);
    const tarefas = await screen.findByRole('region', { name: 'Tarefas' });
    expect(await within(tarefas).findByText('Nenhuma tarefa aberta.')).toBeTruthy();
    const u = usuario();
    await u.click(within(tarefas).getByRole('button', { name: 'Nova tarefa' }));
    const janela = await screen.findByRole('dialog');
    await u.type(within(janela).getByLabelText('Título'), 'Ligar amanhã');
    await u.selectOptions(within(janela).getByLabelText('Responsável'), 'Ana Souza');
    await u.click(within(janela).getByRole('button', { name: 'Criar tarefa' }));
    const linha = async () =>
      (
        await within(await secao('Tarefas')).findByText('Ligar amanhã', {
          selector: '.font-medium',
        })
      ).closest('li')!;
    await u.click(within(await linha()).getByRole('button', { name: 'Iniciar Ligar amanhã' }));
    await waitFor(async () => expect(within(await linha()).getByText('Em andamento')).toBeTruthy());

    await u.click(within(await linha()).getByRole('button', { name: 'Cancelar Ligar amanhã' }));
    await u.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancelar tarefa',
      }),
    );
    expect(await within(await secao('Tarefas')).findByText('Nenhuma tarefa aberta.')).toBeTruthy();
    await u.click(within(await secao('Tarefas')).getByRole('button', { name: 'Mostrar todas' }));
    expect(within(await linha()).getByText('Cancelada')).toBeTruthy();
  });
});
