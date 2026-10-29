import { createTransport } from 'nodemailer';

// Quem entrega o e-mail. Em dev, SMTP no Mailpit do docker compose; o provedor de verdade
// (Resend) entra na F10 com outro adaptador desta mesma interface.

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
}

export interface Remetente {
  enviar(mensagem: MensagemEmail): Promise<void>;
}

export function remetenteSmtp(opcoes: { host: string; port: number; de: string }): Remetente {
  // Prazos curtos: um SMTP travado não pode passar do prazo do worker (5 min por lote), senão
  // outro worker reivindica a linha e o e-mail sai duas vezes.
  const transporte = createTransport({
    host: opcoes.host,
    port: opcoes.port,
    secure: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return {
    async enviar({ para, assunto, texto }) {
      await transporte.sendMail({ from: opcoes.de, to: para, subject: assunto, text: texto });
    },
  };
}
