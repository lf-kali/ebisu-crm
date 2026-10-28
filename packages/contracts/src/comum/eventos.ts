import { z } from 'zod';
import { StatusOS } from '../bancada/index.js';
import { DecisaoOrcamento } from '../orcamentos/index.js';
import { Dinheiro, Quantidade, Uuid } from './escalares.js';

// Catálogo de eventos de domínio (spec §5.5). Dono: F2 — frentes propõem eventos novos por PR.
// Compartilhado entre API (emite e consome na transação) e worker (consome após o commit).
// Payloads mínimos: só ids e valores, nunca dados pessoais (SEG-8).

const de = <T extends z.ZodRawShape>(formato: T) => z.strictObject(formato);

export const PAYLOADS_EVENTO = {
  'lead.capturado': de({ contato_id: Uuid, captura_id: Uuid, negocio_id: Uuid.optional() }),
  'contato.atualizado': de({ contato_id: Uuid, campos: z.array(z.string()).min(1) }),
  'negocio.movido': de({ negocio_id: Uuid, de: Uuid, para: Uuid }),
  'negocio.perdido': de({ negocio_id: Uuid, de: Uuid, para: Uuid }),
  'orcamento.enviado': de({ orcamento_id: Uuid, contato_id: Uuid }),
  'orcamento.visualizado': de({ orcamento_id: Uuid }),
  'orcamento.decidido': de({
    orcamento_id: Uuid,
    decisao: DecisaoOrcamento,
    os_id: Uuid.optional(),
  }),
  'orcamento.expirado': de({ orcamento_id: Uuid }),
  'os.aberta': de({ os_id: Uuid, dispositivo_id: Uuid, contato_id: Uuid }),
  'os.status_alterado': de({ os_id: Uuid, historico_id: Uuid, de: StatusOS, para: StatusOS }),
  'os.peca_aplicada': de({ os_id: Uuid, item_id: Uuid, quantidade: Quantidade }),
  'os.entregue': de({ os_id: Uuid, total: Dinheiro, custo_total: Dinheiro }),
  'compra.recebida': de({ compra_id: Uuid }),
  'pagamento.registrado': de({ titulo_id: Uuid, pagamento_id: Uuid, valor: Dinheiro }),
  'pagamento.estornado': de({ titulo_id: Uuid, pagamento_id: Uuid, valor: Dinheiro }),
} as const;

export type TipoEvento = keyof typeof PAYLOADS_EVENTO;
export type PayloadEvento<T extends TipoEvento> = z.infer<(typeof PAYLOADS_EVENTO)[T]>;
export type EventoDominio = {
  [T in TipoEvento]: { tipo: T; payload: PayloadEvento<T> };
}[TipoEvento];

export const TIPOS_EVENTO = Object.keys(PAYLOADS_EVENTO) as TipoEvento[];

/** Valida o payload no ponto de emissão; erro aqui é bug do emissor, não do usuário. */
export function criarEvento<T extends TipoEvento>(
  tipo: T,
  payload: PayloadEvento<T>,
): EventoDominio {
  const validado = PAYLOADS_EVENTO[tipo].parse(payload) as PayloadEvento<T>;
  return { tipo, payload: validado } as EventoDominio;
}

/** Valida um evento vindo de fora do processo (ex.: job do worker). */
export function lerEvento(bruto: unknown): EventoDominio {
  const envelope = z
    .object({ tipo: z.enum(TIPOS_EVENTO as [TipoEvento, ...TipoEvento[]]), payload: z.unknown() })
    .parse(bruto);
  return criarEvento(envelope.tipo, envelope.payload as never);
}
