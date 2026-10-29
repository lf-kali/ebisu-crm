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
  const transporte = createTransport({ host: opcoes.host, port: opcoes.port, secure: false });
  return {
    async enviar({ para, assunto, texto }) {
      await transporte.sendMail({ from: opcoes.de, to: para, subject: assunto, text: texto });
    },
  };
}
