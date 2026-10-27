// Catálogo fixo de permissões `recurso.acao` (spec §5.3). Global: gravado por `pnpm db:seed`
// com o papel migrador (ebisu_app não acessa a tabela permissao).
// RASCUNHO para validar com a operação: chaves derivadas da coluna "Permissão" da spec.

export interface DefinicaoPermissao {
  readonly chave: string;
  readonly descricao: string;
}

const definir = (recurso: string, acoes: Record<string, string>): DefinicaoPermissao[] =>
  Object.entries(acoes).map(([acao, descricao]) => ({ chave: `${recurso}.${acao}`, descricao }));

export const CATALOGO_PERMISSOES: readonly DefinicaoPermissao[] = [
  ...definir('config', {
    empresa: 'Editar dados da empresa',
    membros: 'Convidar e gerenciar membros',
    rbac: 'Atribuir papéis',
    api_keys: 'Gerenciar API keys',
    crm: 'Configurar funil, origens e motivos de perda',
    bancada: 'Configurar checklists e tipos de acessório',
    notificacoes: 'Configurar modelos de mensagem',
  }),
  ...definir('contato', {
    read: 'Ver contatos',
    create: 'Criar contatos',
    update: 'Editar contatos e consentimentos',
    delete: 'Excluir contatos',
  }),
  ...definir('lgpd', { anonimizar: 'Anonimizar contato (LGPD)' }),
  ...definir('lead', {
    create: 'Capturar lead',
    bulk_create: 'Criar leads em massa e importar CSV',
    bulk_update: 'Atualizar leads em massa',
    bulk_delete: 'Excluir leads em massa',
  }),
  ...definir('negocio', {
    read: 'Ver negócios e próximas ações',
    create: 'Criar negócios',
    update: 'Mover, perder e nutrir negócios',
    delete: 'Excluir negócios',
  }),
  ...definir('atividade', {
    read: 'Ver atividades',
    create: 'Registrar atividades',
    update: 'Editar atividades',
    delete: 'Excluir atividades',
  }),
  ...definir('tarefa', {
    read: 'Ver tarefas',
    create: 'Criar tarefas',
    update: 'Editar e concluir tarefas',
    delete: 'Excluir tarefas',
  }),
  ...definir('dispositivo', {
    read: 'Ver dispositivos e prontuário',
    create: 'Cadastrar dispositivos',
    update: 'Editar dispositivos e trocar proprietário',
    delete: 'Excluir dispositivos',
  }),
  ...definir('inspecao', {
    read: 'Ver inspeções',
    create: 'Registrar inspeção de entrada/saída',
  }),
  ...definir('orcamento', {
    read: 'Ver orçamentos',
    create: 'Criar orçamentos',
    update: 'Editar rascunho e revisar orçamentos',
    delete: 'Excluir rascunhos',
    enviar: 'Enviar orçamento ao cliente',
    decidir: 'Registrar decisão do cliente no balcão',
    cancelar: 'Cancelar orçamento',
  }),
  ...definir('os', {
    read: 'Ver ordens de serviço',
    create: 'Abrir OS',
    update: 'Editar OS e registrar notas',
    delete: 'Excluir OS',
    change_status: 'Mudar status, técnico e garantia da OS',
    itens: 'Gerenciar itens e aplicar peças',
    entregar: 'Entregar OS ao cliente',
  }),
  ...definir('estoque', {
    read: 'Ver itens e movimentos',
    create: 'Cadastrar itens e fornecedores',
    update: 'Editar itens e fornecedores',
    delete: 'Excluir itens e fornecedores',
    ajuste: 'Ajustar e estornar estoque',
  }),
  ...definir('compra', {
    read: 'Ver compras',
    create: 'Criar compras',
    update: 'Editar rascunho de compra',
    receber: 'Receber compra',
    cancelar: 'Cancelar compra',
  }),
  ...definir('financeiro', {
    read: 'Ver contas a pagar e a receber',
    receber: 'Registrar e estornar recebimentos',
    pagar: 'Registrar e estornar pagamentos',
    ver_custos: 'Ver custos e margens',
  }),
  ...definir('relatorio', {
    crm: 'Relatórios de funil, origens, quadrantes e orçamentos',
    bancada: 'Relatórios da bancada',
    financeiro: 'Relatórios financeiros',
    estoque: 'Relatórios de estoque',
  }),
];

export const CHAVES_PERMISSAO: ReadonlySet<string> = new Set(
  CATALOGO_PERMISSOES.map((p) => p.chave),
);
