import type { TxContext } from '../tx/contexto.js';

// Números de documento (plano docs/planos/f3-6-sequencias-isolamento.md): por empresa e por tipo,
// reinício mensal no fuso da empresa, sem buracos. O número sai na mesma transação do comando: a
// linha do período fica travada até o fim dela, e um comando que falha devolve o número.

export type TipoDocumento = 'ORCAMENTO' | 'ORDEM_SERVICO' | 'COMPRA';

/** Formato fixo no MVP (decisão 1). Fica gravado na linha do período. */
export const FORMATOS: Readonly<Record<TipoDocumento, string>> = {
  ORCAMENTO: 'ORC-{AA}{MM}-{####}',
  ORDEM_SERVICO: 'OS-{AA}{MM}-{####}',
  COMPRA: 'CP-{AA}{MM}-{####}',
};

/** `AAMM` do instante no fuso dado (ex.: "2610"). */
export function periodoDe(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: '2-digit',
    month: '2-digit',
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return `${parte('year')}${parte('month')}`;
}

/** Aplica o formato: `{AA}{MM}` do período e `{####}` com zeros à esquerda (nunca trunca). */
export function formatarNumero(formato: string, periodo: string, numero: number): string {
  return formato
    .replace('{AA}', periodo.slice(0, 2))
    .replace('{MM}', periodo.slice(2, 4))
    .replace(/\{(#+)\}/, (_, casas: string) => String(numero).padStart(casas.length, '0'));
}

/** Próximo número do tipo na empresa do contexto. Só dentro de `executarComando`. */
export async function proximoNumero(
  ctx: Pick<TxContext, 'tx' | 'tenantId' | 'empresaId'>,
  tipo: TipoDocumento,
  agora: Date = new Date(),
): Promise<string> {
  const empresa = await ctx.tx.empresa.findUniqueOrThrow({
    where: { id: ctx.empresaId },
    select: { timezone: true },
  });
  const periodo = periodoDe(agora, empresa.timezone);
  const formato = FORMATOS[tipo];
  // Primeira do período: grava proximo = 2 e o número é 1. Depois, soma 1 sob a trava da linha.
  const [linha] = await ctx.tx.$queryRaw<Array<{ proximo: number; formato: string }>>`
    INSERT INTO sequencia_documento (id, tenant_id, empresa_id, tipo, formato, periodo, proximo)
    VALUES (gen_random_uuid(), ${ctx.tenantId}::uuid, ${ctx.empresaId}::uuid,
            ${tipo}::"TipoDocumentoSequencia", ${formato}, ${periodo}, 2)
    ON CONFLICT (empresa_id, tipo, periodo)
      DO UPDATE SET proximo = sequencia_documento.proximo + 1
    RETURNING proximo, formato`;
  return formatarNumero(linha!.formato, periodo, linha!.proximo - 1);
}
