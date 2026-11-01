import type { LinkProps } from '@tanstack/react-router';
import { Building2, KeyRound, type LucideIcon, Users } from 'lucide-react';

// Seções de Configurações (plano docs/planos/f3-web-2-configuracoes.md, decisões 1 e 2). As da
// conta pedem a permissão com escopo TENANT (a API exige TENANT num papel de todas as empresas);
// API keys são da empresa atual.

export interface Secao {
  titulo: string;
  descricao: string;
  caminho: NonNullable<LinkProps['to']>;
  icone: LucideIcon;
  permissao: string;
  daConta: boolean;
}

export const SECOES: readonly Secao[] = [
  {
    titulo: 'Empresas',
    descricao: 'Lojas e filiais da conta.',
    caminho: '/configuracoes/empresas',
    icone: Building2,
    permissao: 'config.empresa',
    daConta: true,
  },
  {
    titulo: 'Membros e convites',
    descricao: 'Quem acessa a conta e com quais papéis.',
    caminho: '/configuracoes/membros',
    icone: Users,
    permissao: 'config.membros',
    daConta: true,
  },
  {
    titulo: 'API keys',
    descricao: 'Chaves para integrações e para o formulário do site.',
    caminho: '/configuracoes/api-keys',
    icone: KeyRound,
    permissao: 'config.api_keys',
    daConta: false,
  },
];

/** A pessoa vê a seção: TENANT nas da conta, qualquer escopo nas da empresa. */
export const podeVerSecao = (
  secao: Pick<Secao, 'permissao' | 'daConta'>,
  escopo: (chave: string) => string | undefined,
) => (secao.daConta ? escopo(secao.permissao) === 'TENANT' : escopo(secao.permissao) !== undefined);
