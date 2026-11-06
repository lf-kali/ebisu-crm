import type { InteresseNegocio, StatusNegocio, TipoDispositivo } from '@ebisu/contracts';

// Rótulos e formatação das telas de negócios (plano docs/planos/f4-web-2-negocios.md).

export const STATUS: Record<StatusNegocio, string> = {
  ABERTO: 'Aberto',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
  NUTRICAO: 'Nutrição',
};

export const INTERESSE: Record<InteresseNegocio, string> = {
  REPARO: 'Reparo',
  DIAGNOSTICO: 'Diagnóstico',
  MANUTENCAO_PREVENTIVA: 'Manutenção preventiva',
  RECUPERACAO_DADOS: 'Recuperação de dados',
  UPGRADE: 'Upgrade',
  VENDA_PRODUTO: 'Venda de produto',
  OUTRO: 'Outro',
};

export const TIPO_DISPOSITIVO: Record<TipoDispositivo, string> = {
  CELULAR: 'Celular',
  TABLET: 'Tablet',
  NOTEBOOK: 'Notebook',
  DESKTOP: 'Desktop',
  ALL_IN_ONE: 'All-in-one',
  OUTRO: 'Outro',
};

export const URGENCIA = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta' } as const;

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "450.00" → "R$ 450,00"; vazio → "—". */
export const formatarDinheiro = (valor: string | null) =>
  valor === null ? '—' : REAIS.format(Number(valor));

const RELATIVO = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** Há quanto tempo: "há 3 dias", "há 2 horas", "agora". */
export function tempoDesde(iso: string, agora = Date.now()): string {
  const minutos = Math.round((agora - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return RELATIVO.format(-minutos, 'minute');
  const horas = Math.round(minutos / 60);
  if (horas < 24) return RELATIVO.format(-horas, 'hour');
  return RELATIVO.format(-Math.round(horas / 24), 'day');
}

/** Data e hora local do campo `datetime-local` para ISO (e o inverso). */
export const deLocal = (valor: string) => new Date(valor).toISOString();
export function paraLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
