import type {
  Convite,
  EntradaAtribuicoes,
  ListaConvites,
  ParametrosPaginacao,
} from '@ebisu/contracts';
import { codificarCursor } from '@ebisu/contracts';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import type { TxContextDaConta } from '../../core/tx/contexto.js';
import {
  type AtribuicaoPedida,
  buscarConvite,
  criarConvite,
  jaEhMembro,
  listarPendentes,
  paraContrato,
  pendenteValido,
  reenviarConvite,
  revogarConvite,
} from './convites.repositorio.js';
import {
  exigirDono,
  invalida,
  minusculo,
  posicaoDo,
  referenciasValidas,
} from './membros.comandos.js';

// Comandos de convites (plano docs/planos/f3-4b2-convites.md, decisões 1 a 4). A rota pede
// `config.membros`; convidar dá papéis, então o comando também exige `config.rbac`.

/** Papéis pedidos: da conta, empresas ativas, dono só em todas e só por um dono (PR 4b-1). */
async function papeisDoConvite(
  ctx: TxContextDaConta,
  atribuicoes: EntradaAtribuicoes['atribuicoes'],
): Promise<AtribuicaoPedida[]> {
  if (!ctx.permissoes.has('config.rbac'))
    throw new ErroDominio('sem_permissao', {
      detail: 'Convidar dá papéis: é preciso também a permissão config.rbac.',
    });
  const ehPapelDeDono = await referenciasValidas(ctx, { atribuicoes });
  const pedidas = atribuicoes.map((a) => ({
    papel_id: minusculo(a.papel_id),
    empresa_id: a.empresa_id === null ? null : minusculo(a.empresa_id),
  }));
  if (pedidas.some((a) => ehPapelDeDono(a) && a.empresa_id !== null))
    throw invalida('O papel de dono vale só para todas as empresas.');
  if (pedidas.some(ehPapelDeDono)) await exigirDono(ctx);
  return pedidas;
}

async function conviteOu404(ctx: TxContextDaConta, id: string) {
  const convite = await buscarConvite(ctx.tx, id);
  if (!convite) throw new ErroDominio('nao_encontrado');
  return convite;
}

async function contrato(ctx: TxContextDaConta, id: string): Promise<Convite> {
  const [convite] = await paraContrato(ctx.tx, [await conviteOu404(ctx, id)]);
  return convite!;
}

export async function convidar(
  ctx: TxContextDaConta,
  entrada: {
    email: string;
    atribuicoes: EntradaAtribuicoes['atribuicoes'];
    usuarioId: string | null;
  },
): Promise<Convite> {
  const atribuicoes = await papeisDoConvite(ctx, entrada.atribuicoes);
  if (entrada.usuarioId && (await jaEhMembro(ctx.tx, entrada.usuarioId)))
    throw new ErroDominio('duplicado', { detail: 'Esta pessoa já é membro da conta.' });
  const existente = await pendenteValido(ctx.tx, entrada.email);
  if (existente)
    throw new ErroDominio('duplicado', {
      detail: 'Já há um convite pendente para este e-mail: reenvie.',
      extras: { id_existente: existente.id },
    });
  const id = await criarConvite(ctx.tx, {
    tenantId: ctx.tenantId,
    email: entrada.email,
    atribuicoes,
    convidadoPor: ctx.membroId,
  });
  return contrato(ctx, id);
}

export async function listar(
  ctx: TxContextDaConta,
  { limit, cursor }: ParametrosPaginacao,
): Promise<ListaConvites> {
  const aposId = posicaoDo(cursor);
  const { linhas, haMais } = await listarPendentes(ctx.tx, {
    limite: limit,
    ...(aposId ? { aposId } : {}),
  });
  const ultimo = linhas.at(-1);
  return {
    dados: await paraContrato(ctx.tx, linhas),
    proximo_cursor: haMais && ultimo ? codificarCursor({ id: ultimo.id }) : null,
  };
}

/** Só convite pendente (nem aceito nem revogado) pode ser reenviado. */
export async function reenviar(ctx: TxContextDaConta, id: string): Promise<Convite> {
  const convite = await conviteOu404(ctx, id);
  if (convite.aceito_em || convite.revogado_em)
    throw new ErroDominio('transicao_invalida', {
      detail: 'Este convite já foi aceito ou revogado.',
    });
  // Reenviar reativa os papéis do convite: valem as mesmas regras de quem convida.
  await papeisDoConvite(ctx, convite.atribuicoes as unknown as AtribuicaoPedida[]);
  await reenviarConvite(ctx.tx, ctx.tenantId, id);
  return contrato(ctx, id);
}

/** Revoga: o link deixa de valer na hora. Já revogado: nada muda. Aceito: 409. */
export async function revogar(ctx: TxContextDaConta, id: string): Promise<void> {
  const convite = await conviteOu404(ctx, id);
  if (convite.aceito_em)
    throw new ErroDominio('transicao_invalida', { detail: 'Este convite já foi aceito.' });
  if (!convite.revogado_em) await revogarConvite(ctx.tx, id);
}
