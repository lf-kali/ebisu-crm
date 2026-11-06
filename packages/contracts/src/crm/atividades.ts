import { z } from 'zod';
import { DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';

// Atividades: a timeline do contato e do negócio (spec §5.3; plano docs/planos/f4-2b-atividades.md).
// O autor corrige a própria atividade por 24 horas; com escopo EMPRESA ou TENANT, a qualquer tempo.
// SISTEMA e FORMULARIO nascem no código e nunca mudam.

export const TipoAtividade = z
  .enum([
    'LIGACAO',
    'WHATSAPP',
    'EMAIL',
    'SMS',
    'VISITA_LOJA',
    'REUNIAO',
    'NOTA',
    'NOTA_TECNICA',
    'FORMULARIO',
    'SISTEMA',
  ])
  .meta({ id: 'TipoAtividade' });
export type TipoAtividade = z.infer<typeof TipoAtividade>;

/** Os tipos que uma pessoa registra (decisão 2). */
export const TipoAtividadeManual = z
  .enum(['LIGACAO', 'WHATSAPP', 'EMAIL', 'SMS', 'VISITA_LOJA', 'REUNIAO', 'NOTA'])
  .meta({ id: 'TipoAtividadeManual' });

export const DirecaoAtividade = z
  .enum(['ENTRADA', 'SAIDA', 'INTERNA'])
  .meta({ id: 'DirecaoAtividade', description: 'INTERNA só na nota' });
export type DirecaoAtividade = z.infer<typeof DirecaoAtividade>;

const DirecaoDaConversa = z.enum(['ENTRADA', 'SAIDA']);
const Assunto = z.string().trim().max(200);
const Conteudo = z.string().trim().max(10_000);
const Resultado = z.string().trim().max(200).meta({ description: 'Ex.: atendeu, não atendeu' });

export const EntradaAtividade = z
  .strictObject({
    tipo: TipoAtividadeManual,
    direcao: DirecaoDaConversa.optional().meta({
      description: 'Obrigatória fora da nota; a nota é sempre INTERNA',
    }),
    assunto: Assunto.optional(),
    conteudo: Conteudo.optional(),
    resultado: Resultado.optional(),
    ocorreu_em: DataHora.optional().meta({
      description: 'Padrão: agora. Pode ser no passado; no futuro, até 5 minutos',
    }),
    contato_id: Uuid.optional(),
    negocio_id: Uuid.optional(),
  })
  .superRefine((a, ctx) => {
    if (a.tipo === 'NOTA' && a.direcao)
      ctx.addIssue({ code: 'custom', path: ['direcao'], message: 'A nota é sempre interna.' });
    if (a.tipo !== 'NOTA' && !a.direcao)
      ctx.addIssue({ code: 'custom', path: ['direcao'], message: 'Informe entrada ou saída.' });
    if (!a.contato_id && !a.negocio_id)
      ctx.addIssue({
        code: 'custom',
        path: ['contato_id'],
        message: 'Informe o contato, o negócio ou os dois.',
      });
  })
  .meta({ id: 'EntradaAtividade' });
export type EntradaAtividade = z.infer<typeof EntradaAtividade>;

/** Tipo e vínculo não mudam; `null` limpa o texto (decisão 4). */
export const EdicaoAtividade = z
  .strictObject({
    direcao: DirecaoDaConversa,
    assunto: Assunto.nullable(),
    conteudo: Conteudo.nullable(),
    resultado: Resultado.nullable(),
    ocorreu_em: DataHora,
  })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoAtividade' });
export type EdicaoAtividade = z.infer<typeof EdicaoAtividade>;

export const Atividade = z
  .object({
    id: Uuid,
    empresa_id: Uuid,
    contato_id: Uuid.nullable(),
    negocio_id: Uuid.nullable(),
    tipo: TipoAtividade,
    direcao: DirecaoAtividade,
    assunto: z.string().nullable(),
    conteudo: z.string().nullable(),
    resultado: z.string().nullable(),
    membro_id: Uuid.nullable().meta({ description: 'Autor; null quando veio do sistema' }),
    ocorreu_em: DataHora,
    registrada_em: DataHora,
  })
  .meta({ id: 'Atividade' });
export type Atividade = z.infer<typeof Atividade>;

export const ListaAtividades = paginado(Atividade).meta({ id: 'ListaAtividades' });
export type ListaAtividades = z.infer<typeof ListaAtividades>;

export const ConsultaAtividades = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    'filtro[contato_id]': Uuid.optional(),
    'filtro[negocio_id]': Uuid.optional(),
    'filtro[tipo]': TipoAtividade.optional(),
  })
  .meta({ id: 'ConsultaAtividades', description: 'Da mais recente à mais antiga (ocorreu_em)' });
export type ConsultaAtividades = z.infer<typeof ConsultaAtividades>;

export const ROTAS_ATIVIDADES = { atividades: '/v1/atividades' } as const;
