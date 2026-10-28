// Interfaces dos provedores plugáveis (spec §5.7, D-T11). Adapters reais (WhatsApp Cloud, Zenvia,
// Resend, S3) e falsos (dev/test) implementam estas interfaces.

export type CanalMensagem = 'WHATSAPP' | 'EMAIL' | 'SMS';

export interface MensagemSaida {
  destino: string;
  conteudo?: string;
  template?: { nome: string; idioma: string; variaveis: string[] };
  assunto?: string;
  chaveIdempotencia: string;
}

export interface StatusWebhook {
  provedorMsgId: string;
  status: 'ENTREGUE' | 'LIDA' | 'FALHOU';
  erro?: string;
}

export interface ProvedorMensagem {
  readonly canal: CanalMensagem;
  enviar(msg: MensagemSaida): Promise<{ provedorMsgId: string }>;
  interpretarWebhook(req: {
    headers: Record<string, string>;
    corpo: unknown;
  }): Promise<StatusWebhook[]>;
  /** WhatsApp: janela de 24h para mensagem livre (NOT-5). */
  dentroDaJanela?(destino: string): Promise<boolean>;
}

export interface Armazenamento {
  urlUpload(
    chave: string,
    mime: string,
    tamanhoMax: number,
  ): Promise<{ url: string; campos?: Record<string, string> }>;
  urlDownload(chave: string, expiraEmSeg: number): Promise<string>;
}
