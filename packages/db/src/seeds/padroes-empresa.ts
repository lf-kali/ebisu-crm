// Padrões semeados por empresa (tabelas com empresa_id).
// RASCUNHO para validar com a operação. O funil segue docs/README.md §3.1.

export const ORIGENS_LEAD: ReadonlyArray<{ nome: string; tipo: string }> = [
  { nome: 'Formulário do site', tipo: 'FORMULARIO_SITE' },
  { nome: 'Orçamento online', tipo: 'ORCAMENTO_ONLINE' },
  { nome: 'WhatsApp', tipo: 'WHATSAPP' },
  { nome: 'Instagram', tipo: 'INSTAGRAM' },
  { nome: 'Facebook', tipo: 'FACEBOOK' },
  { nome: 'Google Ads', tipo: 'GOOGLE_ADS' },
  { nome: 'Indicação', tipo: 'INDICACAO' },
  { nome: 'Balcão', tipo: 'BALCAO' },
  { nome: 'Telefone', tipo: 'TELEFONE' },
  { nome: 'Importação', tipo: 'IMPORTACAO' },
];

export const MOTIVOS_PERDA: readonly string[] = [
  'Preço acima do esperado',
  'Prazo longo',
  'Fechou com concorrente',
  'Desistiu do reparo',
  'Comprou aparelho novo',
  'Sem resposta do cliente',
  'Reparo inviável',
  'Peça indisponível',
  'Outro',
];

export interface DefinicaoRequisito {
  readonly tipo: 'CAMPO' | 'TAREFA' | 'REGRA';
  /** CAMPO: caminho `entidade.coluna`; TAREFA/REGRA: chave tratada no código (F4/F11). */
  readonly chave: string;
  readonly descricao: string;
  readonly obrigatorio?: boolean;
  readonly titulo_tarefa?: string;
}

export interface DefinicaoEtapa {
  readonly nome: string;
  readonly ordem: number;
  readonly tipo: 'ABERTA' | 'GANHO' | 'PERDIDO' | 'NUTRICAO';
  readonly probabilidade: number;
  readonly sla_horas?: number;
  readonly cor: string;
  readonly requisitos: readonly DefinicaoRequisito[];
}

export const FUNIL_PADRAO: { readonly nome: string; readonly etapas: readonly DefinicaoEtapa[] } = {
  nome: 'Funil padrão',
  etapas: [
    {
      nome: 'Novo contato',
      ordem: 1,
      tipo: 'ABERTA',
      probabilidade: 5,
      sla_horas: 2,
      cor: '#64748b',
      requisitos: [
        { tipo: 'CAMPO', chave: 'contato.nome', descricao: 'Nome do contato' },
        { tipo: 'REGRA', chave: 'contato_tem_meio_contato', descricao: 'Telefone ou e-mail' },
        { tipo: 'REGRA', chave: 'contato_tem_origem', descricao: 'Origem do lead' },
      ],
    },
    {
      nome: 'Qualificação',
      ordem: 2,
      tipo: 'ABERTA',
      probabilidade: 20,
      sla_horas: 24,
      cor: '#0ea5e9',
      requisitos: [
        { tipo: 'CAMPO', chave: 'contato.canal_preferido', descricao: 'Canal preferido' },
        {
          tipo: 'REGRA',
          chave: 'consentimento_transacional',
          descricao: 'Consentimento para avisos no canal preferido',
        },
        { tipo: 'CAMPO', chave: 'negocio.tipo_dispositivo', descricao: 'Tipo do dispositivo' },
        { tipo: 'CAMPO', chave: 'negocio.descricao_problema', descricao: 'Problema ou interesse' },
        { tipo: 'CAMPO', chave: 'negocio.urgencia', descricao: 'Urgência', obrigatorio: false },
      ],
    },
    {
      nome: 'Diagnóstico / Orçamento',
      ordem: 3,
      tipo: 'ABERTA',
      probabilidade: 40,
      sla_horas: 48,
      cor: '#8b5cf6',
      requisitos: [
        {
          tipo: 'REGRA',
          chave: 'dispositivo_ou_orcamento_remoto',
          descricao: 'Dispositivo cadastrado ou orçamento remoto',
        },
        {
          tipo: 'TAREFA',
          chave: 'elaborar_orcamento',
          descricao: 'Orçamento elaborado',
          titulo_tarefa: 'Elaborar orçamento',
        },
      ],
    },
    {
      nome: 'Orçamento enviado',
      ordem: 4,
      tipo: 'ABERTA',
      probabilidade: 60,
      sla_horas: 48,
      cor: '#f59e0b',
      requisitos: [
        {
          tipo: 'TAREFA',
          chave: 'follow_up_orcamento',
          descricao: 'Follow-up registrado',
          titulo_tarefa: 'Fazer follow-up do orçamento',
        },
      ],
    },
    {
      nome: 'Negociação',
      ordem: 5,
      tipo: 'ABERTA',
      probabilidade: 75,
      sla_horas: 72,
      cor: '#f97316',
      requisitos: [
        {
          tipo: 'TAREFA',
          chave: 'registrar_objecao',
          descricao: 'Objeção registrada',
          titulo_tarefa: 'Registrar objeção do cliente',
        },
        {
          tipo: 'REGRA',
          chave: 'orcamento_revisado',
          descricao: 'Orçamento revisado, se necessário',
          obrigatorio: false,
        },
      ],
    },
    { nome: 'Ganho', ordem: 6, tipo: 'GANHO', probabilidade: 100, cor: '#16a34a', requisitos: [] },
    {
      nome: 'Perdido',
      ordem: 7,
      tipo: 'PERDIDO',
      probabilidade: 0,
      cor: '#dc2626',
      requisitos: [],
    },
    {
      nome: 'Nutrição',
      ordem: 8,
      tipo: 'NUTRICAO',
      probabilidade: 0,
      cor: '#a3a3a3',
      requisitos: [
        { tipo: 'CAMPO', chave: 'negocio.nba_adiada_ate', descricao: 'Data de reativação' },
      ],
    },
  ],
};

