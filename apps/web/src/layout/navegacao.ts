import {
  Boxes,
  Briefcase,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  Smartphone,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';

import type { LinkProps } from '@tanstack/react-router';

/** Só caminhos que existem no roteador (tipado pelo routeTree gerado). */
type CaminhoModulo = NonNullable<LinkProps['to']>;

// Módulos do menu (spec §4 F13). `permissao` esconde o item sem acesso (filtro entra no PR 3).
export interface ItemNavegacao {
  rotulo: string;
  caminho: CaminhoModulo;
  icone: LucideIcon;
  permissao?: string;
}

export const NAVEGACAO: readonly ItemNavegacao[] = [
  { rotulo: 'Painel', caminho: '/', icone: LayoutDashboard },
  { rotulo: 'Contatos', caminho: '/contatos', icone: Users, permissao: 'contato.read' },
  { rotulo: 'Negócios', caminho: '/negocios', icone: Briefcase, permissao: 'negocio.read' },
  {
    rotulo: 'Dispositivos',
    caminho: '/dispositivos',
    icone: Smartphone,
    permissao: 'dispositivo.read',
  },
  { rotulo: 'Orçamentos', caminho: '/orcamentos', icone: FileText, permissao: 'orcamento.read' },
  { rotulo: 'Bancada', caminho: '/bancada', icone: Wrench, permissao: 'os.read' },
  { rotulo: 'Estoque', caminho: '/estoque', icone: Boxes, permissao: 'estoque.read' },
  { rotulo: 'Financeiro', caminho: '/financeiro', icone: Wallet, permissao: 'financeiro.read' },
  { rotulo: 'Configurações', caminho: '/configuracoes', icone: Settings },
];
