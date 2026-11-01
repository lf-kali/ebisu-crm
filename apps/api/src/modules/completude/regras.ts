import { CHAVES_REGRA } from '@ebisu/contracts';

// Avaliação dos requisitos de etapa (plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões
// 10 e 11). Funções puras sobre os dados já lidos: o serviço de completude decide o que gravar.

export interface RequisitoAvaliado {
  id: string;
  tipo: 'CAMPO' | 'TAREFA' | 'REGRA';
  chave: string;
  descricao: string;
  obrigatorio: boolean;
}

/** Os dados do contato como lidos do banco ou do contrato (datas em Date ou texto). */
export interface ContatoAvaliado {
  nome?: unknown;
  email?: string | null;
  telefone_e164?: string | null;
  whatsapp_e164?: string | null;
  documento?: unknown;
  canal_preferido?: string | null;
  data_nascimento?: unknown;
  endereco?: unknown;
  origem_id?: string | null;
  /** Do mais recente ao mais antigo (ou só a situação atual de cada canal e finalidade). */
  consentimentos: ReadonlyArray<{ canal: string; finalidade: string; concedido: boolean }>;
}

export interface NegocioAvaliado {
  tipo_dispositivo?: unknown;
  dispositivo_id?: string | null;
  descricao_problema?: unknown;
  urgencia?: unknown;
  valor_estimado?: unknown;
  previsao_fechamento?: unknown;
  responsavel_id?: unknown;
  nba_adiada_ate?: unknown;
  /** Requisitos (ids) cujas tarefas deste negócio estão concluídas. */
  tarefasConcluidas: ReadonlySet<string>;
}

/** Regras que só olham o contato: entram na completude do perfil (decisão 10). */
export const REGRAS_DO_CONTATO = new Set<string>([
  'contato_tem_meio_contato',
  'contato_tem_origem',
  'consentimento_transacional',
]);

/** O requisito fala só do contato (CAMPO `contato.*` ou regra de contato). */
export const ehDoContato = (r: Pick<RequisitoAvaliado, 'tipo' | 'chave'>) =>
  (r.tipo === 'CAMPO' && r.chave.startsWith('contato.')) ||
  (r.tipo === 'REGRA' && REGRAS_DO_CONTATO.has(r.chave));

const preenchido = (valor: unknown) => {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (typeof valor === 'object' && !(valor instanceof Date))
    return Object.values(valor).some((v) => typeof v === 'string' && v.trim() !== '');
  return true;
};

function regra(chave: string, contato: ContatoAvaliado, negocio: NegocioAvaliado | null) {
  switch (chave as (typeof CHAVES_REGRA)[number]) {
    case 'contato_tem_meio_contato':
      return Boolean(contato.email || contato.telefone_e164 || contato.whatsapp_e164);
    case 'contato_tem_origem':
      return Boolean(contato.origem_id);
    case 'consentimento_transacional': {
      if (!contato.canal_preferido) return false;
      const atual = contato.consentimentos.find(
        (c) => c.canal === contato.canal_preferido && c.finalidade === 'TRANSACIONAL',
      );
      return atual?.concedido ?? false;
    }
    case 'dispositivo_ou_orcamento_remoto':
      // O orçamento remoto chega na F6; por ora, só o dispositivo (decisão 11).
      return Boolean(negocio?.dispositivo_id);
    case 'orcamento_revisado':
      return false;
    default:
      // Regra desconhecida conta como não atendida (decisão 11).
      return false;
  }
}

export function atendido(
  requisito: RequisitoAvaliado,
  contato: ContatoAvaliado,
  negocio: NegocioAvaliado | null,
): boolean {
  if (requisito.tipo === 'REGRA') return regra(requisito.chave, contato, negocio);
  if (requisito.tipo === 'TAREFA') return negocio?.tarefasConcluidas.has(requisito.id) ?? false;
  const [entidade, coluna] = requisito.chave.split('.') as [string, string];
  if (entidade === 'contato')
    return preenchido((contato as unknown as Record<string, unknown>)[coluna]);
  if (entidade === 'negocio' && negocio)
    return preenchido((negocio as unknown as Record<string, unknown>)[coluna]);
  return false;
}

/** Percentual atendido, 0–100; sem requisitos, 100. */
export const percentual = (total: number, atendidos: number) =>
  total === 0 ? 100 : Math.round((100 * atendidos) / total);
