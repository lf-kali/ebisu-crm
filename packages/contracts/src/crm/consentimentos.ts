import { z } from 'zod';
import { DataHora, Uuid } from '../comum/escalares.js';
import { CanalComunicacao } from './contatos.js';

// Consentimentos LGPD (plano docs/planos/f4-1-contatos.md, decisão 6): só acrescentados. Revogar
// é um registro novo com `concedido: false`; nenhum é editado nem apagado.

export const FinalidadeConsentimento = z
  .enum(['TRANSACIONAL', 'MARKETING'])
  .meta({ id: 'FinalidadeConsentimento' });

export const BaseLegal = z
  .enum(['consentimento', 'execucao_contrato', 'legitimo_interesse'])
  .meta({ id: 'BaseLegal' });

export const EntradaConsentimento = z
  .object({
    canal: CanalComunicacao,
    finalidade: FinalidadeConsentimento,
    concedido: z.boolean(),
    base_legal: BaseLegal,
    evidencia: z
      .record(z.string().max(50), z.string().max(2000))
      .refine((e) => Object.keys(e).length <= 20, 'No máximo 20 itens')
      .optional()
      .meta({ description: 'Ex.: texto exibido, url, canal da coleta' }),
  })
  .meta({ id: 'EntradaConsentimento' });
export type EntradaConsentimento = z.infer<typeof EntradaConsentimento>;

export const Consentimento = z
  .object({
    id: Uuid,
    canal: CanalComunicacao,
    finalidade: FinalidadeConsentimento,
    concedido: z.boolean(),
    base_legal: z.string(),
    evidencia: z.record(z.string(), z.unknown()).nullable(),
    coletado_em: DataHora,
  })
  .meta({ id: 'Consentimento' });
export type Consentimento = z.infer<typeof Consentimento>;

export const ListaConsentimentos = z
  .object({ dados: z.array(Consentimento) })
  .meta({ id: 'ListaConsentimentos', description: 'Histórico, do mais recente ao mais antigo' });
export type ListaConsentimentos = z.infer<typeof ListaConsentimentos>;
