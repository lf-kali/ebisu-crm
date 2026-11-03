import { z } from 'zod';
import { Data, DataHora, DinheiroNaoNegativo, Uuid, VersaoRegistro } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';
import { TipoRequisito } from './funil.js';

// Negócios (spec §5.3; plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 3 a 8). Etapa,
// status, completude e datas de fechamento só aparecem na resposta: mudam pelos comandos mover,
// perder e nutrir. PATCH e comandos exigem `versao_registro` (D-A08).

export const InteresseNegocio = z
  .enum([
    'REPARO',
    'DIAGNOSTICO',
    'MANUTENCAO_PREVENTIVA',
    'RECUPERACAO_DADOS',
    'UPGRADE',
    'VENDA_PRODUTO',
    'OUTRO',
  ])
  .meta({ id: 'InteresseNegocio' });
export type InteresseNegocio = z.infer<typeof InteresseNegocio>;

export const TipoDispositivo = z
  .enum(['CELULAR', 'TABLET', 'NOTEBOOK', 'DESKTOP', 'ALL_IN_ONE', 'OUTRO'])
  .meta({ id: 'TipoDispositivo' });
export type TipoDispositivo = z.infer<typeof TipoDispositivo>;

export const Urgencia = z.enum(['BAIXA', 'MEDIA', 'ALTA']).meta({ id: 'Urgencia' });
export const StatusNegocio = z
  .enum(['ABERTO', 'GANHO', 'PERDIDO', 'NUTRICAO'])
  .meta({ id: 'StatusNegocio' });
export type StatusNegocio = z.infer<typeof StatusNegocio>;

const camposEditaveis = {
  titulo: z.string().trim().min(1).max(200),
  interesse: InteresseNegocio,
  tipo_dispositivo: TipoDispositivo,
  dispositivo_id: Uuid,
  descricao_problema: z.string().trim().max(5000),
  urgencia: Urgencia,
  valor_estimado: DinheiroNaoNegativo,
  previsao_fechamento: Data,
  responsavel_id: Uuid,
};

export const EntradaNegocio = z
  .strictObject({
    contato_id: Uuid,
    titulo: camposEditaveis.titulo,
    interesse: InteresseNegocio.default('REPARO'),
    tipo_dispositivo: TipoDispositivo.optional(),
    dispositivo_id: Uuid.optional(),
    descricao_problema: camposEditaveis.descricao_problema.optional(),
    urgencia: Urgencia.optional(),
    valor_estimado: DinheiroNaoNegativo.optional(),
    previsao_fechamento: Data.optional(),
    responsavel_id: Uuid.optional(),
  })
  .meta({ id: 'EntradaNegocio' });
export type EntradaNegocio = z.infer<typeof EntradaNegocio>;

/** PATCH: `null` remove um campo opcional; o contato do negócio não muda. */
export const EdicaoNegocio = z
  .strictObject({
    versao_registro: VersaoRegistro,
    titulo: camposEditaveis.titulo.optional(),
    interesse: InteresseNegocio.optional(),
    tipo_dispositivo: TipoDispositivo.nullable().optional(),
    dispositivo_id: Uuid.nullable().optional(),
    descricao_problema: camposEditaveis.descricao_problema.nullable().optional(),
    urgencia: Urgencia.nullable().optional(),
    valor_estimado: DinheiroNaoNegativo.nullable().optional(),
    previsao_fechamento: Data.nullable().optional(),
    responsavel_id: Uuid.nullable().optional(),
  })
  .refine((e) => Object.keys(e).length > 1, 'Envie ao menos um campo além da versão')
  .meta({ id: 'EdicaoNegocio' });
export type EdicaoNegocio = z.infer<typeof EdicaoNegocio>;

export const Negocio = z
  .object({
    id: Uuid,
    empresa_id: Uuid,
    contato_id: Uuid,
    funil_id: Uuid,
    etapa_id: Uuid,
    titulo: z.string(),
    interesse: InteresseNegocio,
    tipo_dispositivo: TipoDispositivo.nullable(),
    dispositivo_id: Uuid.nullable(),
    descricao_problema: z.string().nullable(),
    urgencia: Urgencia.nullable(),
    valor_estimado: DinheiroNaoNegativo.nullable(),
    previsao_fechamento: Data.nullable(),
    status: StatusNegocio,
    motivo_perda_id: Uuid.nullable(),
    responsavel_id: Uuid.nullable(),
    entrou_etapa_em: DataHora,
    fechado_em: DataHora.nullable(),
    completude: z
      .number()
      .int()
      .meta({ description: 'Requisitos da etapa atual atendidos, 0–100' }),
    nba_adiada_ate: DataHora.nullable(),
    versao_registro: VersaoRegistro,
    created_at: DataHora,
    updated_at: DataHora,
  })
  .meta({ id: 'Negocio' });
export type Negocio = z.infer<typeof Negocio>;

export const RequisitoDoNegocio = z
  .object({
    id: Uuid,
    tipo: TipoRequisito,
    chave: z.string(),
    descricao: z.string(),
    obrigatorio: z.boolean(),
    atendido: z.boolean(),
  })
  .meta({ id: 'RequisitoDoNegocio' });
export type RequisitoDoNegocio = z.infer<typeof RequisitoDoNegocio>;

/** Com os requisitos da etapa atual: o "o que falta" para avançar. */
export const NegocioDetalhado = Negocio.extend({ requisitos: z.array(RequisitoDoNegocio) }).meta({
  id: 'NegocioDetalhado',
});
export type NegocioDetalhado = z.infer<typeof NegocioDetalhado>;

export const ListaNegocios = paginado(Negocio).meta({ id: 'ListaNegocios' });
export type ListaNegocios = z.infer<typeof ListaNegocios>;

export const ConsultaNegocios = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    q: z.string().trim().min(2).max(100).optional().meta({ description: 'Trecho do título' }),
    'filtro[etapa_id]': Uuid.optional(),
    'filtro[status]': StatusNegocio.optional(),
    'filtro[responsavel_id]': Uuid.optional(),
    'filtro[contato_id]': Uuid.optional(),
  })
  .meta({ id: 'ConsultaNegocios' });
export type ConsultaNegocios = z.infer<typeof ConsultaNegocios>;

export const EntradaMoverNegocio = z
  .strictObject({ etapa_id: Uuid, versao_registro: VersaoRegistro })
  .meta({ id: 'EntradaMoverNegocio' });
export type EntradaMoverNegocio = z.infer<typeof EntradaMoverNegocio>;

export const EntradaPerderNegocio = z
  .strictObject({ motivo_perda_id: Uuid, versao_registro: VersaoRegistro })
  .meta({ id: 'EntradaPerderNegocio' });
export type EntradaPerderNegocio = z.infer<typeof EntradaPerderNegocio>;

export const EntradaNutrirNegocio = z
  .strictObject({
    nba_adiada_ate: DataHora.meta({ description: 'Quando reativar; precisa estar no futuro' }),
    versao_registro: VersaoRegistro,
  })
  .meta({ id: 'EntradaNutrirNegocio' });
export type EntradaNutrirNegocio = z.infer<typeof EntradaNutrirNegocio>;

export const ROTAS_NEGOCIOS = { negocios: '/v1/negocios' } as const;
