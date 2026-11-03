import {
  codificarCursor,
  type ConsultaTarefas,
  CursorInvalidoError,
  DataHora,
  decodificarCursor,
  type EdicaoTarefa,
  type EntradaTarefa,
  type ListaTarefas,
  type Tarefa,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { filtroDeEscopo } from '../../core/rbac/permissoes.js';
import type { TxContext } from '../../core/tx/contexto.js';
import { recalcularNegocio } from '../completude/completude.js';
import { membroComAcesso } from '../contatos/contatos.repositorio.js';
import * as repo from './tarefas.repositorio.js';

// Comandos de tarefas (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisão 9). Escopo
// PROPRIO pelo responsável (SEG-4). Concluir uma tarefa de requisito recalcula a completude do
// negócio (CRM-6).

const invalido = (campo: string, mensagem: string) =>
  new ErroDominio('validacao', { campos: [{ campo, code: 'invalido', mensagem }] });
const fechada = () =>
  new ErroDominio('transicao_invalida', { detail: 'Tarefa concluída ou cancelada não muda mais.' });

const escopoDe = (ctx: TxContext, chave: string) => filtroDeEscopo(ctx, chave, 'responsavel_id');

const PosicaoCursor = z.object({ vence_em: DataHora.nullable(), id: Uuid });

function posicao(cursor: string | undefined): repo.PosicaoTarefa | undefined {
  if (!cursor) return undefined;
  try {
    return decodificarCursor(cursor, PosicaoCursor);
  } catch (erro) {
    if (!(erro instanceof CursorInvalidoError)) throw erro;
    throw invalido('cursor', 'Cursor inválido.');
  }
}

/** Com PROPRIO, o responsável é quem age (como nos contatos e negócios). */
function responsavelPermitido(
  ctx: TxContext,
  chave: string,
  responsavelId: string | null | undefined,
) {
  if (ctx.permissoes.get(chave) !== 'PROPRIO') return responsavelId;
  if (responsavelId !== undefined && responsavelId !== ctx.membroId)
    throw new ErroDominio('sem_permissao', {
      detail: 'Com acesso só às próprias tarefas, o responsável é você.',
    });
  return ctx.membroId;
}

async function exigirResponsavel(ctx: TxContext, responsavelId: string | null | undefined) {
  if (responsavelId && !(await membroComAcesso(ctx.tx, ctx.empresaId, responsavelId)))
    throw invalido('responsavel_id', 'Responsável sem acesso a esta empresa.');
}

/**
 * Negócio e contato da tarefa, visíveis para quem age. Só com o negócio, o contato é o dele; com
 * os dois, precisam combinar.
 */
async function vinculos(ctx: TxContext, entrada: Pick<EntradaTarefa, 'negocio_id' | 'contato_id'>) {
  let contatoId = entrada.contato_id ?? null;
  if (entrada.negocio_id) {
    const negocio = await repo.negocioVisivel(
      ctx.tx,
      ctx.empresaId,
      entrada.negocio_id,
      filtroDeEscopo(ctx, 'negocio.read', 'responsavel_id'),
    );
    if (!negocio) throw invalido('negocio_id', 'Negócio inexistente nesta empresa.');
    if (contatoId && contatoId !== negocio.contato_id)
      throw invalido('contato_id', 'O contato não é o do negócio.');
    contatoId = negocio.contato_id;
  }
  // O contato herdado do negócio também precisa estar visível: quem vê o negócio e não o
  // contato não escreve na timeline dele.
  if (
    contatoId &&
    !(await repo.contatoVisivel(
      ctx.tx,
      ctx.empresaId,
      contatoId,
      filtroDeEscopo(ctx, 'contato.read', 'responsavel_id'),
    ))
  )
    throw invalido('contato_id', 'Contato inexistente nesta empresa.');
  return { negocio_id: entrada.negocio_id ?? null, contato_id: contatoId };
}

async function exigirTarefa(ctx: TxContext, id: string, chave: string): Promise<Tarefa> {
  const tarefa = await repo.buscarTarefa(ctx.tx, ctx.empresaId, id, escopoDe(ctx, chave));
  if (!tarefa) throw new ErroDominio('nao_encontrado');
  return tarefa;
}

async function relida(ctx: TxContext, id: string): Promise<Tarefa> {
  const tarefa = await repo.buscarTarefa(ctx.tx, ctx.empresaId, id);
  if (!tarefa) throw new ErroDominio('nao_encontrado');
  return tarefa;
}

export async function listar(ctx: TxContext, consulta: ConsultaTarefas): Promise<ListaTarefas> {
  const apos = posicao(consulta.cursor);
  const vence = consulta['filtro[vence_ate]'];
  const { tarefas, haMais } = await repo.listarTarefas(
    ctx.tx,
    ctx.empresaId,
    escopoDe(ctx, 'tarefa.read'),
    {
      limite: consulta.limit,
      ...(apos ? { apos } : {}),
      filtros: {
        status: consulta['filtro[status]'],
        responsavel_id: consulta['filtro[responsavel_id]'],
        negocio_id: consulta['filtro[negocio_id]'],
        contato_id: consulta['filtro[contato_id]'],
        ...(vence ? { vence_ate: new Date(vence) } : {}),
      },
    },
  );
  const ultima = tarefas.at(-1);
  return {
    dados: tarefas,
    proximo_cursor:
      haMais && ultima ? codificarCursor({ vence_em: ultima.vence_em, id: ultima.id }) : null,
  };
}

export const ler = (ctx: TxContext, id: string) => exigirTarefa(ctx, id, 'tarefa.read');

export async function criar(ctx: TxContext, entrada: EntradaTarefa): Promise<Tarefa> {
  const responsavel_id = responsavelPermitido(ctx, 'tarefa.create', entrada.responsavel_id);
  await exigirResponsavel(ctx, responsavel_id);
  return repo.criarTarefa(ctx.tx, {
    tenant_id: ctx.tenantId,
    empresa_id: ctx.empresaId,
    ...(await vinculos(ctx, entrada)),
    titulo: entrada.titulo,
    descricao: entrada.descricao ?? null,
    prioridade: entrada.prioridade,
    vence_em: entrada.vence_em ? new Date(entrada.vence_em) : null,
    responsavel_id: responsavel_id ?? null,
    origem: 'MANUAL',
  });
}

export async function editar(
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoTarefa },
): Promise<Tarefa> {
  await exigirTarefa(ctx, id, 'tarefa.update');
  if (edicao.responsavel_id !== undefined) {
    responsavelPermitido(ctx, 'tarefa.update', edicao.responsavel_id);
    await exigirResponsavel(ctx, edicao.responsavel_id);
  }
  const { vence_em, ...resto } = edicao;
  const dados = {
    ...resto,
    ...(vence_em !== undefined ? { vence_em: vence_em === null ? null : new Date(vence_em) } : {}),
  };
  if (!(await repo.editarTarefaAberta(ctx.tx, ctx.empresaId, id, dados))) throw fechada();
  return relida(ctx, id);
}

/** Concluir uma tarefa de requisito atende o requisito: a completude do negócio muda. */
export async function concluir(ctx: TxContext, id: string): Promise<Tarefa> {
  const tarefa = await exigirTarefa(ctx, id, 'tarefa.update');
  const ok = await repo.editarTarefaAberta(ctx.tx, ctx.empresaId, id, {
    status: 'CONCLUIDA',
    concluida_em: new Date(),
  });
  if (!ok) throw fechada();
  if (tarefa.requisito_id && tarefa.negocio_id)
    await recalcularNegocio(ctx.tx, ctx.empresaId, tarefa.negocio_id);
  return relida(ctx, id);
}

/** DELETE cancela: a tarefa continua no histórico (decisão 9). */
export async function cancelar(ctx: TxContext, id: string): Promise<void> {
  await exigirTarefa(ctx, id, 'tarefa.delete');
  if (!(await repo.editarTarefaAberta(ctx.tx, ctx.empresaId, id, { status: 'CANCELADA' })))
    throw fechada();
}
