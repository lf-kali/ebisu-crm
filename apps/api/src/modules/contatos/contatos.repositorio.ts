import type { Consentimento, Contato, EntradaConsentimento } from '@ebisu/contracts';
import { normalizarBusca, Prisma } from '@ebisu/db';
import { ErroDominio } from '../../core/erros/erro-dominio.js';

// Acesso a `contato` e `consentimento` (plano docs/planos/f4-1-contatos.md). Sempre pela empresa
// do contexto, sob o RLS da conta; excluídos (deleted_at) não aparecem.

const CAMPOS = {
  id: true,
  empresa_id: true,
  tipo_pessoa: true,
  nome: true,
  documento: true,
  email: true,
  telefone_e164: true,
  whatsapp_e164: true,
  canal_preferido: true,
  data_nascimento: true,
  endereco: true,
  origem_id: true,
  responsavel_id: true,
  observacoes: true,
  ciclo_vida: true,
  score_total: true,
  temperatura: true,
  quadrante: true,
  completude_perfil: true,
  campos_faltantes: true,
  ultima_interacao_em: true,
  created_at: true,
  updated_at: true,
  consentimentos: {
    orderBy: [{ coletado_em: 'desc' }, { id: 'desc' }],
    select: { canal: true, finalidade: true, concedido: true, coletado_em: true },
  },
} as const satisfies Prisma.ContatoSelect;

type Linha = Prisma.ContatoGetPayload<{ select: typeof CAMPOS }>;

const VISIVEL = { deleted_at: null };

