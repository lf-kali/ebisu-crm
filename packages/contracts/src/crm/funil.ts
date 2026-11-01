import { z } from 'zod';
import { Uuid } from '../comum/escalares.js';

// Funil da empresa (spec §5.3; plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 1 e 2).
// Leitura com `negocio.read`; edição com `config.crm`. Requisitos são "o que falta" para SAIR da
// etapa (CRM-3) e alimentam a completude (CRM-6).

export const TipoEtapa = z
  .enum(['ABERTA', 'GANHO', 'PERDIDO', 'NUTRICAO'])
  .meta({ id: 'TipoEtapa' });
export type TipoEtapa = z.infer<typeof TipoEtapa>;

export const TipoRequisito = z.enum(['CAMPO', 'TAREFA', 'REGRA']).meta({ id: 'TipoRequisito' });
export type TipoRequisito = z.infer<typeof TipoRequisito>;

/** Campos que um requisito CAMPO pode exigir preenchidos (`entidade.coluna`). */
export const CHAVES_CAMPO = [
  'contato.nome',
  'contato.email',
  'contato.telefone_e164',
  'contato.whatsapp_e164',
  'contato.documento',
  'contato.canal_preferido',
  'contato.data_nascimento',
  'contato.endereco',
  'contato.origem_id',
  'negocio.tipo_dispositivo',
  'negocio.dispositivo_id',
  'negocio.descricao_problema',
  'negocio.urgencia',
  'negocio.valor_estimado',
  'negocio.previsao_fechamento',
  'negocio.responsavel_id',
  'negocio.nba_adiada_ate',
] as const;

/** Regras que o código implementa (apps/api/src/modules/completude). */
export const CHAVES_REGRA = [
  'contato_tem_meio_contato',
  'contato_tem_origem',
  'consentimento_transacional',
  'dispositivo_ou_orcamento_remoto',
  'orcamento_revisado',
] as const;

export const Requisito = z
  .object({
    id: Uuid,
    tipo: TipoRequisito,
    chave: z.string(),
    descricao: z.string(),
    obrigatorio: z.boolean(),
    ordem: z.number().int(),
    titulo_tarefa: z.string().nullable(),
  })
  .meta({ id: 'Requisito' });
export type Requisito = z.infer<typeof Requisito>;

export const Etapa = z
  .object({
    id: Uuid,
    nome: z.string(),
    ordem: z.number().int(),
    tipo: TipoEtapa,
    probabilidade: z.number().int(),
    sla_horas: z.number().int().nullable(),
    cor: z.string().nullable(),
    requisitos: z.array(Requisito),
  })
  .meta({ id: 'Etapa' });
export type Etapa = z.infer<typeof Etapa>;

export const Funil = z
  .object({ id: Uuid, nome: z.string(), etapas: z.array(Etapa) })
  .meta({ id: 'Funil', description: 'O funil padrão da empresa, com as etapas em ordem' });
export type Funil = z.infer<typeof Funil>;

export const EntradaRequisito = z
  .strictObject({
    id: Uuid.optional().meta({ description: 'Requisito existente; sem id, é novo' }),
    tipo: TipoRequisito,
    chave: z.string().trim().min(1).max(60),
    descricao: z.string().trim().min(1).max(200),
    obrigatorio: z.boolean().default(true),
    titulo_tarefa: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((r, ctx) => {
    const invalida = (mensagem: string) =>
      ctx.addIssue({ code: 'custom', path: ['chave'], message: mensagem });
    if (r.tipo === 'CAMPO' && !(CHAVES_CAMPO as readonly string[]).includes(r.chave))
      invalida('Campo não suportado como requisito.');
    if (r.tipo === 'REGRA' && !(CHAVES_REGRA as readonly string[]).includes(r.chave))
      invalida('Regra desconhecida.');
    if (r.tipo === 'TAREFA') {
      if (!/^[a-z][a-z0-9_]{1,59}$/.test(r.chave))
        invalida('Chave da tarefa: letras minúsculas, números e _.');
      if (!r.titulo_tarefa)
        ctx.addIssue({
          code: 'custom',
          path: ['titulo_tarefa'],
          message: 'Informe o título da tarefa.',
        });
    }
  })
  .meta({ id: 'EntradaRequisito' });
export type EntradaRequisito = z.infer<typeof EntradaRequisito>;

export const EdicaoEtapa = z
  .strictObject({
    id: Uuid,
    nome: z.string().trim().min(1).max(80),
    ordem: z.number().int().min(1).max(100),
    probabilidade: z.number().int().min(0).max(100),
    sla_horas: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .nullable(),
    cor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Cor em hexadecimal, ex.: #0ea5e9')
      .nullable(),
    requisitos: z.array(EntradaRequisito).max(20),
  })
  .meta({ id: 'EdicaoEtapa' });
export type EdicaoEtapa = z.infer<typeof EdicaoEtapa>;

/** Todas as etapas do funil, pelo id (decisão 2): não se criam nem se apagam etapas no MVP. */
export const EdicaoFunil = z
  .strictObject({
    nome: z.string().trim().min(1).max(80).optional(),
    etapas: z.array(EdicaoEtapa).min(1).max(30),
  })
  .meta({ id: 'EdicaoFunil' });
export type EdicaoFunil = z.infer<typeof EdicaoFunil>;

export const ROTAS_FUNIL = { funil: '/v1/funil' } as const;
