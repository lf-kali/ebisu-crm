import { z } from 'zod';
import { DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';
import { ResumoConta } from './auth.js';
import { AtribuicaoDoMembro, EntradaAtribuicoes } from './membros.js';

// Convites (spec §5.3; plano docs/planos/f3-4b2-convites.md). Convidar é rota da conta
// (`config.membros` e, por dar papéis, `config.rbac`). Aceitar é público: o token do link prova o
// e-mail. O token nunca aparece nestas respostas: só vai no e-mail, no fragmento do link.

export const EntradaConvite = z
  .object({
    email: z.email().max(254),
    atribuicoes: EntradaAtribuicoes.shape.atribuicoes,
  })
  .meta({ id: 'EntradaConvite' });
export type EntradaConvite = z.infer<typeof EntradaConvite>;

export const StatusEnvioConvite = z
  .enum(['PENDENTE', 'ENVIANDO', 'ENVIADO', 'FALHOU', 'CANCELADO'])
  .meta({ id: 'StatusEnvioConvite', description: 'Situação do último e-mail do convite' });

export const Convite = z
  .object({
    id: Uuid,
    email: z.email(),
    atribuicoes: z.array(AtribuicaoDoMembro.omit({ id: true })),
    expira_em: DataHora,
    expirado: z.boolean(),
    envio: StatusEnvioConvite.nullable(),
    created_at: DataHora,
  })
  .meta({ id: 'Convite' });
export type Convite = z.infer<typeof Convite>;

export const ListaConvites = paginado(Convite).meta({ id: 'ListaConvites' });
export type ListaConvites = z.infer<typeof ListaConvites>;

/** O token que veio no link (fragmento `#token=`). */
const TokenConvite = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Token inválido');

export const EntradaTokenConvite = z
  .object({ token: TokenConvite })
  .meta({ id: 'EntradaTokenConvite' });
export type EntradaTokenConvite = z.infer<typeof EntradaTokenConvite>;

export const ConsultaConvite = z
  .object({
    conta: ResumoConta.pick({ nome: true }),
    email: z.email(),
    acao: z.enum(['CRIAR_ACESSO', 'SENHA_ATUAL', 'NOVA_SENHA']).meta({
      description:
        'CRIAR_ACESSO: pedir nome e senha; SENHA_ATUAL: pedir a senha que a pessoa já usa; ' +
        'NOVA_SENHA: o e-mail ainda não foi confirmado, pedir uma senha nova (as sessões antigas ' +
        'desse usuário são encerradas)',
    }),
  })
  .meta({ id: 'ConsultaConvite' });
export type ConsultaConvite = z.infer<typeof ConsultaConvite>;

export const EntradaAceite = z
  .object({
    token: TokenConvite,
    nome: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .meta({ description: 'Obrigatório quando a ação é CRIAR_ACESSO' }),
    senha: z.string().min(1).max(256),
  })
  .meta({ id: 'EntradaAceite' });
export type EntradaAceite = z.infer<typeof EntradaAceite>;

export const ROTAS_CONVITES = {
  convites: '/v1/membros/convites',
  consultar: '/v1/auth/convites/consultar',
  aceitar: '/v1/auth/convites/aceitar',
} as const;
