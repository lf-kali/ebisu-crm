import { z } from 'zod';
import { Data, DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';

// Contatos da empresa (spec §5.3; plano docs/planos/f4-1-contatos.md). Dedupe por e-mail,
// telefone e WhatsApp entre os não excluídos (CRM-1): repetido dá 409 `duplicado` com
// `id_existente`. Telefones entram como digitados e saem em E.164. Campos derivados (ciclo de vida,
// scores, completude) só aparecem na resposta: na entrada são recusados (objeto estrito).

export const TipoPessoa = z.enum(['PF', 'PJ']).meta({ id: 'TipoPessoa' });
export const CanalComunicacao = z
  .enum(['WHATSAPP', 'EMAIL', 'SMS'])
  .meta({ id: 'CanalComunicacao' });
export type CanalComunicacao = z.infer<typeof CanalComunicacao>;
export const CicloVida = z
  .enum(['LEAD', 'LEAD_QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE', 'RECORRENTE', 'INATIVO'])
  .meta({ id: 'CicloVida', description: 'Derivado dos negócios, orçamentos e OS (CRM-2)' });
export type CicloVida = z.infer<typeof CicloVida>;

export const Endereco = z
  .object({
    cep: z
      .string()
      .trim()
      .regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
    logradouro: z.string().trim().max(200),
    numero: z.string().trim().max(20),
    complemento: z.string().trim().max(100),
    bairro: z.string().trim().max(100),
    cidade: z.string().trim().max(100),
    uf: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'UF com 2 letras')
      .transform((uf) => uf.toUpperCase()),
  })
  .partial()
  .meta({ id: 'Endereco' });
export type Endereco = z.infer<typeof Endereco>;

const Telefone = z
  .string()
  .trim()
  .min(8)
  .max(30)
  .meta({ description: 'Como digitado, ex.: (11) 98765-4321 ou +351 912 345 678' });

const camposEditaveis = {
  tipo_pessoa: TipoPessoa,
  nome: z.string().trim().min(1).max(200),
  documento: z
    .string()
    .trim()
    .max(20)
    .meta({ description: 'CPF (PF) ou CNPJ (PJ), com ou sem máscara; a API confere os dígitos' }),
  email: z.string().trim().max(254).pipe(z.email()),
  telefone: Telefone,
  whatsapp: Telefone,
  canal_preferido: CanalComunicacao,
  data_nascimento: Data,
  endereco: Endereco,
  origem_id: Uuid,
  responsavel_id: Uuid,
  observacoes: z.string().trim().max(5000),
};

const temMeioDeContato = (c: { email?: unknown; telefone?: unknown; whatsapp?: unknown }) =>
  Boolean(c.email || c.telefone || c.whatsapp);

export const EntradaContato = z
  .strictObject({
    ...camposEditaveis,
    tipo_pessoa: TipoPessoa.default('PF'),
    documento: camposEditaveis.documento.optional(),
    email: camposEditaveis.email.optional(),
    telefone: Telefone.optional(),
    whatsapp: Telefone.optional(),
    canal_preferido: CanalComunicacao.optional(),
    data_nascimento: Data.optional(),
    endereco: Endereco.optional(),
    origem_id: Uuid.optional(),
    responsavel_id: Uuid.optional(),
    observacoes: camposEditaveis.observacoes.optional(),
  })
  .refine(temMeioDeContato, {
    message: 'Informe e-mail, telefone ou WhatsApp',
    path: ['email'],
  })
  .meta({ id: 'EntradaContato' });
export type EntradaContato = z.infer<typeof EntradaContato>;

/** PATCH: `null` remove um campo opcional; o contato não pode ficar sem meio de contato. */
export const EdicaoContato = z
  .strictObject({
    tipo_pessoa: TipoPessoa,
    nome: camposEditaveis.nome,
    documento: camposEditaveis.documento.nullable(),
    email: camposEditaveis.email.nullable(),
    telefone: Telefone.nullable(),
    whatsapp: Telefone.nullable(),
    canal_preferido: CanalComunicacao.nullable(),
    data_nascimento: Data.nullable(),
    endereco: Endereco.nullable(),
    origem_id: Uuid.nullable(),
    responsavel_id: Uuid.nullable(),
    observacoes: camposEditaveis.observacoes.nullable(),
  })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoContato' });
export type EdicaoContato = z.infer<typeof EdicaoContato>;

export const SituacaoConsentimento = z
  .object({
    canal: CanalComunicacao,
    finalidade: z.enum(['TRANSACIONAL', 'MARKETING']),
    concedido: z.boolean(),
    coletado_em: DataHora,
  })
  .meta({
    id: 'SituacaoConsentimento',
    description: 'O registro mais recente por canal e finalidade',
  });

export const Contato = z
  .object({
    id: Uuid,
    empresa_id: Uuid,
    tipo_pessoa: TipoPessoa,
    nome: z.string(),
    documento: z.string().nullable(),
    email: z.string().nullable(),
    telefone_e164: z.string().nullable(),
    whatsapp_e164: z.string().nullable(),
    canal_preferido: CanalComunicacao.nullable(),
    data_nascimento: Data.nullable(),
    endereco: Endereco.nullable(),
    origem_id: Uuid.nullable(),
    responsavel_id: Uuid.nullable(),
    observacoes: z.string().nullable(),
    // Derivados (só leitura).
    ciclo_vida: CicloVida,
    score_total: z.number().int(),
    temperatura: z.enum(['FRIO', 'MORNO', 'QUENTE']),
    quadrante: z.enum(['PRONTO_PARA_COMPRAR', 'CULTIVAR', 'PROSPECTAR', 'TRABALHAR_DEPOIS']),
    completude_perfil: z.number().int(),
    campos_faltantes: z.array(z.string()),
    ultima_interacao_em: DataHora.nullable(),
    consentimentos: z.array(SituacaoConsentimento),
    created_at: DataHora,
    updated_at: DataHora,
  })
  .meta({ id: 'Contato' });
export type Contato = z.infer<typeof Contato>;

export const ListaContatos = paginado(Contato).meta({ id: 'ListaContatos' });
export type ListaContatos = z.infer<typeof ListaContatos>;

/** Estrita: um `filtro[...]` desconhecido dá 422 em vez de ser ignorado. */
export const ConsultaContatos = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    q: z.string().trim().min(2).max(100).optional().meta({
      description: 'Nome (sem diferenciar acento), trecho do e-mail ou dígitos do telefone',
    }),
    'filtro[origem_id]': Uuid.optional(),
    'filtro[responsavel_id]': Uuid.optional(),
    'filtro[ciclo_vida]': CicloVida.optional(),
  })
  .meta({ id: 'ConsultaContatos' });
export type ConsultaContatos = z.infer<typeof ConsultaContatos>;

export const ROTAS_CONTATOS = { contatos: '/v1/contatos' } as const;
