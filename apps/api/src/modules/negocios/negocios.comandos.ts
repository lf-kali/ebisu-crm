import {
  codificarCursor,
  type ConsultaNegocios,
  CursorInvalidoError,
  decodificarCursor,
  type EdicaoNegocio,
  type EntradaMoverNegocio,
  type EntradaNegocio,
  type EntradaNutrirNegocio,
  type EntradaPerderNegocio,
  type ListaNegocios,
  type Negocio,
  type NegocioDetalhado,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { filtroDeEscopo } from '../../core/rbac/permissoes.js';
import type { TxContext } from '../../core/tx/contexto.js';
import {
  completudeDoNegocio,
  pendentesParaSair,
  requisitosDoNegocio,
} from '../completude/completude.js';
import { membroComAcesso } from '../contatos/contatos.repositorio.js';
import * as repo from './negocios.repositorio.js';

// Comandos de negócio (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 3 a 8):
// CRUD, MoverNegocio (CRM-3), PerderNegocio (CRM-4) e nutrir. Escopo PROPRIO pelo responsável
// (SEG-4); PATCH e comandos conferem `versao_registro` (D-A08).

const invalido = (campo: string, mensagem: string) =>
  new ErroDominio('validacao', { campos: [{ campo, code: 'invalido', mensagem }] });
const transicao = (detail: string) => new ErroDominio('transicao_invalida', { detail });

const escopoDe = (ctx: TxContext, chave: string) => filtroDeEscopo(ctx, chave, 'responsavel_id');

function posicao(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return decodificarCursor(cursor, z.object({ id: Uuid })).id;
  } catch (erro) {
    if (!(erro instanceof CursorInvalidoError)) throw erro;
    throw invalido('cursor', 'Cursor inválido.');
  }
}

/** Com PROPRIO, o responsável é quem age (como nos contatos). */
function responsavelPermitido(
  ctx: TxContext,
  chave: string,
  responsavelId: string | null | undefined,
) {
  if (ctx.permissoes.get(chave) !== 'PROPRIO') return responsavelId;
  if (responsavelId !== undefined && responsavelId !== ctx.membroId)
    throw new ErroDominio('sem_permissao', {
      detail: 'Com acesso só aos próprios negócios, o responsável é você.',
    });
  return ctx.membroId;
}

async function exigirReferencias(
  ctx: TxContext,
  {
    responsavel_id,
    dispositivo_id,
  }: { responsavel_id?: string | null; dispositivo_id?: string | null },
) {
  if (responsavel_id && !(await membroComAcesso(ctx.tx, ctx.empresaId, responsavel_id)))
    throw invalido('responsavel_id', 'Responsável sem acesso a esta empresa.');
  if (dispositivo_id && !(await repo.dispositivoDaEmpresa(ctx.tx, ctx.empresaId, dispositivo_id)))
    throw invalido('dispositivo_id', 'Dispositivo inexistente nesta empresa.');
}

/** Campos do corpo na forma gravada (só os que vieram; `null` remove). */
function paraGravar(entrada: Omit<EdicaoNegocio, 'versao_registro'>): repo.DadosNegocio {
  const { valor_estimado, previsao_fechamento, ...resto } = entrada;
  return {
    ...resto,
    ...(valor_estimado !== undefined ? { valor_estimado: repo.decimal(valor_estimado) } : {}),
    ...(previsao_fechamento !== undefined
      ? { previsao_fechamento: previsao_fechamento === null ? null : new Date(previsao_fechamento) }
      : {}),
  };
}

async function detalhado(ctx: TxContext, negocio: Negocio): Promise<NegocioDetalhado> {
  const { requisitos } = await requisitosDoNegocio(ctx.tx, ctx.empresaId, negocio.id);
  return { ...negocio, requisitos };
}

async function relido(ctx: TxContext, id: string): Promise<NegocioDetalhado> {
  const negocio = await repo.buscarNegocio(ctx.tx, ctx.empresaId, id);
  if (!negocio) throw new ErroDominio('nao_encontrado');
  return detalhado(ctx, negocio);
}

/**
 * Completude do negócio com estes dados na etapa dada, para gravar na mesma escrita (CRM-6; um
 * registro só no audit log).
 */
