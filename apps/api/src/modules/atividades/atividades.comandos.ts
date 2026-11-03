import {
  type Atividade,
  codificarCursor,
  type ConsultaAtividades,
  CursorInvalidoError,
  DataHora,
  decodificarCursor,
  type EdicaoAtividade,
  type EntradaAtividade,
  type ListaAtividades,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { filtroDeEscopo } from '../../core/rbac/permissoes.js';
import type { TxContext } from '../../core/tx/contexto.js';
import { contatoVisivel, negocioVisivel } from '../tarefas/tarefas.repositorio.js';
import * as repo from './atividades.repositorio.js';

// Comandos de atividades (plano docs/planos/f4-2b-atividades.md). Escopo PROPRIO pelo autor
// (SEG-4). O autor corrige a própria atividade por 24 horas do registro; com EMPRESA ou TENANT, a
// qualquer tempo (decisão 4). SISTEMA e FORMULARIO nunca mudam.

const invalido = (campo: string, mensagem: string) =>
  new ErroDominio('validacao', { campos: [{ campo, code: 'invalido', mensagem }] });
const transicao = (detail: string) => new ErroDominio('transicao_invalida', { detail });

/** Prazo do autor com escopo PROPRIO para corrigir (decisão 4). */
const PRAZO_CORRECAO_MS = 24 * 60 * 60 * 1000;
/** Folga para relógios diferentes ao registrar `ocorreu_em` (decisão 2). */
const FOLGA_FUTURO_MS = 5 * 60 * 1000;
const DO_SISTEMA = new Set<Atividade['tipo']>(['SISTEMA', 'FORMULARIO']);

const escopoDe = (ctx: TxContext, chave: string) => filtroDeEscopo(ctx, chave, 'membro_id');

const PosicaoCursor = z.object({ ocorreu_em: DataHora, id: Uuid });

function posicao(cursor: string | undefined): repo.PosicaoAtividade | undefined {
  if (!cursor) return undefined;
  try {
    return decodificarCursor(cursor, PosicaoCursor);
  } catch (erro) {
    if (!(erro instanceof CursorInvalidoError)) throw erro;
    throw invalido('cursor', 'Cursor inválido.');
  }
}

function quando(ocorreuEm: string | undefined): Date {
  const data = ocorreuEm ? new Date(ocorreuEm) : new Date();
  if (data.getTime() > Date.now() + FOLGA_FUTURO_MS)
    throw invalido('ocorreu_em', 'A atividade não pode estar no futuro.');
  return data;
}

/**
 * Negócio e contato da atividade, visíveis para quem age (decisão 3). Só com o negócio, o contato
 * é o dele; com os dois, precisam combinar.
 */
async function vinculos(
  ctx: TxContext,
  entrada: Pick<EntradaAtividade, 'negocio_id' | 'contato_id'>,
) {
  let contatoId = entrada.contato_id ?? null;
  if (entrada.negocio_id) {
    const negocio = await negocioVisivel(
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
  if (
    entrada.contato_id &&
    !(await contatoVisivel(
      ctx.tx,
      ctx.empresaId,
      entrada.contato_id,
      filtroDeEscopo(ctx, 'contato.read', 'responsavel_id'),
    ))
  )
    throw invalido('contato_id', 'Contato inexistente nesta empresa.');
  return { negocio_id: entrada.negocio_id ?? null, contato_id: contatoId };
}

/**
 * A atividade que a pessoa pode corrigir: no escopo da permissão, não gerada pelo sistema e, com
 * PROPRIO, registrada há menos de 24 horas.
 */
async function corrigivel(ctx: TxContext, id: string, chave: string): Promise<Atividade> {
  const atividade = await repo.buscarAtividade(ctx.tx, ctx.empresaId, id, escopoDe(ctx, chave));
  if (!atividade) throw new ErroDominio('nao_encontrado');
  if (DO_SISTEMA.has(atividade.tipo)) throw transicao('Atividade do sistema não muda.');
  const registrada = new Date(atividade.registrada_em).getTime();
  if (ctx.permissoes.get(chave) === 'PROPRIO' && Date.now() - registrada > PRAZO_CORRECAO_MS)
    throw transicao('O prazo de 24 horas para corrigir a própria atividade terminou.');
  return atividade;
}

async function aposMudar(ctx: TxContext, contatoId: string | null) {
  if (contatoId) await repo.recalcularUltimaInteracao(ctx.tx, ctx.empresaId, contatoId);
}

export async function listar(
  ctx: TxContext,
  consulta: ConsultaAtividades,
): Promise<ListaAtividades> {
  const apos = posicao(consulta.cursor);
  const { atividades, haMais } = await repo.listarAtividades(
    ctx.tx,
    ctx.empresaId,
    escopoDe(ctx, 'atividade.read'),
    {
      limite: consulta.limit,
      ...(apos ? { apos } : {}),
      filtros: {
        contato_id: consulta['filtro[contato_id]'],
        negocio_id: consulta['filtro[negocio_id]'],
        tipo: consulta['filtro[tipo]'],
      },
    },
  );
  const ultima = atividades.at(-1);
  return {
    dados: atividades,
    proximo_cursor:
      haMais && ultima ? codificarCursor({ ocorreu_em: ultima.ocorreu_em, id: ultima.id }) : null,
  };
}

export async function ler(ctx: TxContext, id: string): Promise<Atividade> {
  const atividade = await repo.buscarAtividade(
    ctx.tx,
    ctx.empresaId,
    id,
    escopoDe(ctx, 'atividade.read'),
  );
  if (!atividade) throw new ErroDominio('nao_encontrado');
  return atividade;
}

export async function criar(ctx: TxContext, entrada: EntradaAtividade): Promise<Atividade> {
  const ocorreu_em = quando(entrada.ocorreu_em);
  const ligacao = await vinculos(ctx, entrada);
  const atividade = await repo.criarAtividade(ctx.tx, {
    tenant_id: ctx.tenantId,
    empresa_id: ctx.empresaId,
    ...ligacao,
    tipo: entrada.tipo,
    direcao: entrada.tipo === 'NOTA' ? 'INTERNA' : entrada.direcao!,
    assunto: entrada.assunto ?? null,
    conteudo: entrada.conteudo ?? null,
    resultado: entrada.resultado ?? null,
    membro_id: ctx.membroId,
    ocorreu_em,
  });
  await aposMudar(ctx, ligacao.contato_id);
  return atividade;
}

export async function editar(
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoAtividade },
): Promise<Atividade> {
  const atual = await corrigivel(ctx, id, 'atividade.update');
  if (edicao.direcao && atual.direcao === 'INTERNA')
    throw invalido('direcao', 'A nota é sempre interna.');
  const { ocorreu_em, ...resto } = edicao;
  await repo.editarAtividade(ctx.tx, ctx.empresaId, id, {
    ...resto,
    ...(ocorreu_em !== undefined ? { ocorreu_em: quando(ocorreu_em) } : {}),
  });
  await aposMudar(ctx, atual.contato_id);
  return (await repo.buscarAtividade(ctx.tx, ctx.empresaId, id))!;
}

export async function apagar(ctx: TxContext, id: string): Promise<void> {
  const atual = await corrigivel(ctx, id, 'atividade.delete');
  await repo.apagarAtividade(ctx.tx, ctx.empresaId, id);
  await aposMudar(ctx, atual.contato_id);
}
