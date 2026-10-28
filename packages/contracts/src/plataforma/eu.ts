import { z } from 'zod';
import { Uuid } from '../comum/escalares.js';
import { ResumoConta } from './auth.js';

// GET /v1/eu (spec §5.3, F3): quem está logado, em qual conta, e o que pode fazer em cada empresa.
// É a base do seletor de empresa e dos menus por permissão no web (F12). O web só esconde o que
// não tem acesso; quem nega de fato é a API (403 sem_permissao, empresa_nao_autorizada).

export const EscopoPermissao = z.enum(['PROPRIO', 'EMPRESA', 'TENANT']).meta({
  id: 'EscopoPermissao',
  description: 'PROPRIO = só onde é responsável; EMPRESA = esta empresa; TENANT = todas',
});
export type EscopoPermissao = z.infer<typeof EscopoPermissao>;

/** Chave `recurso.acao` do catálogo de permissões (seed da F1, ampliado pelas frentes). */
export const ChavePermissao = z
  .string()
  .regex(/^[a-z_]+\.[a-z_]+$/, 'Permissão no formato recurso.acao')
  .meta({ id: 'ChavePermissao', example: 'contato.read' });

export const EmpresaDoMembro = z
  .object({
    id: Uuid,
    nome_fantasia: z.string(),
    razao_social: z.string(),
    logo_url: z.string().nullable(),
    permissoes: z.record(ChavePermissao, EscopoPermissao).meta({
      description:
        'Permissões efetivas nesta empresa (união dos papéis atribuídos a ela e dos atribuídos a todas as empresas, com o maior escopo)',
    }),
  })
  .meta({ id: 'EmpresaDoMembro' });
export type EmpresaDoMembro = z.infer<typeof EmpresaDoMembro>;

export const RespostaEu = z
  .object({
    usuario: z.object({
      id: Uuid,
      nome: z.string(),
      email: z.email(),
      avatar_url: z.string().nullable(),
    }),
    membro: z.object({ id: Uuid, cargo: z.string().nullable() }),
    conta: ResumoConta,
    empresas: z.array(EmpresaDoMembro).meta({
      description:
        'Empresas ativas em que o membro tem papel; o valor de X-Empresa-Id deve ser uma delas',
    }),
  })
  .meta({ id: 'RespostaEu' });
export type RespostaEu = z.infer<typeof RespostaEu>;
