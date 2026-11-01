import type { RequisitoDoNegocio } from '@ebisu/contracts';
import type { Prisma } from '@ebisu/db';
import * as repo from './completude.repositorio.js';
import {
  atendido,
  type ContatoAvaliado,
  ehDoContato,
  type NegocioAvaliado,
  percentual,
  type RequisitoAvaliado,
} from './regras.js';

// Serviço de completude (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisão 10): o único
// escritor da completude do negócio e do perfil do contato (CRM-6). A F11 o estende com os scores.
// Recalcula na mesma transação de quem mudou o dado.

type Tx = Prisma.TransactionClient;

/** Lote dos recálculos da empresa inteira (edição do funil). */
const LOTE = 500;

const paraNegocioAvaliado = (n: repo.NegocioLido): NegocioAvaliado => ({
  ...n,
  tarefasConcluidas: new Set(n.tarefas.map((t) => t.requisito_id!)),
});
const paraContatoAvaliado = (c: repo.ContatoLido): ContatoAvaliado => c;

/** Os requisitos sobre o contato nas etapas ABERTA, sem repetir a mesma chave. */
function requisitosDoContato(etapas: repo.EtapaComRequisitos[]): RequisitoAvaliado[] {
  const vistos = new Set<string>();
  return etapas
    .filter((e) => e.tipo === 'ABERTA')
    .flatMap((e) => e.requisitos)
    .filter((r) => {
      const chave = `${r.tipo}:${r.chave}`;
      if (!ehDoContato(r) || vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}

/** Os requisitos da etapa do negócio, cada um com `atendido`, e a completude. */
export function avaliarNegocio(etapas: repo.EtapaComRequisitos[], negocio: repo.NegocioLido) {
  const etapa = etapas.find((e) => e.id === negocio.etapa_id);
  const contato = paraContatoAvaliado(negocio.contato);
  const avaliado = paraNegocioAvaliado(negocio);
  const requisitos: RequisitoDoNegocio[] = (etapa?.requisitos ?? []).map((r) => ({
    id: r.id,
    tipo: r.tipo,
    chave: r.chave,
    descricao: r.descricao,
    obrigatorio: r.obrigatorio,
    atendido: atendido(r, contato, avaliado),
  }));
  return {
    requisitos,
    completude: percentual(requisitos.length, requisitos.filter((r) => r.atendido).length),
  };
}

function avaliarContato(etapas: repo.EtapaComRequisitos[], contato: repo.ContatoLido) {
  const requisitos = requisitosDoContato(etapas);
  const faltantes = requisitos.filter((r) => !atendido(r, paraContatoAvaliado(contato), null));
  return {
    completude_perfil: percentual(requisitos.length, requisitos.length - faltantes.length),
    campos_faltantes: faltantes.map((r) => r.chave),
  };
}

async function gravarNegocios(
  tx: Tx,
  etapas: repo.EtapaComRequisitos[],
  lista: repo.NegocioLido[],
) {
  for (const negocio of lista) {
    const { completude } = avaliarNegocio(etapas, negocio);
    if (completude !== negocio.completude) await repo.gravarNegocio(tx, negocio.id, completude);
  }
}

async function gravarContatos(
  tx: Tx,
  etapas: repo.EtapaComRequisitos[],
  lista: repo.ContatoLido[],
) {
  for (const contato of lista) {
    const novo = avaliarContato(etapas, contato);
    const igual =
      novo.completude_perfil === contato.completude_perfil &&
      JSON.stringify(novo.campos_faltantes) === JSON.stringify(contato.campos_faltantes);
    if (!igual) await repo.gravarContato(tx, contato.id, novo);
  }
}

/**
 * Completude e `campos_faltantes` de um contato com estes dados, para o comando gravar na mesma
 * escrita (um único registro no audit log).
 */
export async function perfilDoContato(tx: Tx, empresaId: string, contato: ContatoAvaliado) {
  const etapas = await repo.etapasDoFunilPadrao(tx, empresaId);
  const requisitos = requisitosDoContato(etapas);
  const faltantes = requisitos.filter((r) => !atendido(r, contato, null));
  return {
    completude_perfil: percentual(requisitos.length, requisitos.length - faltantes.length),
    campos_faltantes: faltantes.map((r) => r.chave),
  };
}

/**
 * Completude de um negócio com estes dados na etapa dada, para o comando gravar na mesma escrita.
 * As tarefas concluídas vêm do banco (negócio novo não tem nenhuma).
 */
export async function completudeDoNegocio(
  tx: Tx,
  empresaId: string,
  {
    negocioId,
    contatoId,
    etapaId,
    dados,
  }: {
    negocioId?: string;
    contatoId: string;
    etapaId: string;
    dados: Omit<NegocioAvaliado, 'tarefasConcluidas'>;
  },
) {
  const [etapas, [contato], concluidas] = await Promise.all([
    repo.etapasDoFunilPadrao(tx, empresaId),
    repo.contatos(tx, empresaId, { ids: [contatoId], limite: 1 }),
    negocioId ? repo.tarefasConcluidas(tx, negocioId) : Promise.resolve(new Set<string>()),
  ]);
  const requisitos = etapas.find((e) => e.id === etapaId)?.requisitos ?? [];
  const avaliado = { ...dados, tarefasConcluidas: concluidas };
  const ok = requisitos.filter((r) => contato && atendido(r, contato, avaliado)).length;
  return percentual(requisitos.length, ok);
}

/** Os requisitos da etapa atual do negócio (o "o que falta"), sem gravar nada. */
export async function requisitosDoNegocio(tx: Tx, empresaId: string, negocioId: string) {
  const [etapas, [negocio]] = await Promise.all([
    repo.etapasDoFunilPadrao(tx, empresaId),
    repo.negocios(tx, empresaId, { ids: [negocioId], limite: 1 }),
  ]);
  return negocio ? avaliarNegocio(etapas, negocio) : { requisitos: [], completude: 100 };
}

/**
 * Requisitos obrigatórios não atendidos das etapas dadas (para sair delas, CRM-3). Uma etapa em
 * que o negócio nunca esteve não tem as tarefas: os requisitos TAREFA dela ficam pendentes.
 */
export async function pendentesParaSair(
  tx: Tx,
  empresaId: string,
  negocioId: string,
  etapaIds: readonly string[],
) {
  const [etapas, [negocio]] = await Promise.all([
    repo.etapasDoFunilPadrao(tx, empresaId),
    repo.negocios(tx, empresaId, { ids: [negocioId], limite: 1 }),
  ]);
  if (!negocio) return [];
  const contato = paraContatoAvaliado(negocio.contato);
  const avaliado = paraNegocioAvaliado(negocio);
  return etapas
    .filter((e) => etapaIds.includes(e.id))
    .flatMap((e) => e.requisitos)
    .filter((r) => r.obrigatorio && !atendido(r, contato, avaliado))
    .map(({ id, chave, descricao }) => ({ id, chave, descricao }));
}

/** Depois de mudar o negócio ou concluir uma tarefa de requisito dele. */
export async function recalcularNegocio(tx: Tx, empresaId: string, negocioId: string) {
  const etapas = await repo.etapasDoFunilPadrao(tx, empresaId);
  await gravarNegocios(
    tx,
    etapas,
    await repo.negocios(tx, empresaId, { ids: [negocioId], limite: 1 }),
  );
}

/** Depois de mudar o contato: os negócios abertos dele (podem ter requisitos de contato). */
export async function recalcularNegociosDoContato(tx: Tx, empresaId: string, contatoId: string) {
  const etapas = await repo.etapasDoFunilPadrao(tx, empresaId);
  await gravarNegocios(
    tx,
    etapas,
    await repo.negocios(tx, empresaId, { contatoId, abertos: true, limite: 1000 }),
  );
}

/** Depois de um consentimento: o perfil e os negócios abertos do contato. */
export async function recalcularContato(tx: Tx, empresaId: string, contatoId: string) {
  const etapas = await repo.etapasDoFunilPadrao(tx, empresaId);
  await gravarContatos(
    tx,
    etapas,
    await repo.contatos(tx, empresaId, { ids: [contatoId], limite: 1 }),
  );
  await gravarNegocios(
    tx,
    etapas,
    await repo.negocios(tx, empresaId, { contatoId, abertos: true, limite: 1000 }),
  );
}

/** Depois de editar o funil: todos os contatos e os negócios abertos da empresa, em lotes. */
export async function recalcularEmpresa(tx: Tx, empresaId: string) {
  const etapas = await repo.etapasDoFunilPadrao(tx, empresaId);
  for (let aposId: string | undefined; ;) {
    const lote = await repo.contatos(tx, empresaId, {
      limite: LOTE,
      ...(aposId ? { aposId } : {}),
    });
    await gravarContatos(tx, etapas, lote);
    if (lote.length < LOTE) break;
    aposId = lote.at(-1)!.id;
  }
  for (let aposId: string | undefined; ;) {
    const lote = await repo.negocios(tx, empresaId, {
      abertos: true,
      limite: LOTE,
      ...(aposId ? { aposId } : {}),
    });
    await gravarNegocios(tx, etapas, lote);
    if (lote.length < LOTE) break;
    aposId = lote.at(-1)!.id;
  }
}
