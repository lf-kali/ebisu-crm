import { z } from 'zod';
import { Uuid } from '../comum/escalares.js';

// Autenticação (spec D-T05, §5.1, §5.3; implementação na F3). Contrato escrito antes da API para o
// web (F12) usar via MSW; a F3 implementa contra estes schemas.
//
// Sessão = access token JWT de 15 min (Authorization: Bearer) + refresh token rotativo em cookie
// httpOnly SameSite=Strict, que o corpo nunca carrega. Login, refresh e troca de conta devolvem a
// mesma RespostaSessao.
//
// Conta = tenant. O e-mail é único no sistema, e o mesmo usuário pode ser membro de várias contas.
// O login abre a sessão na conta usada por último (ou na mais antiga) e lista todas. Com mais de
// uma, o web mostra a escolha logo após o login, e escolher outra é trocar de conta
// (POST /v1/auth/trocar-conta), o que emite novos tokens.

export const EntradaLogin = z
  .object({
    email: z.email().max(254),
    // Sem regra de tamanho mínimo no login: a política de senha vale no cadastro e na troca.
    senha: z.string().min(1).max(256),
  })
  .meta({ id: 'EntradaLogin' });
export type EntradaLogin = z.infer<typeof EntradaLogin>;

export const ResumoConta = z
  .object({ tenant_id: Uuid, nome: z.string(), slug: z.string() })
  .meta({ id: 'ResumoConta', description: 'Conta (tenant) da qual o usuário é membro ativo' });
export type ResumoConta = z.infer<typeof ResumoConta>;

export const RespostaSessao = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal('Bearer'),
    expira_em: z
      .number()
      .int()
      .positive()
      .meta({ description: 'Validade do access token em segundos (900 = 15 min, D-T05)' }),
    conta: ResumoConta.meta({ description: 'Conta desta sessão' }),
    contas: z
      .array(ResumoConta)
      .min(1)
      .meta({ description: 'Todas as contas ativas do usuário, incluindo a da sessão' }),
  })
  .meta({ id: 'RespostaSessao' });
export type RespostaSessao = z.infer<typeof RespostaSessao>;

export const EntradaTrocarConta = z.object({ tenant_id: Uuid }).meta({ id: 'EntradaTrocarConta' });
export type EntradaTrocarConta = z.infer<typeof EntradaTrocarConta>;

/** Rotas de auth (§5.3). Refresh e logout não têm corpo: usam o cookie do refresh token. */
export const ROTAS_AUTH = {
  login: '/v1/auth/login',
  refresh: '/v1/auth/refresh',
  logout: '/v1/auth/logout',
  trocarConta: '/v1/auth/trocar-conta',
  eu: '/v1/eu',
} as const;
