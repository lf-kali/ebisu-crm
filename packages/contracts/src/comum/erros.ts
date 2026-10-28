import { z } from 'zod';

// Envelope de erro RFC 9457 (application/problem+json) e catálogo estável de códigos (spec §5.2).
// O `title` vem daqui e é exibido na UI (DoD §6.1: mensagens de erro vindas do catálogo).

export const CATALOGO_ERROS = {
  nao_autenticado: { status: 401, title: 'Sessão expirada ou ausente. Entre novamente.' },
  sem_permissao: { status: 403, title: 'Você não tem permissão para esta ação.' },
  empresa_nao_autorizada: { status: 403, title: 'Você não tem acesso a esta empresa.' },
  nao_encontrado: { status: 404, title: 'Registro não encontrado.' },
  validacao: { status: 422, title: 'Alguns campos estão inválidos.' },
  idempotencia_divergente: {
    status: 422,
    title: 'Esta chave de idempotência já foi usada com outro conteúdo.',
  },
  idempotencia_em_andamento: { status: 409, title: 'Esta requisição ainda está sendo processada.' },
  conflito_versao: {
    status: 409,
    title: 'O registro foi alterado por outra pessoa. Recarregue e tente de novo.',
  },
  duplicado: { status: 409, title: 'Já existe um registro com estes dados.' },
  transicao_invalida: { status: 409, title: 'Esta ação não é permitida no estado atual.' },
  requisitos_pendentes: { status: 409, title: 'Faltam requisitos para avançar de etapa.' },
  estoque_insuficiente: { status: 409, title: 'Estoque insuficiente para esta peça.' },
  orcamento_imutavel: { status: 409, title: 'Orçamento enviado não pode ser alterado.' },
  link_invalido: { status: 410, title: 'Este link expirou ou foi substituído.' },
  limite_excedido: { status: 429, title: 'Muitas requisições. Tente de novo em instantes.' },
  erro_interno: { status: 500, title: 'Erro inesperado. Tente de novo mais tarde.' },
} as const satisfies Record<string, { status: number; title: string }>;

export type CodigoErro = keyof typeof CATALOGO_ERROS;
export const CodigoErro = z
  .enum(Object.keys(CATALOGO_ERROS) as [CodigoErro, ...CodigoErro[]])
  .meta({ id: 'CodigoErro' });

export const ErroCampo = z
  .object({
    campo: z.string().meta({ description: 'Caminho do campo, ex.: itens.0.quantidade' }),
    code: z.string().meta({ description: 'Código da validação, ex.: invalid_type' }),
    mensagem: z.string(),
  })
  .meta({ id: 'ErroCampo' });

export const Problema = z
  .looseObject({
    type: z.string().meta({ description: 'URI do tipo de erro' }),
    title: z.string(),
    status: z.number().int(),
    code: CodigoErro,
    detail: z.string().optional(),
    instance: z.string().optional(),
    request_id: z.string().optional(),
    invariante: z.string().optional().meta({ description: 'ID da regra violada, ex.: EST-6' }),
    campos: z.array(ErroCampo).optional(),
  })
  .meta({
    id: 'Problema',
    description: 'Erro no formato RFC 9457; códigos podem trazer campos extras (ex.: estado_atual)',
  });
export type Problema = z.infer<typeof Problema>;

export const tipoDoErro = (code: CodigoErro) => `urn:ebisu:erro:${code}`;

export interface OpcoesProblema {
  detail?: string;
  instance?: string;
  request_id?: string;
  invariante?: string;
  campos?: z.infer<typeof ErroCampo>[];
  /** Campos específicos do código, ex.: id_existente, estado_atual, requisitos. */
  extras?: Record<string, unknown>;
}

export function criarProblema(code: CodigoErro, opcoes: OpcoesProblema = {}): Problema {
  const { extras, ...resto } = opcoes;
  const { status, title } = CATALOGO_ERROS[code];
  const definidos = Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined));
  return { ...extras, type: tipoDoErro(code), title, status, code, ...definidos };
}

/** Converte issues do Zod em `campos` do envelope (code validacao). */
export function camposDoZod(erro: z.ZodError): z.infer<typeof ErroCampo>[] {
  return erro.issues.map((issue) => ({
    campo: issue.path.map(String).join('.'),
    code: issue.code,
    mensagem: issue.message,
  }));
}