// Corpo em Handlebars; as variáveis disponíveis são definidas pela F10 na renderização.
// `whatsapp_template` = template aprovado na Meta, usado fora da janela de 24h (NOT-5).
export interface DefinicaoModeloMensagem {
  readonly evento: string;
  readonly canal: 'WHATSAPP' | 'EMAIL' | 'SMS';
  readonly assunto?: string;
  readonly corpo: string;
  readonly whatsapp_template?: string;
}

const AVISOS: ReadonlyArray<{ evento: string; assunto: string; texto: string }> = [
  {
    evento: 'ORCAMENTO_ENVIADO',
    assunto: 'Seu orçamento {{orcamento.numero}} está pronto',
    texto:
      'Seu orçamento {{orcamento.numero}} ({{orcamento.total}}) está pronto. Veja e aprove por aqui: {{link}}',
  },
  {
    evento: 'ORCAMENTO_EXPIRANDO',
    assunto: 'Seu orçamento {{orcamento.numero}} vence em breve',
    texto:
      'Seu orçamento {{orcamento.numero}} vence em {{orcamento.validade}}. Para aprovar: {{link}}',
  },
  {
    evento: 'ORCAMENTO_APROVADO',
    assunto: 'Orçamento {{orcamento.numero}} aprovado',
    texto: 'Recebemos a aprovação do orçamento {{orcamento.numero}}. Já vamos começar o serviço.',
  },
  {
    evento: 'OS_ABERTA',
    assunto: 'Recebemos seu {{dispositivo.descricao}} — OS {{os.numero}}',
    texto: 'Recebemos seu {{dispositivo.descricao}}. Número da ordem de serviço: {{os.numero}}.',
  },
  {
    evento: 'OS_AGUARDANDO_APROVACAO',
    assunto: 'OS {{os.numero}}: precisamos da sua aprovação',
    texto: 'O diagnóstico da OS {{os.numero}} está pronto e precisa da sua aprovação: {{link}}',
  },
  {
    evento: 'OS_AGUARDANDO_PECAS',
    assunto: 'OS {{os.numero}}: aguardando peças',
    texto: 'A OS {{os.numero}} está aguardando a chegada de peças. Avisamos assim que chegarem.',
  },
  {
    evento: 'OS_PRONTA',
    assunto: 'Seu {{dispositivo.descricao}} está pronto — OS {{os.numero}}',
    texto: 'Seu {{dispositivo.descricao}} está pronto para retirada (OS {{os.numero}}).',
  },
  {
    evento: 'OS_ENTREGUE',
    assunto: 'OS {{os.numero}} entregue',
    texto:
      'Obrigado pela confiança! A OS {{os.numero}} foi entregue. Garantia até {{os.garantia_ate}}.',
  },
];

const saudacao = 'Olá, {{contato.primeiro_nome}}! ';
const assinatura = ' — {{empresa.nome_fantasia}}';

export const MODELOS_MENSAGEM: readonly DefinicaoModeloMensagem[] = AVISOS.flatMap(
  ({ evento, assunto, texto }) => [
    {
      evento,
      canal: 'WHATSAPP' as const,
      corpo: `${saudacao}${texto}${assinatura}`,
      whatsapp_template: `ebisu_${evento.toLowerCase()}`,
    },
    {
      evento,
      canal: 'EMAIL' as const,
      assunto,
      corpo: `${saudacao}\n\n${texto}\n\n${assinatura.trim()}`,
    },
    { evento, canal: 'SMS' as const, corpo: `{{empresa.nome_fantasia}}: ${texto}` },
  ],
);
