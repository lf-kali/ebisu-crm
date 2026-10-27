// Padrões semeados uma vez por tenant (tabelas sem empresa_id).
// RASCUNHO para validar com a operação.

type Categoria =
  'ALIMENTACAO' | 'CONECTIVIDADE' | 'PROTECAO' | 'ARMAZENAMENTO' | 'PERIFERICO' | 'OUTRO';
type Atributo =
  | 'tem_padrao_tomada'
  | 'tem_tipo_conector'
  | 'tem_potencia_watts'
  | 'tem_capacidade'
  | 'tem_classe_velocidade'
  | 'tem_conectividade_sem_fio'
  | 'tem_layout';

export interface DefinicaoTipoAcessorio {
  readonly nome: string;
  readonly categoria: Categoria;
  readonly atributos: readonly Atributo[];
}

export const TIPOS_ACESSORIO: readonly DefinicaoTipoAcessorio[] = [
  {
    nome: 'Carregador',
    categoria: 'ALIMENTACAO',
    atributos: ['tem_padrao_tomada', 'tem_potencia_watts'],
  },
  {
    nome: 'Fonte de notebook',
    categoria: 'ALIMENTACAO',
    atributos: ['tem_padrao_tomada', 'tem_potencia_watts', 'tem_tipo_conector'],
  },
  { nome: 'Cabo USB', categoria: 'CONECTIVIDADE', atributos: ['tem_tipo_conector'] },
  { nome: 'Chip (SIM)', categoria: 'CONECTIVIDADE', atributos: [] },
  { nome: 'Capinha', categoria: 'PROTECAO', atributos: [] },
  { nome: 'Película', categoria: 'PROTECAO', atributos: [] },
  { nome: 'Bolsa ou case', categoria: 'PROTECAO', atributos: [] },
  {
    nome: 'Cartão de memória',
    categoria: 'ARMAZENAMENTO',
    atributos: ['tem_capacidade', 'tem_classe_velocidade'],
  },
  { nome: 'Mouse', categoria: 'PERIFERICO', atributos: ['tem_conectividade_sem_fio'] },
  {
    nome: 'Teclado',
    categoria: 'PERIFERICO',
    atributos: ['tem_conectividade_sem_fio', 'tem_layout'],
  },
  { nome: 'Caneta stylus', categoria: 'PERIFERICO', atributos: [] },
  { nome: 'Outro', categoria: 'OUTRO', atributos: [] },
];

// Formato de `checklist_modelo.itens` (schema.prisma):
// [{chave, rotulo, tipo_resposta: BOOLEANO|OPCOES|TEXTO|NUMERO, opcoes[], obrigatorio, depende_de: {chave, igual}}]
export interface ItemChecklist {
  readonly chave: string;
  readonly rotulo: string;
  readonly tipo_resposta: 'BOOLEANO' | 'OPCOES' | 'TEXTO' | 'NUMERO';
  readonly opcoes?: readonly string[];
  readonly obrigatorio: boolean;
  readonly depende_de?: { readonly chave: string; readonly igual: unknown };
}

export interface DefinicaoChecklist {
  readonly nome: string;
  readonly tipo_dispositivo: 'CELULAR' | 'NOTEBOOK';
  readonly momento: 'ENTRADA' | 'SAIDA';
  readonly itens: readonly ItemChecklist[];
}

const ligado = { chave: 'liga_normalmente', igual: true } as const;
const sim = (chave: string, rotulo: string, extra: Partial<ItemChecklist> = {}): ItemChecklist => ({
  chave,
  rotulo,
  tipo_resposta: 'BOOLEANO',
  obrigatorio: true,
  ...extra,
});
const opcoes = (
  chave: string,
  rotulo: string,
  lista: string[],
  extra: Partial<ItemChecklist> = {},
): ItemChecklist => ({
  chave,
  rotulo,
  tipo_resposta: 'OPCOES',
  opcoes: lista,
  obrigatorio: true,
  ...extra,
});
const observacoes: ItemChecklist = {
  chave: 'observacoes',
  rotulo: 'Observações',
  tipo_resposta: 'TEXTO',
  obrigatorio: false,
};
const carcaca = opcoes('carcaca', 'Estado da carcaça', [
  'Sem marcas',
  'Riscos leves',
  'Amassados',
  'Trincada ou quebrada',
]);
const umidade = sim('sinais_umidade', 'Sinais de umidade ou oxidação');

