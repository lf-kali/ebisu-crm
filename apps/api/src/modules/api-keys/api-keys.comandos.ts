import {
  type ApiKey,
  type ApiKeyCriada,
  codificarCursor,
  type EdicaoApiKey,
  type EntradaApiKey,
  type ListaApiKeys,
  type ParametrosPaginacao,
} from '@ebisu/contracts';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import type { TxContext } from '../../core/tx/contexto.js';
import { posicaoDo } from '../membros/membros.comandos.js';
import {
  buscarApiKey,
  criarApiKey,
  editarApiKey,
  listarApiKeys,
  noCatalogo,
  revogarApiKey,
} from './api-keys.repositorio.js';

// Comandos de API keys (plano docs/planos/f3-5-api-keys-cors.md, decisões 4 a 6). Rotas de
// domínio: a chave é da empresa do X-Empresa-Id.

const invalido = (campo: string, mensagem: string) =>
  new ErroDominio('validacao', { campos: [{ campo, code: 'invalido', mensagem }] });

/**
 * Sem escalada (decisão 5): do catálogo, nunca `config.*` (a chave não administra a conta) e só
 * permissões que quem cria ou edita tem nesta empresa.
 */
function exigirEscoposPermitidos(ctx: TxContext, escopos: readonly string[]) {
  const negado = escopos.find(
    (escopo) => !noCatalogo(escopo) || escopo.startsWith('config.') || !ctx.permissoes.has(escopo),
  );
  if (negado)
    throw invalido('escopos', `Escopo não permitido: ${negado}. Use permissões que você tem.`);
}

export async function listar(
  ctx: TxContext,
  { limit, cursor }: ParametrosPaginacao,
): Promise<ListaApiKeys> {
  const aposId = posicaoDo(cursor);
  const { chaves, haMais } = await listarApiKeys(ctx.tx, ctx.empresaId, {
    limite: limit,
    ...(aposId ? { aposId } : {}),
  });
  const ultima = chaves.at(-1);
  return {
    dados: chaves,
    proximo_cursor: haMais && ultima ? codificarCursor({ id: ultima.id }) : null,
  };
}

export async function ler(ctx: TxContext, id: string): Promise<ApiKey> {
  const chave = await buscarApiKey(ctx.tx, ctx.empresaId, id);
  if (!chave) throw new ErroDominio('nao_encontrado');
  return chave;
}

/** Cria e devolve o token, que não fica guardado em lugar nenhum (decisão 6). */
export async function criar(ctx: TxContext, entrada: EntradaApiKey): Promise<ApiKeyCriada> {
  if (entrada.tipo === 'SERVIDOR') exigirEscoposPermitidos(ctx, entrada.escopos);
  const expiraEm = entrada.expira_em ? new Date(entrada.expira_em) : null;
  if (expiraEm && expiraEm <= new Date())
    throw invalido('expira_em', 'A data de expiração precisa estar no futuro.');
  return criarApiKey(ctx.tx, {
    tenantId: ctx.tenantId,
    empresaId: ctx.empresaId,
    criadoPor: ctx.membroId,
    nome: entrada.nome,
    tipo: entrada.tipo,
    escopos: [...entrada.escopos],
    origens: entrada.tipo === 'NAVEGADOR' ? entrada.origens_cors : [],
    expiraEm,
  });
}

/** O tipo não muda: escopos só na de servidor, origens só na de navegador. Revogada não edita. */
export async function editar(
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoApiKey },
): Promise<ApiKey> {
  const atual = await ler(ctx, id);
  if (atual.revogada_em)
    throw new ErroDominio('transicao_invalida', { detail: 'A chave está revogada.' });
  if (edicao.escopos && atual.tipo === 'NAVEGADOR')
    throw invalido('escopos', 'A chave de navegador só tem o escopo lead.create.');
  if (edicao.origens_cors && atual.tipo === 'SERVIDOR')
    throw invalido('origens_cors', 'A chave de servidor não tem origens.');
  if (edicao.escopos) exigirEscoposPermitidos(ctx, edicao.escopos);
  const chave = await editarApiKey(ctx.tx, ctx.empresaId, id, edicao);
  if (!chave) throw new ErroDominio('nao_encontrado');
  return chave;
}

/** Revoga na hora; revogar de novo não muda nada. */
export async function revogar(ctx: TxContext, id: string): Promise<void> {
  if (!(await revogarApiKey(ctx.tx, ctx.empresaId, id))) throw new ErroDominio('nao_encontrado');
}
