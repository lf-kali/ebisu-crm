import { z } from 'zod';
import { DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';

// API keys (spec §5.1, §5.3; plano docs/planos/f3-5-api-keys-cors.md). Gestão por empresa
// (`config.api_keys`, com X-Empresa-Id). O token só aparece na resposta da criação; depois, só o
// prefixo. Dois tipos: SERVIDOR (integrações, sem Origin) e NAVEGADOR (formulário do site, só nas
// rotas /v1/publico/*, a partir das origens cadastradas).

export const TipoApiKey = z.enum(['SERVIDOR', 'NAVEGADOR']).meta({
  id: 'TipoApiKey',
  description:
    'SERVIDOR: vale nas rotas que aceitam chave e é recusada vinda de navegador (com Origin). ' +
    'NAVEGADOR: vale só em /v1/publico/*, a partir das origens cadastradas, com o escopo ' +
    'lead.create',
});
export type TipoApiKey = z.infer<typeof TipoApiKey>;

/** O único escopo da chave de navegador (decisão 2). */
export const ESCOPO_API_KEY_NAVEGADOR = 'lead.create';

const LOCAIS = new Set(['localhost', '127.0.0.1']);

/**
 * `https://host[:porta]`, como o navegador manda no Origin; `http://` só em localhost. Sem
 * caminho, consulta, credenciais ou curinga (decisão 10). Sai normalizada (`URL.origin`).
 */
export const OrigemCors = z
  .string()
  .trim()
  .max(253)
  .transform((valor, ctx) => {
    const url = URL.canParse(valor) ? new URL(valor) : null;
    const valida =
      url &&
      !valor.includes('*') &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !/\/\/[^/]*\/./.test(valor) &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && LOCAIS.has(url.hostname)));
    if (!valida) {
      ctx.addIssue({
        code: 'custom',
        message: 'Origem inválida: use https://dominio[:porta], sem caminho',
      });
      return z.NEVER;
    }
    return url.origin;
  })
  .meta({ id: 'OrigemCors', example: 'https://www.assistencia.com.br' });

const semRepetir = <T>(lista: T[]) => new Set(lista).size === lista.length;

const Nome = z.string().trim().min(1).max(80);
const Escopo = z.string().regex(/^[a-z_]+\.[a-z_]+$/, 'Escopo no formato recurso.acao');
const Escopos = z
  .array(Escopo)
  .min(1)
  .max(50)
  .refine(semRepetir, 'Escopo repetido')
  .meta({ description: 'Permissões do catálogo que quem cria tem na empresa; nunca config.*' });
const Origens = z.array(OrigemCors).min(1).max(10).refine(semRepetir, 'Origem repetida');

export const EntradaApiKey = z
  .discriminatedUnion('tipo', [
    z.object({
      tipo: z.literal('SERVIDOR'),
      nome: Nome,
      escopos: Escopos,
      expira_em: DataHora.optional(),
    }),
    z.object({
      tipo: z.literal('NAVEGADOR'),
      nome: Nome,
      escopos: z.tuple([z.literal(ESCOPO_API_KEY_NAVEGADOR)]).default([ESCOPO_API_KEY_NAVEGADOR]),
      origens_cors: Origens,
      expira_em: DataHora.optional(),
    }),
  ])
  .meta({ id: 'EntradaApiKey' });
export type EntradaApiKey = z.infer<typeof EntradaApiKey>;

export const EdicaoApiKey = z
  .object({
    nome: Nome,
    escopos: Escopos.meta({ description: 'Só na chave de servidor' }),
    origens_cors: Origens.meta({ description: 'Só na chave de navegador' }),
  })
  .partial()
  .refine((edicao) => Object.keys(edicao).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoApiKey' });
export type EdicaoApiKey = z.infer<typeof EdicaoApiKey>;

export const ApiKey = z
  .object({
    id: Uuid,
    nome: z.string(),
    tipo: TipoApiKey,
    prefixo: z
      .string()
      .meta({ description: 'Início da chave, para reconhecê-la', example: 'ebk_live_Ab12Cd34' }),
    escopos: z.array(z.string()),
    origens_cors: z.array(z.string()),
    expira_em: DataHora.nullable(),
    revogada_em: DataHora.nullable(),
    ultimo_uso: DataHora.nullable().meta({
      description: 'Atualizado no máximo uma vez por minuto',
    }),
    criado_por: Uuid.nullable().meta({ description: 'Membro que criou a chave' }),
    created_at: DataHora,
  })
  .meta({ id: 'ApiKey' });
export type ApiKey = z.infer<typeof ApiKey>;

export const ApiKeyCriada = ApiKey.extend({
  token: z
    .string()
    .nullable()
    .meta({
      description:
        'A chave completa, para o cabeçalho X-Api-Key. Só aparece aqui, uma vez; a repetição ' +
        'com a mesma Idempotency-Key devolve null',
    }),
}).meta({ id: 'ApiKeyCriada' });
export type ApiKeyCriada = z.infer<typeof ApiKeyCriada>;

export const ListaApiKeys = paginado(ApiKey).meta({ id: 'ListaApiKeys' });
export type ListaApiKeys = z.infer<typeof ListaApiKeys>;

export const ROTAS_API_KEYS = { apiKeys: '/v1/api-keys' } as const;
