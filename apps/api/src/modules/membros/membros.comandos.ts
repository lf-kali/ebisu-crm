import {
  CursorInvalidoError,
  codificarCursor,
  decodificarCursor,
  type EdicaoMembro,
  type EntradaAtribuicoes,
  type ParametrosPaginacao,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import type { TxContextDaConta } from '../../core/tx/contexto.js';
import {
  buscarMembro,
  contarDonosAtivos,
  editarMembro,
  ehDono,
  empresasAtivas,
  type LinhaMembro,
  listarMembros,
  listarPapeis,
  PAPEL_DONO,
  papeisDaConta,
  temPapelDeDono,
  trocarAtribuicoes,
  travarDonos,
} from './membros.repositorio.js';

// Comandos de membros e papéis (plano docs/planos/f3-4b1-membros-papeis.md). Devolvem as linhas
// do banco; o MembrosService completa nome e e-mail do usuário.

const PosicaoCursor = z.object({ id: Uuid });

function posicaoDo(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return decodificarCursor(cursor, PosicaoCursor).id;
  } catch (erro) {
    if (!(erro instanceof CursorInvalidoError)) throw erro;
    throw new ErroDominio('validacao', {
      campos: [{ campo: 'cursor', code: 'invalid_format', mensagem: 'Cursor inválido.' }],
    });
  }
}

const invalida = (mensagem: string) =>
  new ErroDominio('validacao', {
    campos: [{ campo: 'atribuicoes', code: 'atribuicao_invalida', mensagem }],
  });

/** Quem age é dono (decisão 3). API key (sem membro) nunca é. */
async function exigirDono(ctx: TxContextDaConta) {
  if (!ctx.membroId || !(await ehDono(ctx.tx, ctx.membroId)))
    throw new ErroDominio('sem_permissao', {
      detail: 'Só um dono da conta mexe no papel de dono.',
    });
}

/** O alvo é o último dono ativo: não pode deixar de ser dono ativo (decisão 4). */
async function exigirOutroDono(ctx: TxContextDaConta, membroId: string) {
  if ((await contarDonosAtivos(ctx.tx, membroId)) === 0)
    throw new ErroDominio('transicao_invalida', {
      detail: 'A conta precisa de ao menos um dono ativo.',
    });
}

async function membroOu404(ctx: TxContextDaConta, id: string) {
  const membro = await buscarMembro(ctx.tx, id);
  if (!membro) throw new ErroDominio('nao_encontrado');
  return membro;
}

export async function listar(ctx: TxContextDaConta, { limit, cursor }: ParametrosPaginacao) {
  const aposId = posicaoDo(cursor);
  const { membros, haMais } = await listarMembros(ctx.tx, {
    limite: limit,
    ...(aposId ? { aposId } : {}),
  });
  const ultimo = membros.at(-1);
  return {
    membros,
    proximoCursor: haMais && ultimo ? codificarCursor({ id: ultimo.id }) : null,
  };
}

export const ler = (ctx: TxContextDaConta, id: string) => membroOu404(ctx, id);

export async function editar(
  ctx: TxContextDaConta,
  { id, edicao }: { id: string; edicao: EdicaoMembro },
): Promise<LinhaMembro> {
  const mudaStatus = edicao.status !== undefined;
  if (mudaStatus) await travarDonos(ctx.tx, ctx.tenantId);
  const membro = await membroOu404(ctx, id);
  if (mudaStatus && edicao.status !== membro.status) {
    if (membro.status === 'CONVIDADO')
      throw new ErroDominio('transicao_invalida', { detail: 'O convite ainda não foi aceito.' });
    if (membro.id === ctx.membroId)
      throw new ErroDominio('transicao_invalida', {
        detail: 'Você não pode mudar o próprio status.',
      });
    if (temPapelDeDono(membro)) {
      await exigirDono(ctx);
      if (edicao.status === 'SUSPENSO') await exigirOutroDono(ctx, membro.id);
    }
  }
  await editarMembro(ctx.tx, id, edicao);
  return membroOu404(ctx, id);
}

const minusculo = (id: string) => id.toLowerCase();

/**
 * Valida as referências (papéis da conta e empresas ativas da conta, decisão 7) e devolve se cada
 * atribuição pedida é do papel de dono. Quem diz o que é dono é a chave lida do banco, nunca uma
 * comparação de ids como texto (o banco compara uuid sem caixa).
 */
async function referenciasValidas(ctx: TxContextDaConta, entrada: EntradaAtribuicoes) {
  const idsPapel = [...new Set(entrada.atribuicoes.map((a) => minusculo(a.papel_id)))];
  const papeis = await papeisDaConta(ctx.tx, idsPapel);
  if (papeis.length !== idsPapel.length) throw invalida('Papel inexistente nesta conta.');
  const idsEmpresa = [
    ...new Set(entrada.atribuicoes.flatMap((a) => (a.empresa_id ? [minusculo(a.empresa_id)] : []))),
  ];
  const ativas = new Set([...(await empresasAtivas(ctx.tx, idsEmpresa))].map(minusculo));
  if (idsEmpresa.some((id) => !ativas.has(id)))
    throw invalida('Empresa inexistente ou inativa nesta conta.');
  const chaves = new Map(papeis.map((p) => [minusculo(p.id), p.chave]));
  return (a: { papel_id: string }) => chaves.get(minusculo(a.papel_id)) === PAPEL_DONO;
}

export async function atribuir(
  ctx: TxContextDaConta,
  { id, entrada }: { id: string; entrada: EntradaAtribuicoes },
): Promise<LinhaMembro> {
  await travarDonos(ctx.tx, ctx.tenantId);
  const membro = await membroOu404(ctx, id);
  const ehPapelDeDono = await referenciasValidas(ctx, entrada);
  const novas = entrada.atribuicoes.map((a) => ({
    papel_id: minusculo(a.papel_id),
    empresa_id: a.empresa_id === null ? null : minusculo(a.empresa_id),
  }));
  // Decisão 5: dono vale para a conta inteira.
  if (novas.some((a) => ehPapelDeDono(a) && a.empresa_id !== null))
    throw invalida('O papel de dono vale só para todas as empresas.');

  const eraDono = temPapelDeDono(membro);
  const seraDono = novas.some((a) => ehPapelDeDono(a) && a.empresa_id === null);
  if (eraDono !== seraDono) {
    await exigirDono(ctx);
    if (eraDono && membro.status === 'ATIVO') await exigirOutroDono(ctx, membro.id);
  }

  const chave = (a: { papel_id: string; empresa_id: string | null }) =>
    `${a.papel_id}:${a.empresa_id ?? '*'}`;
  const atuais = new Map(
    membro.atribuicoes.map((a) => [chave({ papel_id: a.papel.id, empresa_id: a.empresa_id }), a]),
  );
  const pedidas = new Set(novas.map(chave));
  await trocarAtribuicoes(
    ctx.tx,
    { tenantId: ctx.tenantId, membroId: membro.id },
    {
      remover: [...atuais].filter(([k]) => !pedidas.has(k)).map(([, a]) => a.id),
      criar: novas.filter((a) => !atuais.has(chave(a))),
    },
  );
  return membroOu404(ctx, id);
}

export const papeis = (ctx: TxContextDaConta) => listarPapeis(ctx.tx);
