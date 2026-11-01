import { z } from 'zod';
import { Uuid } from '../comum/escalares.js';

// Origens de lead e motivos de perda da empresa (spec §5.3; plano docs/planos/f4-1-contatos.md,
// decisão 7). Configuração com `config.crm`; leitura também com `contato.read` (as telas listam
// as opções). Excluir desativa: contatos e negócios continuam apontando para o registro.

export const TipoOrigem = z
  .enum([
    'FORMULARIO_SITE',
    'ORCAMENTO_ONLINE',
    'WHATSAPP',
    'INSTAGRAM',
    'FACEBOOK',
    'GOOGLE_ADS',
    'INDICACAO',
    'BALCAO',
    'TELEFONE',
    'IMPORTACAO',
    'MANUAL',
    'OUTRO',
  ])
  .meta({ id: 'TipoOrigem' });
export type TipoOrigem = z.infer<typeof TipoOrigem>;

const Nome = z.string().trim().min(1).max(80);

export const EntradaOrigem = z
  .object({ nome: Nome, tipo: TipoOrigem })
  .meta({ id: 'EntradaOrigem' });
export type EntradaOrigem = z.infer<typeof EntradaOrigem>;

export const EdicaoOrigem = z
  .object({ nome: Nome, tipo: TipoOrigem, ativo: z.boolean() })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoOrigem' });
export type EdicaoOrigem = z.infer<typeof EdicaoOrigem>;

export const Origem = z
  .object({ id: Uuid, nome: z.string(), tipo: TipoOrigem, ativo: z.boolean() })
  .meta({ id: 'Origem' });
export type Origem = z.infer<typeof Origem>;

export const ListaOrigens = z.object({ dados: z.array(Origem) }).meta({ id: 'ListaOrigens' });
export type ListaOrigens = z.infer<typeof ListaOrigens>;

export const EntradaMotivoPerda = z.object({ nome: Nome }).meta({ id: 'EntradaMotivoPerda' });
export type EntradaMotivoPerda = z.infer<typeof EntradaMotivoPerda>;

export const EdicaoMotivoPerda = z
  .object({ nome: Nome, ativo: z.boolean() })
  .partial()
  .refine((e) => Object.keys(e).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoMotivoPerda' });
export type EdicaoMotivoPerda = z.infer<typeof EdicaoMotivoPerda>;

export const MotivoPerda = z
  .object({ id: Uuid, nome: z.string(), ativo: z.boolean() })
  .meta({ id: 'MotivoPerda' });
export type MotivoPerda = z.infer<typeof MotivoPerda>;

export const ListaMotivosPerda = z
  .object({ dados: z.array(MotivoPerda) })
  .meta({ id: 'ListaMotivosPerda' });
export type ListaMotivosPerda = z.infer<typeof ListaMotivosPerda>;

export const ROTAS_ORIGENS = { origens: '/v1/origens', motivosPerda: '/v1/motivos-perda' } as const;
