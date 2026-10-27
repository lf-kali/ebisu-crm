import { CATALOGO_PERMISSOES } from './catalogo-permissoes.js';

// Papéis padrão (sistema=true), semeados por tenant. Editor de papéis = P1.
// RASCUNHO para validar com a operação: quem faz o quê e com que escopo.
//   PROPRIO = só onde é responsável/técnico · EMPRESA = empresas atribuídas · TENANT = todas.

export type Escopo = 'PROPRIO' | 'EMPRESA' | 'TENANT';

export interface DefinicaoPapel {
  readonly chave: string;
  readonly nome: string;
  readonly descricao: string;
  readonly permissoes: Readonly<Record<string, Escopo>>;
}

const todas = (escopo: Escopo, exceto: readonly string[] = []) =>
  Object.fromEntries(
    CATALOGO_PERMISSOES.filter((p) => !exceto.includes(p.chave)).map((p) => [p.chave, escopo]),
  );

const com = (escopo: Escopo, chaves: readonly string[]) =>
  Object.fromEntries(chaves.map((chave) => [chave, escopo]));

export const PAPEIS_PADRAO: readonly DefinicaoPapel[] = [
  {
    chave: 'OWNER',
    nome: 'Proprietário',
    descricao: 'Dono da conta: acesso total a todas as empresas',
    permissoes: todas('TENANT'),
  },
  {
    chave: 'ADMIN',
    nome: 'Administrador',
    descricao: 'Acesso total a todas as empresas',
    permissoes: todas('TENANT'),
  },
  {
    chave: 'GERENTE',
    nome: 'Gerente',
    descricao: 'Opera e acompanha a empresa; não gerencia acessos',
    permissoes: todas('EMPRESA', [
      'config.empresa',
      'config.membros',
      'config.rbac',
      'config.api_keys',
    ]),
  },
  {
    chave: 'ATENDENTE',
    nome: 'Atendente',
    descricao: 'Atende leads e clientes, orça, abre e entrega OS',
    permissoes: com('EMPRESA', [
      'contato.read',
      'contato.create',
      'contato.update',
      'lead.create',
      'lead.bulk_create',
      'negocio.read',
      'negocio.create',
      'negocio.update',
      'atividade.read',
      'atividade.create',
      'atividade.update',
      'tarefa.read',
      'tarefa.create',
      'tarefa.update',
      'dispositivo.read',
      'dispositivo.create',
      'dispositivo.update',
      'inspecao.read',
      'inspecao.create',
      'orcamento.read',
      'orcamento.create',
      'orcamento.update',
      'orcamento.enviar',
      'orcamento.decidir',
      'orcamento.cancelar',
      'os.read',
      'os.create',
      'os.update',
      'os.entregar',
      'estoque.read',
      'financeiro.read',
      'financeiro.receber',
      'relatorio.crm',
    ]),
  },
  {
    chave: 'TECNICO',
    nome: 'Técnico',
    descricao: 'Diagnostica e repara as OS atribuídas a ele',
    permissoes: {
      ...com('EMPRESA', [
        'contato.read',
        'dispositivo.read',
        'dispositivo.update',
        'inspecao.read',
        'inspecao.create',
        'orcamento.read',
        'orcamento.create',
        'orcamento.update',
        'atividade.create',
        'estoque.read',
      ]),
      ...com('PROPRIO', [
        'os.read',
        'os.update',
        'os.change_status',
        'os.itens',
        'tarefa.read',
        'tarefa.update',
      ]),
    },
  },
  {
    chave: 'ESTOQUISTA',
    nome: 'Estoquista',
    descricao: 'Cuida de itens, fornecedores, compras e ajustes',
    permissoes: com('EMPRESA', [
      'estoque.read',
      'estoque.create',
      'estoque.update',
      'estoque.delete',
      'estoque.ajuste',
      'compra.read',
      'compra.create',
      'compra.update',
      'compra.receber',
      'compra.cancelar',
      'financeiro.ver_custos',
      'os.read',
      'relatorio.estoque',
    ]),
  },
  {
    chave: 'FINANCEIRO',
    nome: 'Financeiro',
    descricao: 'Contas a pagar e a receber, custos e margens',
    permissoes: com('EMPRESA', [
      'financeiro.read',
      'financeiro.receber',
      'financeiro.pagar',
      'financeiro.ver_custos',
      'compra.read',
      'os.read',
      'orcamento.read',
      'contato.read',
      'estoque.read',
      'relatorio.financeiro',
      'relatorio.estoque',
    ]),
  },
];
