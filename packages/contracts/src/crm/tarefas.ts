import { z } from 'zod';
import { DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';

// Tarefas (spec §5.3; plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisão 9). As de origem
// REQUISITO_ETAPA nascem quando o negócio entra na etapa; concluí-las atende o requisito. Concluída
// ou cancelada não muda mais; DELETE cancela.

export const StatusTarefa = z
  .enum(['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'])
  .meta({ id: 'StatusTarefa' });
export type StatusTarefa = z.infer<typeof StatusTarefa>;

export const Prioridade = z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).meta({ id: 'Prioridade' });
export const OrigemTarefa = z
  .enum(['MANUAL', 'REQUISITO_ETAPA', 'PROXIMA_ACAO', 'AUTOMACAO'])
  .meta({ id: 'OrigemTarefa' });

const Titulo = z.string().trim().min(1).max(200);
const Descricao = z.string().trim().max(5000);

export const EntradaTarefa = z
  .strictObject({
    titulo: Titulo,
    descricao: Descricao.optional(),
    prioridade: Prioridade.default('NORMAL'),
    vence_em: DataHora.optional(),
    responsavel_id: Uuid.optional(),
    contato_id: Uuid.optional(),
    negocio_id: Uuid.optional(),
  })
  .meta({ id: 'EntradaTarefa' });
export type EntradaTarefa = z.infer<typeof EntradaTarefa>;

export const EdicaoTarefa = z
  .strictObject({
    titulo: Titulo,
    descricao: Descricao.nullable(),
    prioridade: Prioridade,
    vence_em: DataHora.nullable(),
    responsavel_id: Uuid.nullable(),
    status: z.enum(['PENDENTE', 'EM_ANDAMENTO']).meta({
      description: 'Concluir e cancelar têm rotas próprias',
    }),
  })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoTarefa' });
export type EdicaoTarefa = z.infer<typeof EdicaoTarefa>;

export const Tarefa = z
  .object({
    id: Uuid,
    empresa_id: Uuid,
    contato_id: Uuid.nullable(),
    negocio_id: Uuid.nullable(),
    titulo: z.string(),
    descricao: z.string().nullable(),
    status: StatusTarefa,
    prioridade: Prioridade,
    origem: OrigemTarefa,
    requisito_id: Uuid.nullable(),
    vence_em: DataHora.nullable(),
    responsavel_id: Uuid.nullable(),
    concluida_em: DataHora.nullable(),
    created_at: DataHora,
    updated_at: DataHora,
  })
  .meta({ id: 'Tarefa' });
export type Tarefa = z.infer<typeof Tarefa>;

export const ListaTarefas = paginado(Tarefa).meta({ id: 'ListaTarefas' });
export type ListaTarefas = z.infer<typeof ListaTarefas>;

export const ConsultaTarefas = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    'filtro[status]': StatusTarefa.optional(),
    'filtro[responsavel_id]': Uuid.optional(),
    'filtro[negocio_id]': Uuid.optional(),
    'filtro[contato_id]': Uuid.optional(),
    'filtro[vence_ate]': DataHora.optional(),
  })
  .meta({
    id: 'ConsultaTarefas',
    description: 'Em ordem de vencimento; sem vencimento por último',
  });
export type ConsultaTarefas = z.infer<typeof ConsultaTarefas>;

export const ROTAS_TAREFAS = { tarefas: '/v1/tarefas' } as const;