const completudeEm = (
  ctx: TxContext,
  { negocio, contatoId, etapaId }: { negocio?: Negocio; contatoId: string; etapaId: string },
  dados: object,
) =>
  completudeDoNegocio(ctx.tx, ctx.empresaId, {
    ...(negocio ? { negocioId: negocio.id } : {}),
    contatoId,
    etapaId,
    dados: { ...negocio, ...dados },
  });

/** Negócio visível no escopo da permissão, com a versão que o cliente leu. */
async function exigirNegocio(ctx: TxContext, id: string, chave: string, versao?: number) {
  const negocio = await repo.buscarNegocio(ctx.tx, ctx.empresaId, id, escopoDe(ctx, chave));
  if (!negocio) throw new ErroDominio('nao_encontrado');
  if (versao !== undefined && versao !== negocio.versao_registro)
    throw new ErroDominio('conflito_versao');
  return negocio;
}

/** Grava com a trava otimista; outro pedido no meio do caminho dá 409 `conflito_versao`. */
async function gravar(
  ctx: TxContext,
  negocio: Negocio,
  dados: Parameters<typeof repo.gravarComVersao>[4],
) {
  if (
    !(await repo.gravarComVersao(ctx.tx, ctx.empresaId, negocio.id, negocio.versao_registro, dados))
  )
    throw new ErroDominio('conflito_versao');
}

async function etapas(ctx: TxContext) {
  const lista = await repo.etapasDoFunil(ctx.tx, ctx.empresaId);
  if (lista.length === 0)
    throw new ErroDominio('nao_encontrado', { detail: 'A empresa não tem funil padrão.' });
  return lista;
}

const etapaDoTipo = (lista: repo.EtapaDoFunil[], tipo: repo.EtapaDoFunil['tipo']) => {
  const etapa = lista.find((e) => e.tipo === tipo);
  if (!etapa) throw new ErroDominio('erro_interno', { detail: `Funil sem etapa ${tipo}.` });
  return etapa;
};

const segundosDesde = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));

/** Histórico da troca de etapa (decisão 5). */
const historico = (ctx: TxContext, negocio: Negocio, para: string) =>
  repo.registrarHistorico(ctx.tx, {
    negocio_id: negocio.id,
    de_etapa_id: negocio.etapa_id,
    para_etapa_id: para,
    membro_id: ctx.membroId,
    segundos_na_etapa: segundosDesde(negocio.entrou_etapa_em),
  });

export async function listar(ctx: TxContext, consulta: ConsultaNegocios): Promise<ListaNegocios> {
  const antesDe = posicao(consulta.cursor);
  const { negocios, haMais } = await repo.listarNegocios(
    ctx.tx,
    ctx.empresaId,
    escopoDe(ctx, 'negocio.read'),
    {
      limite: consulta.limit,
      ...(antesDe ? { antesDe } : {}),
      filtros: {
        q: consulta.q,
        etapa_id: consulta['filtro[etapa_id]'],
        status: consulta['filtro[status]'],
        responsavel_id: consulta['filtro[responsavel_id]'],
        contato_id: consulta['filtro[contato_id]'],
      },
    },
  );
  const ultimo = negocios.at(-1);
  return {
    dados: negocios,
    proximo_cursor: haMais && ultimo ? codificarCursor({ id: ultimo.id }) : null,
  };
}

export async function ler(ctx: TxContext, id: string): Promise<NegocioDetalhado> {
  return detalhado(ctx, await exigirNegocio(ctx, id, 'negocio.read'));
}

