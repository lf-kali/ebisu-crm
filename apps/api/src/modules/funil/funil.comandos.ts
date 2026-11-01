import type { EdicaoFunil, Funil } from '@ebisu/contracts';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import type { TxContext } from '../../core/tx/contexto.js';
import { recalcularEmpresa } from '../completude/completude.js';
import * as repo from './funil.repositorio.js';

// Comandos do funil (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 1 e 2). Etapas
// não são criadas nem apagadas no MVP; GANHO, PERDIDO e NUTRICAO ficam uma de cada, depois das
// ABERTA. Editar recalcula a completude da empresa (CRM-6).

const invalido = (campo: string, mensagem: string) =>
  new ErroDominio('validacao', { campos: [{ campo, code: 'invalido', mensagem }] });

async function funilDa(ctx: TxContext): Promise<Funil> {
  const funil = await repo.buscarFunil(ctx.tx, ctx.empresaId);
  if (!funil)
    throw new ErroDominio('nao_encontrado', { detail: 'A empresa não tem funil padrão.' });
  return funil;
}

export const ler = (ctx: TxContext): Promise<Funil> => funilDa(ctx);

/** Mesmas etapas, ordens sem repetir, ABERTA antes das demais, requisitos da própria etapa. */
function conferir(atual: Funil, edicao: EdicaoFunil) {
  const existentes = new Map(atual.etapas.map((e) => [e.id, e]));
  const enviados = new Set(edicao.etapas.map((e) => e.id));
  if (enviados.size !== edicao.etapas.length || enviados.size !== existentes.size)
    throw invalido('etapas', 'Envie cada etapa do funil uma vez, sem criar nem apagar etapas.');
  for (const [i, etapa] of edicao.etapas.entries()) {
    const existente = existentes.get(etapa.id);
    if (!existente) throw invalido(`etapas.${i}.id`, 'Etapa de outro funil.');
    const deOutra = etapa.requisitos.findIndex(
      (r) => r.id && !existente.requisitos.some((x) => x.id === r.id),
    );
    if (deOutra >= 0)
      throw invalido(`etapas.${i}.requisitos.${deOutra}.id`, 'Requisito de outra etapa.');
  }
  if (new Set(edicao.etapas.map((e) => e.ordem)).size !== edicao.etapas.length)
    throw invalido('etapas', 'Duas etapas com a mesma ordem.');
  const tipo = (id: string) => existentes.get(id)!.tipo;
  const ultimaAberta = Math.max(
    ...edicao.etapas.filter((e) => tipo(e.id) === 'ABERTA').map((e) => e.ordem),
  );
  if (edicao.etapas.some((e) => tipo(e.id) !== 'ABERTA' && e.ordem < ultimaAberta))
    throw invalido('etapas', 'Ganho, Perdido e Nutrição ficam depois das etapas abertas.');
}

export async function editar(ctx: TxContext, edicao: EdicaoFunil): Promise<Funil> {
  const atual = await funilDa(ctx);
  conferir(atual, edicao);
  if (edicao.nome) await repo.renomearFunil(ctx.tx, atual.id, edicao.nome);
  await repo.gravarEtapas(ctx.tx, atual.id, edicao.etapas);
  for (const etapa of edicao.etapas)
    await repo.trocarRequisitos(ctx.tx, etapa.id, etapa.requisitos);
  await recalcularEmpresa(ctx.tx, ctx.empresaId);
  return funilDa(ctx);
}
