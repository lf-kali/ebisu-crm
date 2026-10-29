import { z } from 'zod';
import { Cnpj } from '../comum/cnpj.js';
import { DataHora, Uuid } from '../comum/escalares.js';
import { paginado } from '../comum/paginacao.js';

// Empresas da conta (spec §4 F3, §5.3; plano docs/planos/f3-4a-cadastro-empresas.md). Rotas da
// conta, sem X-Empresa-Id: exigem `config.empresa` em todas as empresas (escopo TENANT).
// Excluir desativa: a empresa some do seletor (GET /v1/eu), mas o histórico fica.

export const EntradaEmpresa = z
  .object({
    razao_social: z.string().trim().min(1).max(200),
    nome_fantasia: z.string().trim().min(1).max(120),
    cnpj: Cnpj.optional().meta({ description: 'Único na conta' }),
  })
  .meta({ id: 'EntradaEmpresa' });
export type EntradaEmpresa = z.infer<typeof EntradaEmpresa>;

export const EdicaoEmpresa = z
  .object({
    razao_social: EntradaEmpresa.shape.razao_social,
    nome_fantasia: EntradaEmpresa.shape.nome_fantasia,
    cnpj: Cnpj.nullable().meta({ description: 'null remove o CNPJ' }),
  })
  .partial()
  .refine((edicao) => Object.keys(edicao).length > 0, 'Envie ao menos um campo')
  .meta({ id: 'EdicaoEmpresa' });
export type EdicaoEmpresa = z.infer<typeof EdicaoEmpresa>;

export const Empresa = z
  .object({
    id: Uuid,
    razao_social: z.string(),
    nome_fantasia: z.string(),
    cnpj: z.string().nullable().meta({ description: 'Sem máscara' }),
    ativo: z.boolean(),
    created_at: DataHora,
  })
  .meta({ id: 'Empresa' });
export type Empresa = z.infer<typeof Empresa>;

export const ListaEmpresas = paginado(Empresa).meta({ id: 'ListaEmpresas' });
export type ListaEmpresas = z.infer<typeof ListaEmpresas>;

export const ROTAS_EMPRESAS = { empresas: '/v1/empresas' } as const;
