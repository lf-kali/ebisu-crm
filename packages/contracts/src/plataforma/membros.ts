import { z } from 'zod';
import { DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';
import { ChavePermissao, EscopoPermissao } from './eu.js';

// Membros e papéis da conta (spec §5.3; plano docs/planos/f3-4b1-membros-papeis.md). Rotas da
// conta, sem X-Empresa-Id: membros pedem `config.membros`; papéis e atribuições, `config.rbac`.
// Só um dono (OWNER) dá ou tira o papel de dono, e a conta nunca fica sem um dono ativo.

export const StatusMembro = z
  .enum(['CONVIDADO', 'ATIVO', 'SUSPENSO'])
  .meta({ id: 'StatusMembro', description: 'Membro suspenso não entra na conta' });
export type StatusMembro = z.infer<typeof StatusMembro>;

export const AtribuicaoDoMembro = z
  .object({
    id: Uuid,
    papel: z.object({ id: Uuid, chave: z.string(), nome: z.string() }),
    empresa_id: Uuid.nullable().meta({ description: 'null = todas as empresas da conta' }),
  })
  .meta({ id: 'AtribuicaoDoMembro' });
export type AtribuicaoDoMembro = z.infer<typeof AtribuicaoDoMembro>;

export const Membro = z
  .object({
    id: Uuid,
    usuario: z.object({ nome: z.string(), email: z.email() }),
    status: StatusMembro,
    cargo: z.string().nullable(),
    atribuicoes: z.array(AtribuicaoDoMembro),
    created_at: DataHora,
  })
  .meta({ id: 'Membro' });
export type Membro = z.infer<typeof Membro>;

export const ListaMembros = paginado(Membro).meta({ id: 'ListaMembros' });
export type ListaMembros = z.infer<typeof ListaMembros>;

export const EdicaoMembro = z
  .object({
    cargo: z.string().trim().min(1).max(120).nullable().meta({ description: 'null remove' }),
    status: z.enum(['ATIVO', 'SUSPENSO']),
  })
  .partial()
  .refine((edicao) => Object.keys(edicao).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoMembro' });
export type EdicaoMembro = z.infer<typeof EdicaoMembro>;

const NovaAtribuicao = z.object({
  papel_id: Uuid,
  empresa_id: Uuid.nullable().meta({ description: 'null = todas as empresas da conta' }),
});

export const EntradaAtribuicoes = z
  .object({
    atribuicoes: z
      .array(NovaAtribuicao)
      .min(1)
      .max(50)
      .refine(
        (lista) =>
          new Set(lista.map((a) => `${a.papel_id}:${a.empresa_id ?? '*'}`)).size === lista.length,
        'Atribuição repetida',
      ),
  })
  .meta({
    id: 'EntradaAtribuicoes',
    description: 'Substitui todas as atribuições do membro. OWNER só em todas as empresas',
  });
export type EntradaAtribuicoes = z.infer<typeof EntradaAtribuicoes>;

export const Papel = z
  .object({
    id: Uuid,
    chave: z.string(),
    nome: z.string(),
    descricao: z.string().nullable(),
    sistema: z.boolean().meta({ description: 'Papel padrão, semeado com a conta' }),
    permissoes: z.record(ChavePermissao, EscopoPermissao),
  })
  .meta({ id: 'Papel' });
export type Papel = z.infer<typeof Papel>;

export const ListaPapeis = z.object({ dados: z.array(Papel) }).meta({ id: 'ListaPapeis' });
export type ListaPapeis = z.infer<typeof ListaPapeis>;

export const ROTAS_MEMBROS = { membros: '/v1/membros', papeis: '/v1/papeis' } as const;
