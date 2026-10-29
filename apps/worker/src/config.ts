import { z } from 'zod';

// Configuração do worker vinda do ambiente (.env na raiz em dev). Validada na subida.

const Esquema = z.object({
  /** Papel ebisu_app: tudo sob RLS, conta por conta (SEG-1, SEG-6). */
  DATABASE_URL_APP: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  /** Remetente dos e-mails do sistema, ex.: "ebisuCRM <nao-responda@ebisu.local>". */
  SMTP_REMETENTE: z.string().min(3),
  /** Endereço do web: base dos links dos e-mails (ex.: convite). */
  WEB_URL: z.url(),
  /** Intervalo entre rodadas do outbox de e-mail. */
  EMAIL_INTERVALO_MS: z.coerce.number().int().min(200).default(5_000),
});

export type ConfigWorker = z.infer<typeof Esquema>;

export const CONFIG_WORKER = Symbol('CONFIG_WORKER');

export function lerConfigWorker(env: Record<string, string | undefined>): ConfigWorker {
  const resultado = Esquema.safeParse(env);
  if (!resultado.success)
    // Só os nomes: o valor de uma variável (ex.: a senha na URL do banco) nunca vai para log.
    throw new Error(
      `Configuração do worker inválida ou ausente: ${[
        ...new Set(resultado.error.issues.map((issue) => String(issue.path[0]))),
      ].join(', ')}`,
    );
  return resultado.data;
}