/** O consentimento mais recente de cada canal e finalidade (os registros vêm do mais novo). */
function situacaoAtual(consentimentos: Linha['consentimentos']) {
  const vistos = new Set<string>();
  return consentimentos
    .filter((c) => {
      const chave = `${c.canal}:${c.finalidade}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((c) => ({ ...c, coletado_em: c.coletado_em.toISOString() }));
}

const paraContrato = ({ consentimentos, ...linha }: Linha): Contato => ({
  ...linha,
  data_nascimento: linha.data_nascimento?.toISOString().slice(0, 10) ?? null,
  endereco: (linha.endereco as Contato['endereco']) ?? null,
  ultima_interacao_em: linha.ultima_interacao_em?.toISOString() ?? null,
  created_at: linha.created_at.toISOString(),
  updated_at: linha.updated_at.toISOString(),
  consentimentos: situacaoAtual(consentimentos),
});

/** Dados gravados (já normalizados pelo comando). */
export type DadosContato = Omit<
  Prisma.ContatoUncheckedCreateInput,
  'id' | 'tenant_id' | 'empresa_id' | 'created_at' | 'updated_at' | 'endereco'
> & {
  /** `null` remove (vira o NULL do banco; o Prisma ignoraria um `undefined`). */
  endereco?: Contato['endereco'];
};

/** O endereço como o Prisma grava: JSON, ou o NULL do banco quando é para remover. */
const comEndereco = <T extends { endereco?: Contato['endereco'] }>({ endereco, ...resto }: T) => ({
  ...resto,
  ...(endereco === undefined ? {} : { endereco: endereco === null ? Prisma.DbNull : endereco }),
});

/** `%`, `_` e `\` são curingas do LIKE: na busca, valem como texto. */
const literal = (texto: string) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface FiltrosContato {
  q?: string;
  origem_id?: string;
  responsavel_id?: string;
  ciclo_vida?: Contato['ciclo_vida'];
}

function filtroDeBusca(q: string): Prisma.ContatoWhereInput {
  const digitos = q.replace(/\D/g, '');
  const ou: Prisma.ContatoWhereInput[] = [
    { nome_busca: { contains: literal(normalizarBusca(q)) } },
    { email_normalizado: { contains: literal(q.trim().toLowerCase()) } },
  ];
  // Só com dígitos suficientes, para "Ana 2" não varrer todos os telefones com "2".
  if (digitos.length >= 3)
    ou.push({ telefone_e164: { contains: digitos } }, { whatsapp_e164: { contains: digitos } });
  return { OR: ou };
}

/** Uma página, do mais recente ao mais antigo (ids UUID v7 em ordem de criação). */
export async function listarContatos(
  tx: Prisma.TransactionClient,
  empresaId: string,
  escopo: Prisma.ContatoWhereInput,
  { limite, antesDe, filtros }: { limite: number; antesDe?: string; filtros: FiltrosContato },
) {
  const { q, ...iguais } = filtros;
  const linhas = await tx.contato.findMany({
    where: {
      empresa_id: empresaId,
      ...VISIVEL,
      // Em AND: um filtro do cliente com a mesma chave (ex.: responsavel_id) não pode substituir o
      // escopo PROPRIO, que vem do servidor (SEG-4).
      AND: [
        escopo,
        Object.fromEntries(Object.entries(iguais).filter(([, v]) => v !== undefined)),
        q ? filtroDeBusca(q) : {},
      ],
      ...(antesDe ? { id: { lt: antesDe } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limite + 1,
    select: CAMPOS,
  });
  return { contatos: linhas.slice(0, limite).map(paraContrato), haMais: linhas.length > limite };
}

export async function buscarContato(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.ContatoWhereInput = {},
) {
  const linha = await tx.contato.findFirst({
    where: { id, empresa_id: empresaId, ...VISIVEL, ...escopo },
    select: CAMPOS,
  });
  return linha ? paraContrato(linha) : null;
}

/** O campo e o id do contato não excluído que já usa o e-mail, o telefone ou o WhatsApp. */
export async function meioJaUsado(
  tx: Prisma.TransactionClient,
  empresaId: string,
  meios: {
    email_normalizado?: string | null;
    telefone_e164?: string | null;
    whatsapp_e164?: string | null;
  },
  excetoId?: string,
): Promise<{
  campo: 'email' | 'telefone' | 'whatsapp';
  id: string;
  responsavel_id: string | null;
} | null> {
  const pares = [
    ['email', 'email_normalizado', meios.email_normalizado],
    ['telefone', 'telefone_e164', meios.telefone_e164],
    ['whatsapp', 'whatsapp_e164', meios.whatsapp_e164],
  ] as const;
  for (const [campo, coluna, valor] of pares) {
    if (!valor) continue;
    const existente = await tx.contato.findFirst({
      where: {
        empresa_id: empresaId,
        ...VISIVEL,
        [coluna]: valor,
        ...(excetoId ? { id: { not: excetoId } } : {}),
      },
      select: { id: true, responsavel_id: true },
    });
    if (existente) return { campo, ...existente };
  }
  return null;
}

/** Índices únicos parciais do dedupe (CRM-1): a corrida entre dois pedidos também vira 409. */
async function comDedupe<T>(escrita: Promise<T>): Promise<T> {
  try {
    return await escrita;
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
      throw new ErroDominio('duplicado', {
        detail: 'Já existe um contato com este e-mail, telefone ou WhatsApp.',
      });
    throw erro;
  }
}

export async function criarContato(
  tx: Prisma.TransactionClient,
  tenantId: string,
  empresaId: string,
  dados: DadosContato,
) {
  const linha = await comDedupe(
    tx.contato.create({
      data: {
        ...comEndereco(dados),
        nome_busca: normalizarBusca(dados.nome),
        tenant_id: tenantId,
        empresa_id: empresaId,
        campos_faltantes: [],
      },
      select: CAMPOS,
    }),
  );
  return paraContrato(linha);
}

export async function editarContato(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  dados: Partial<DadosContato>,
) {
  await comDedupe(
    tx.contato.updateMany({
      where: { id, empresa_id: empresaId, ...VISIVEL },
      // A busca acompanha o nome (decisão 5).
      data: {
        ...comEndereco(dados),
        ...(dados.nome === undefined ? {} : { nome_busca: normalizarBusca(dados.nome) }),
      },
    }),
  );
  return buscarContato(tx, empresaId, id);
}

/** Soft delete (spec §5.1): some das listas e libera e-mail e telefone para outro contato. */
export async function excluirContato(
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
  escopo: Prisma.ContatoWhereInput,
) {
  const { count } = await tx.contato.updateMany({
    where: { id, empresa_id: empresaId, ...VISIVEL, ...escopo },
    data: { deleted_at: new Date() },
  });
  return count > 0;
}

/** Origem ativa da empresa. */
export const origemAtiva = async (tx: Prisma.TransactionClient, empresaId: string, id: string) =>
  (await tx.origemLead.count({ where: { id, empresa_id: empresaId, ativo: true } })) > 0;

/** Membro ativo com papel nesta empresa ou em todas. */
export const membroComAcesso = async (
  tx: Prisma.TransactionClient,
  empresaId: string,
  id: string,
) =>
  (await tx.membro.count({
    where: {
      id,
      status: 'ATIVO',
      atribuicoes: { some: { OR: [{ empresa_id: empresaId }, { empresa_id: null }] } },
    },
  })) > 0;

const paraConsentimento = (linha: {
  id: string;
  canal: Consentimento['canal'];
  finalidade: Consentimento['finalidade'];
  concedido: boolean;
  base_legal: string;
  evidencia: Prisma.JsonValue;
  coletado_em: Date;
}): Consentimento => ({
  ...linha,
  evidencia: (linha.evidencia as Record<string, unknown> | null) ?? null,
  coletado_em: linha.coletado_em.toISOString(),
});

export async function registrarConsentimento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  empresaId: string,
  contatoId: string,
  entrada: EntradaConsentimento,
) {
  const linha = await tx.consentimento.create({
    data: {
      tenant_id: tenantId,
      empresa_id: empresaId,
      contato_id: contatoId,
      canal: entrada.canal,
      finalidade: entrada.finalidade,
      concedido: entrada.concedido,
      base_legal: entrada.base_legal,
      evidencia: entrada.evidencia ?? Prisma.JsonNull,
    },
  });
  return paraConsentimento(linha);
}

export async function listarConsentimentos(
  tx: Prisma.TransactionClient,
  empresaId: string,
  contatoId: string,
) {
  const linhas = await tx.consentimento.findMany({
    where: { empresa_id: empresaId, contato_id: contatoId },
    orderBy: [{ coletado_em: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  return linhas.map(paraConsentimento);
}