/** Nasce na primeira etapa ABERTA do funil padrão, com as tarefas dela (decisão 4). */
export async function criar(ctx: TxContext, entrada: EntradaNegocio): Promise<NegocioDetalhado> {
  const responsavel_id = responsavelPermitido(ctx, 'negocio.create', entrada.responsavel_id);
  const contato = await repo.contatoVisivel(
    ctx.tx,
    ctx.empresaId,
    entrada.contato_id,
    filtroDeEscopo(ctx, 'contato.read', 'responsavel_id'),
  );
  if (!contato) throw invalido('contato_id', 'Contato inexistente nesta empresa.');
  await exigirReferencias(ctx, { responsavel_id, dispositivo_id: entrada.dispositivo_id });
  const primeira = etapaDoTipo(await etapas(ctx), 'ABERTA');
  const { contato_id, ...campos } = entrada;
  const dados = paraGravar({ ...campos, responsavel_id });
  const negocio = await repo.criarNegocio(ctx.tx, {
    ...dados,
    completude: await completudeEm(ctx, { contatoId: contato_id, etapaId: primeira.id }, dados),
    tenant_id: ctx.tenantId,
    empresa_id: ctx.empresaId,
    contato_id,
    funil_id: primeira.funil_id,
    etapa_id: primeira.id,
    titulo: entrada.titulo,
  });
  await repo.registrarHistorico(ctx.tx, {
    negocio_id: negocio.id,
    de_etapa_id: null,
    para_etapa_id: primeira.id,
    membro_id: ctx.membroId,
    segundos_na_etapa: null,
  });
  await repo.criarTarefasDaEtapa(
    ctx.tx,
    { ...negocio, tenant_id: ctx.tenantId },
    primeira.requisitos,
  );
  return relido(ctx, negocio.id);
}

export async function editar(
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoNegocio },
): Promise<NegocioDetalhado> {
  const { versao_registro, ...campos } = edicao;
  const negocio = await exigirNegocio(ctx, id, 'negocio.update', versao_registro);
  if (campos.responsavel_id !== undefined)
    responsavelPermitido(ctx, 'negocio.update', campos.responsavel_id);
  await exigirReferencias(ctx, campos);
  const dados = paraGravar(campos);
  const completude = await completudeEm(
    ctx,
    { negocio, contatoId: negocio.contato_id, etapaId: negocio.etapa_id },
    dados,
  );
  await gravar(ctx, negocio, { ...dados, completude });
  return relido(ctx, id);
}

/**
 * Requisitos obrigatórios não atendidos para sair da etapa atual até o destino: avançar várias
 * etapas de uma vez não pula os requisitos das intermediárias (CRM-3).
 */
function pendentesAte(
  ctx: TxContext,
  negocio: Negocio,
  lista: repo.EtapaDoFunil[],
  destino: repo.EtapaDoFunil,
) {
  const atual = lista.find((e) => e.id === negocio.etapa_id)!;
  const etapasASair = lista.filter(
    (e) => e.tipo === 'ABERTA' && e.ordem >= atual.ordem && e.ordem < destino.ordem,
  );
  return pendentesParaSair(
    ctx.tx,
    ctx.empresaId,
    negocio.id,
    etapasASair.map((e) => e.id),
  );
}

/** O contato passa a LEAD_QUALIFICADO ao avançar além da segunda etapa ABERTA (decisão 6). */
async function qualificarSePassou(
  ctx: TxContext,
  negocio: Negocio,
  lista: repo.EtapaDoFunil[],
  destino: repo.EtapaDoFunil,
) {
  const qualificacao = lista.filter((e) => e.tipo === 'ABERTA')[1];
  const atual = lista.find((e) => e.id === negocio.etapa_id)!;
  if (qualificacao && atual.ordem <= qualificacao.ordem && destino.ordem > qualificacao.ordem)
    await repo.qualificarContato(ctx.tx, ctx.empresaId, negocio.contato_id);
}

function exigirDestinoAberto(destino: repo.EtapaDoFunil | undefined) {
  if (!destino) throw invalido('etapa_id', 'Etapa de outro funil.');
  if (destino.tipo === 'GANHO')
    throw transicao('O negócio só é ganho pela conversão do orçamento aprovado.');
  if (destino.tipo === 'PERDIDO') throw transicao('Para perder o negócio, use /perder.');
  if (destino.tipo === 'NUTRICAO') throw transicao('Para nutrir o negócio, use /nutrir.');
  return destino;
}

