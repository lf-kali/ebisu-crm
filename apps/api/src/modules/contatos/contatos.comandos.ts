import {
  codificarCursor,
  type ConsultaContatos,
  type Consentimento,
  type Contato,
  CursorInvalidoError,
  decodificarCursor,
  type EdicaoContato,
  type EntradaConsentimento,
  type EntradaContato,
  type ListaConsentimentos,
  type ListaContatos,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import {
  normalizarDocumento,
  normalizarEmail,
  normalizarTelefone,
} from '../../core/normalizacao/normalizacao.js';
import { filtroDeEscopo } from '../../core/rbac/permissoes.js';
import type { TxContext } from '../../core/tx/contexto.js';
import {
  perfilDoContato,
  recalcularContato,
  recalcularNegociosDoContato,
} from '../completude/completude.js';
import * as repo from './contatos.repositorio.js';

// Comandos de contatos (plano docs/planos/f4-1-contatos.md). Normaliza e-mail, telefone e
// documento; confere o dedupe (CRM-1) antes de gravar; aplica o escopo PROPRIO (SEG-4).

const invalido = (campo: string, mensagem: string) =>
  new ErroDominio('validacao', { campos: [{ campo, code: 'invalido', mensagem }] });

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

/** Meio de contato normalizado, ou 422 no campo se o telefone não for um número válido. */
function telefone(campo: 'telefone' | 'whatsapp', valor: string | null | undefined) {
  if (valor === undefined || valor === null) return valor;
  const e164 = normalizarTelefone(valor);
  if (!e164) throw invalido(campo, 'Telefone inválido. Use DDD e número, ou +DDI para outro país.');
  return e164;
}

function documento(valor: string | null | undefined, tipo: 'PF' | 'PJ') {
  if (valor === undefined || valor === null) return valor;
  const normalizado = normalizarDocumento(valor, tipo);
  if (!normalizado) throw invalido('documento', tipo === 'PF' ? 'CPF inválido.' : 'CNPJ inválido.');
  return normalizado;
}

/** Os campos do corpo na forma gravada (só os que vieram; `null` remove). */
function paraGravar(
  entrada: Partial<Record<keyof EdicaoContato, unknown>> & EdicaoContato,
  tipo: 'PF' | 'PJ',
): Partial<repo.DadosContato> {
  const {
    email,
    telefone: tel,
    whatsapp,
    documento: doc,
    nome,
    endereco,
    data_nascimento,
    ...resto
  } = entrada;
  return {
    ...resto,
    ...(nome !== undefined ? { nome } : {}),
    ...(email !== undefined
      ? { email, email_normalizado: email === null ? null : normalizarEmail(email) }
      : {}),
    ...(tel !== undefined ? { telefone_e164: telefone('telefone', tel) } : {}),
    ...(whatsapp !== undefined ? { whatsapp_e164: telefone('whatsapp', whatsapp) } : {}),
    ...(doc !== undefined ? { documento: documento(doc, tipo) } : {}),
    ...(endereco !== undefined ? { endereco } : {}),
    ...(data_nascimento !== undefined
      ? { data_nascimento: data_nascimento === null ? null : new Date(data_nascimento) }
      : {}),
  } as Partial<repo.DadosContato>;
}

/** Origem ativa da empresa e responsável com acesso a ela (SEG-2); senão 422. */
async function exigirReferencias(
  ctx: TxContext,
  { origem_id, responsavel_id }: { origem_id?: string | null; responsavel_id?: string | null },
) {
  if (origem_id && !(await repo.origemAtiva(ctx.tx, ctx.empresaId, origem_id)))
    throw invalido('origem_id', 'Origem inexistente ou inativa.');
  if (responsavel_id && !(await repo.membroComAcesso(ctx.tx, ctx.empresaId, responsavel_id)))
    throw invalido('responsavel_id', 'Responsável sem acesso a esta empresa.');
}

/**
 * Com PROPRIO, a pessoa só cria e mantém contatos dela: o responsável é ela mesma (decisão 1).
 * Passar para outra pessoa pede escopo EMPRESA ou TENANT.
 */
function responsavelPermitido(
  ctx: TxContext,
  chave: string,
  responsavelId: string | null | undefined,
) {
  if (ctx.permissoes.get(chave) !== 'PROPRIO') return responsavelId;
  if (responsavelId !== undefined && responsavelId !== ctx.membroId)
    throw new ErroDominio('sem_permissao', {
      detail: 'Com acesso só aos próprios contatos, o responsável é você.',
    });
  return ctx.membroId;
}

/**
 * 409 com o contato que já usa o meio de contato (CRM-1). Com PROPRIO, o id só vai quando o contato
 * é da própria pessoa: o de outro responsável ela não pode abrir, e o id seria só um oráculo.
 */
async function exigirMeiosLivres(
  ctx: TxContext,
  chave: string,
  dados: Partial<repo.DadosContato>,
  excetoId?: string,
) {
  const usado = await repo.meioJaUsado(ctx.tx, ctx.empresaId, dados, excetoId);
  if (!usado) return;
  const podeVer = ctx.permissoes.get(chave) !== 'PROPRIO' || usado.responsavel_id === ctx.membroId;
  const meio =
    usado.campo === 'email' ? 'e-mail' : usado.campo === 'telefone' ? 'telefone' : 'WhatsApp';
  throw new ErroDominio('duplicado', {
    detail: `Já existe um contato com este ${meio}.`,
    extras: { campo: usado.campo, ...(podeVer ? { id_existente: usado.id } : {}) },
  });
}

async function relido(ctx: TxContext, id: string): Promise<Contato> {
  const contato = await repo.buscarContato(ctx.tx, ctx.empresaId, id);
  if (!contato) throw new ErroDominio('nao_encontrado');
  return contato;
}

export async function listar(ctx: TxContext, consulta: ConsultaContatos): Promise<ListaContatos> {
  const antesDe = posicao(consulta.cursor);
  const { contatos, haMais } = await repo.listarContatos(
    ctx.tx,
    ctx.empresaId,
    escopoDe(ctx, 'contato.read'),
    {
      limite: consulta.limit,
      ...(antesDe ? { antesDe } : {}),
      filtros: {
        q: consulta.q,
        origem_id: consulta['filtro[origem_id]'],
        responsavel_id: consulta['filtro[responsavel_id]'],
        ciclo_vida: consulta['filtro[ciclo_vida]'],
      },
    },
  );
  const ultimo = contatos.at(-1);
  return {
    dados: contatos,
    proximo_cursor: haMais && ultimo ? codificarCursor({ id: ultimo.id }) : null,
  };
}

export async function ler(ctx: TxContext, id: string): Promise<Contato> {
  const contato = await repo.buscarContato(
    ctx.tx,
    ctx.empresaId,
    id,
    escopoDe(ctx, 'contato.read'),
  );
  if (!contato) throw new ErroDominio('nao_encontrado');
  return contato;
}

export async function criar(ctx: TxContext, entrada: EntradaContato): Promise<Contato> {
  const responsavel_id = responsavelPermitido(ctx, 'contato.create', entrada.responsavel_id);
  await exigirReferencias(ctx, { origem_id: entrada.origem_id, responsavel_id });
  const dados = paraGravar({ ...entrada, responsavel_id }, entrada.tipo_pessoa);
  await exigirMeiosLivres(ctx, 'contato.create', dados);
  // A completude vai na mesma escrita (CRM-6; um registro só no audit log).
  const perfil = await perfilDoContato(ctx.tx, ctx.empresaId, { ...dados, consentimentos: [] });
  const criado = await repo.criarContato(ctx.tx, ctx.tenantId, ctx.empresaId, {
    ...(dados as repo.DadosContato),
    ...perfil,
  });
  return relido(ctx, criado.id);
}

export async function editar(
  ctx: TxContext,
  { id, edicao }: { id: string; edicao: EdicaoContato },
): Promise<Contato> {
  const atual = await repo.buscarContato(
    ctx.tx,
    ctx.empresaId,
    id,
    escopoDe(ctx, 'contato.update'),
  );
  if (!atual) throw new ErroDominio('nao_encontrado');
  if (edicao.responsavel_id !== undefined)
    responsavelPermitido(ctx, 'contato.update', edicao.responsavel_id);
  await exigirReferencias(ctx, edicao);
  const tipo = edicao.tipo_pessoa ?? atual.tipo_pessoa;
  // Trocar o tipo confere o documento atual contra o novo tipo.
  const doc =
    edicao.documento !== undefined
      ? edicao.documento
      : edicao.tipo_pessoa
        ? atual.documento
        : undefined;
  const dados = paraGravar({ ...edicao, ...(doc !== undefined ? { documento: doc } : {}) }, tipo);
  const resultado = {
    email: 'email' in dados ? dados.email : atual.email,
    telefone: 'telefone_e164' in dados ? dados.telefone_e164 : atual.telefone_e164,
    whatsapp: 'whatsapp_e164' in dados ? dados.whatsapp_e164 : atual.whatsapp_e164,
  };
  if (!resultado.email && !resultado.telefone && !resultado.whatsapp)
    throw invalido('email', 'O contato precisa de e-mail, telefone ou WhatsApp.');
  await exigirMeiosLivres(ctx, 'contato.update', dados, id);
  const perfil = await perfilDoContato(ctx.tx, ctx.empresaId, {
    ...atual,
    ...(dados as Partial<Contato>),
  });
  await repo.editarContato(ctx.tx, ctx.empresaId, id, { ...dados, ...perfil });
  await recalcularNegociosDoContato(ctx.tx, ctx.empresaId, id);
  return relido(ctx, id);
}

export async function excluir(ctx: TxContext, id: string): Promise<void> {
  if (!(await repo.excluirContato(ctx.tx, ctx.empresaId, id, escopoDe(ctx, 'contato.delete'))))
    throw new ErroDominio('nao_encontrado');
}

export async function registrarConsentimento(
  ctx: TxContext,
  { id, entrada }: { id: string; entrada: EntradaConsentimento },
): Promise<Consentimento> {
  if (!(await repo.buscarContato(ctx.tx, ctx.empresaId, id, escopoDe(ctx, 'contato.update'))))
    throw new ErroDominio('nao_encontrado');
  const registro = await repo.registrarConsentimento(
    ctx.tx,
    ctx.tenantId,
    ctx.empresaId,
    id,
    entrada,
  );
  // O consentimento no canal preferido é requisito do funil (consentimento_transacional).
  await recalcularContato(ctx.tx, ctx.empresaId, id);
  return registro;
}

export async function listarConsentimentos(
  ctx: TxContext,
  id: string,
): Promise<ListaConsentimentos> {
  if (!(await repo.buscarContato(ctx.tx, ctx.empresaId, id, escopoDe(ctx, 'contato.read'))))
    throw new ErroDominio('nao_encontrado');
  return { dados: await repo.listarConsentimentos(ctx.tx, ctx.empresaId, id) };
}
