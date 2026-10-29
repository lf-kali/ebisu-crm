import {
  CursorInvalidoError,
  codificarCursor,
  decodificarCursor,
  type EdicaoEmpresa,
  type Empresa,
  type EntradaEmpresa,
  type ListaEmpresas,
  normalizarCnpj,
  type ParametrosPaginacao,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import type { TxContextDaConta } from '../../core/tx/contexto.js';
import {
  buscarEmpresa,
  criarEmpresa,
  desativarEmpresa,
  editarEmpresa,
  empresaComCnpj,
  listarEmpresas,
  travarEmpresasAtivas,
} from './empresas.repositorio.js';

// Comandos de empresas (plano docs/planos/f3-4a-cadastro-empresas.md, decisão 9). Rotas da conta:
// o contexto não tem empresa, e o RLS limita tudo à conta do token.

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

/** CNPJ repetido na conta: 409 com o id da empresa que já o tem. */
async function exigirCnpjLivre(ctx: TxContextDaConta, cnpj: string, excetoId?: string) {
  const existente = await empresaComCnpj(ctx.tx, cnpj, excetoId);
  if (existente)
    throw new ErroDominio('duplicado', {
      detail: 'Já existe uma empresa com este CNPJ.',
      extras: { id_existente: existente.id },
    });
}

export async function listar(
  ctx: TxContextDaConta,
  { limit, cursor }: ParametrosPaginacao,
): Promise<ListaEmpresas> {
  const aposId = posicaoDo(cursor);
  const { empresas, haMais } = await listarEmpresas(ctx.tx, {
    limite: limit,
    ...(aposId ? { aposId } : {}),
  });
  const ultima = empresas.at(-1);
  return {
    dados: empresas,
    proximo_cursor: haMais && ultima ? codificarCursor({ id: ultima.id }) : null,
  };
}

export async function ler(ctx: TxContextDaConta, id: string): Promise<Empresa> {
  const empresa = await buscarEmpresa(ctx.tx, id);
  if (!empresa) throw new ErroDominio('nao_encontrado');
  return empresa;
}

export async function criar(ctx: TxContextDaConta, entrada: EntradaEmpresa): Promise<Empresa> {
  const cnpj = entrada.cnpj ? normalizarCnpj(entrada.cnpj) : null;
  if (cnpj) await exigirCnpjLivre(ctx, cnpj);
  return criarEmpresa(ctx.tx, ctx.tenantId, {
    razao_social: entrada.razao_social,
    nome_fantasia: entrada.nome_fantasia,
    cnpj,
  });
}

export async function editar(
  ctx: TxContextDaConta,
  { id, edicao }: { id: string; edicao: EdicaoEmpresa },
): Promise<Empresa> {
  const { cnpj, ...resto } = edicao;
  const dados = {
    ...resto,
    ...(cnpj === undefined ? {} : { cnpj: cnpj === null ? null : normalizarCnpj(cnpj) }),
  };
  if (dados.cnpj) await exigirCnpjLivre(ctx, dados.cnpj, id);
  const empresa = await editarEmpresa(ctx.tx, id, dados);
  if (!empresa) throw new ErroDominio('nao_encontrado');
  return empresa;
}

/** Desativa (decisão 9). Já inativa: nada muda. A última empresa ativa não sai (409). */
export async function desativar(ctx: TxContextDaConta, id: string): Promise<void> {
  const ativas = await travarEmpresasAtivas(ctx.tx);
  const empresa = await buscarEmpresa(ctx.tx, id);
  if (!empresa) throw new ErroDominio('nao_encontrado');
  if (!empresa.ativo) return;
  if (ativas.every((ativa) => ativa === id))
    throw new ErroDominio('transicao_invalida', {
      detail: 'A conta precisa de ao menos uma empresa ativa.',
    });
  await desativarEmpresa(ctx.tx, id);
}
