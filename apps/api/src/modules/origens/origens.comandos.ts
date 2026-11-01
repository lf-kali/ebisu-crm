import type {
  EdicaoMotivoPerda,
  EdicaoOrigem,
  EntradaMotivoPerda,
  EntradaOrigem,
  ListaMotivosPerda,
  ListaOrigens,
  MotivoPerda,
  Origem,
} from '@ebisu/contracts';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import type { TxContext } from '../../core/tx/contexto.js';
import * as repo from './origens.repositorio.js';

// Comandos de origens e motivos de perda (plano docs/planos/f4-1-contatos.md, decisão 7). Excluir
// desativa: contatos e negócios continuam apontando para o registro.

const encontrado = <T>(valor: T | null): T => {
  if (!valor) throw new ErroDominio('nao_encontrado');
  return valor;
};

export const listarOrigens = async (ctx: TxContext): Promise<ListaOrigens> => ({
  dados: await repo.listarOrigens(ctx.tx, ctx.empresaId),
});
export const lerOrigem = async (ctx: TxContext, id: string): Promise<Origem> =>
  encontrado(await repo.buscarOrigem(ctx.tx, ctx.empresaId, id));
export const criarOrigem = (ctx: TxContext, entrada: EntradaOrigem): Promise<Origem> =>
  repo.criarOrigem(ctx.tx, ctx.tenantId, ctx.empresaId, entrada);
export const editarOrigem = async (
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoOrigem },
): Promise<Origem> => encontrado(await repo.editarOrigem(ctx.tx, ctx.empresaId, id, edicao));
export const desativarOrigem = async (ctx: TxContext, id: string): Promise<void> => {
  encontrado(await repo.editarOrigem(ctx.tx, ctx.empresaId, id, { ativo: false }));
};

export const listarMotivos = async (ctx: TxContext): Promise<ListaMotivosPerda> => ({
  dados: await repo.listarMotivos(ctx.tx, ctx.empresaId),
});
export const lerMotivo = async (ctx: TxContext, id: string): Promise<MotivoPerda> =>
  encontrado(await repo.buscarMotivo(ctx.tx, ctx.empresaId, id));
export const criarMotivo = (ctx: TxContext, entrada: EntradaMotivoPerda): Promise<MotivoPerda> =>
  repo.criarMotivo(ctx.tx, ctx.tenantId, ctx.empresaId, entrada.nome);
export const editarMotivo = async (
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoMotivoPerda },
): Promise<MotivoPerda> => encontrado(await repo.editarMotivo(ctx.tx, ctx.empresaId, id, edicao));
export const desativarMotivo = async (ctx: TxContext, id: string): Promise<void> => {
  encontrado(await repo.editarMotivo(ctx.tx, ctx.empresaId, id, { ativo: false }));
};
