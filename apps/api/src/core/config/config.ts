import { z } from 'zod';

// Configuração da API vinda do ambiente (.env na raiz em dev). Validada na subida: faltou um
// segredo, a API não sobe (nunca um valor padrão para segredo).

const lista = z
  .string()
  .transform((valor) =>
    valor
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

const Esquema = z.object({
  /** Papel ebisu_auth: usuario/refresh_token e leitura de vínculos (SEG-6). */
  DATABASE_URL_AUTH: z.url(),
  /** Papel ebisu_app: dados sob RLS, sempre via comTenant (SEG-1, SEG-6). */
  DATABASE_URL_APP: z.url(),
  REDIS_URL: z.url(),
  /** Chave privada Ed25519 (PKCS#8 PEM) que assina o access token. Aceita "\n" escapado. */
  AUTH_JWT_CHAVE_PRIVADA: z
    .string()
    .min(1)
    .transform((pem) => pem.replaceAll('\\n', '\n')),
  AUTH_JWT_KID: z.string().min(1),
  /** Origens do web autorizadas a usar o cookie de refresh (checagem de Origin, CSRF). */
  WEB_ORIGENS: lista,
});

export type Config = z.infer<typeof Esquema>;

export const CONFIG = Symbol('CONFIG');

export class ConfigInvalidaError extends Error {
  constructor(campos: string[]) {
    // Só os nomes: o valor de um segredo nunca vai para log nem mensagem.
    super(`Configuração inválida ou ausente: ${campos.join(', ')}`);
    this.name = 'ConfigInvalidaError';
  }
}

export function lerConfig(env: Record<string, string | undefined>): Config {
  const resultado = Esquema.safeParse(env);
  if (!resultado.success)
    throw new ConfigInvalidaError([
      ...new Set(resultado.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return resultado.data;
}