export async function mover(
  ctx: TxContext,
  { id, entrada }: { id: string; entrada: EntradaMoverNegocio },
): Promise<NegocioDetalhado> {
  const negocio = await exigirNegocio(ctx, id, 'negocio.update', entrada.versao_registro);
  if (negocio.status === 'GANHO' || negocio.status === 'PERDIDO')
    throw transicao('Negócio fechado não muda de etapa.');
  const lista = await etapas(ctx);
  const destino = exigirDestinoAberto(lista.find((e) => e.id === entrada.etapa_id));
  if (destino.id === negocio.etapa_id) throw transicao('O negócio já está nesta etapa.');
  const atual = lista.find((e) => e.id === negocio.etapa_id)!;
  const avancando = negocio.status === 'ABERTO' && destino.ordem > atual.ordem;
  if (avancando) {
    const pendentes = await pendentesAte(ctx, negocio, lista, destino);
    if (pendentes.length > 0)
      throw new ErroDominio('requisitos_pendentes', { extras: { requisitos: pendentes } });
    await qualificarSePassou(ctx, negocio, lista, destino);
  }
  // Da nutrição, mover para uma etapa aberta reativa o negócio (decisão 8).
  const reativado = { nba_adiada_ate: null };
  await gravar(ctx, negocio, {
    ...reativado,
    etapa_id: destino.id,
    status: 'ABERTO',
    entrou_etapa_em: new Date(),
    completude: await completudeEm(
      ctx,
      { negocio, contatoId: negocio.contato_id, etapaId: destino.id },
      reativado,
    ),
  });
  await historico(ctx, negocio, destino.id);
  await repo.criarTarefasDaEtapa(
    ctx.tx,
    { ...negocio, tenant_id: ctx.tenantId },
    destino.requisitos,
  );
  return relido(ctx, id);
}

export async function perder(
  ctx: TxContext,
  { id, entrada }: { id: string; entrada: EntradaPerderNegocio },
): Promise<NegocioDetalhado> {
  const negocio = await exigirNegocio(ctx, id, 'negocio.update', entrada.versao_registro);
  if (negocio.status === 'GANHO' || negocio.status === 'PERDIDO')
    throw transicao('Negócio fechado não pode ser perdido.');
  if (!(await repo.motivoAtivo(ctx.tx, ctx.empresaId, entrada.motivo_perda_id)))
    throw invalido('motivo_perda_id', 'Motivo de perda inexistente ou inativo.');
  const perdido = etapaDoTipo(await etapas(ctx), 'PERDIDO');
  const agora = new Date();
  await gravar(ctx, negocio, {
    etapa_id: perdido.id,
    status: 'PERDIDO',
    motivo_perda_id: entrada.motivo_perda_id,
    fechado_em: agora,
    entrou_etapa_em: agora,
    completude: await completudeEm(
      ctx,
      { negocio, contatoId: negocio.contato_id, etapaId: perdido.id },
      {},
    ),
  });
  await historico(ctx, negocio, perdido.id);
  await repo.cancelarTarefas(ctx.tx, id);
  return relido(ctx, id);
}

export async function nutrir(
  ctx: TxContext,
  { id, entrada }: { id: string; entrada: EntradaNutrirNegocio },
): Promise<NegocioDetalhado> {
  const negocio = await exigirNegocio(ctx, id, 'negocio.update', entrada.versao_registro);
  if (negocio.status !== 'ABERTO') throw transicao('Só um negócio aberto vai para a nutrição.');
  const reativar = new Date(entrada.nba_adiada_ate);
  if (reativar.getTime() <= Date.now())
    throw invalido('nba_adiada_ate', 'A data de reativação precisa estar no futuro.');
  const nutricao = etapaDoTipo(await etapas(ctx), 'NUTRICAO');
  await gravar(ctx, negocio, {
    etapa_id: nutricao.id,
    status: 'NUTRICAO',
    nba_adiada_ate: reativar,
    entrou_etapa_em: new Date(),
    completude: await completudeEm(
      ctx,
      { negocio, contatoId: negocio.contato_id, etapaId: nutricao.id },
      { nba_adiada_ate: reativar },
    ),
  });
  await historico(ctx, negocio, nutricao.id);
  await repo.cancelarTarefas(ctx.tx, id, { soDeRequisito: true });
  return relido(ctx, id);
}

/** Soft delete; as tarefas abertas do negócio são canceladas. */
export async function excluir(ctx: TxContext, id: string): Promise<void> {
  if (!(await repo.excluirNegocio(ctx.tx, ctx.empresaId, id, escopoDe(ctx, 'negocio.delete'))))
    throw new ErroDominio('nao_encontrado');
  await repo.cancelarTarefas(ctx.tx, id);
}