export const CHECKLISTS: readonly DefinicaoChecklist[] = [
  {
    // Replica o checklist do Ogun (schema.prisma) com itens de entrada da bancada.
    nome: 'Celular — entrada',
    tipo_dispositivo: 'CELULAR',
    momento: 'ENTRADA',
    itens: [
      sim('liga_normalmente', 'Liga normalmente'),
      opcoes('tela', 'Estado da tela', ['Íntegra', 'Riscada', 'Trincada', 'Quebrada']),
      opcoes('display', 'Imagem do display', ['Normal', 'Manchas', 'Linhas', 'Sem imagem'], {
        depende_de: ligado,
      }),
      sim('toque', 'Toque funciona', { depende_de: ligado }),
      opcoes('bateria', 'Bateria', ['Normal', 'Não segura carga', 'Estufada'], {
        depende_de: ligado,
      }),
      sim('audio', 'Áudio (alto-falante e microfone)', { depende_de: ligado }),
      sim('camera_traseira', 'Câmera traseira', { depende_de: ligado }),
      sim('camera_frontal', 'Câmera frontal', { depende_de: ligado }),
      carcaca,
      umidade,
      sim('chip_cartao_retirados', 'Chip e cartão de memória retirados pelo cliente'),
      observacoes,
    ],
  },
  {
    nome: 'Celular — saída',
    tipo_dispositivo: 'CELULAR',
    momento: 'SAIDA',
    itens: [
      sim('liga_normalmente', 'Liga normalmente'),
      sim('tela_toque', 'Tela e toque funcionando'),
      sim('audio', 'Áudio (alto-falante e microfone)'),
      sim('cameras', 'Câmeras funcionando'),
      sim('carregamento', 'Carrega normalmente'),
      sim('servico_validado', 'Serviço testado e validado'),
      observacoes,
    ],
  },
  {
    nome: 'Notebook — entrada',
    tipo_dispositivo: 'NOTEBOOK',
    momento: 'ENTRADA',
    itens: [
      sim('liga_normalmente', 'Liga normalmente'),
      opcoes('tela', 'Estado da tela', ['Íntegra', 'Riscada', 'Trincada', 'Quebrada']),
      opcoes('display', 'Imagem do display', ['Normal', 'Manchas', 'Linhas', 'Sem imagem'], {
        depende_de: ligado,
      }),
      opcoes('teclado', 'Teclado', ['Normal', 'Teclas falhando', 'Danificado'], {
        depende_de: ligado,
      }),
      sim('touchpad', 'Touchpad funciona', { depende_de: ligado }),
      opcoes('bateria', 'Bateria', ['Normal', 'Não segura carga', 'Estufada', 'Ausente']),
      sim('portas', 'Portas (USB, HDMI, áudio) funcionando', { depende_de: ligado }),
      opcoes('dobradicas', 'Dobradiças', ['Firmes', 'Frouxas', 'Quebradas']),
      carcaca,
      umidade,
      observacoes,
    ],
  },
  {
    nome: 'Notebook — saída',
    tipo_dispositivo: 'NOTEBOOK',
    momento: 'SAIDA',
    itens: [
      sim('liga_normalmente', 'Liga normalmente'),
      sim('tela', 'Tela funcionando'),
      sim('teclado_touchpad', 'Teclado e touchpad funcionando'),
      sim('carregamento', 'Carrega normalmente'),
      sim('portas', 'Portas funcionando'),
      sim('servico_validado', 'Serviço testado e validado'),
      observacoes,
    ],
  },
];
