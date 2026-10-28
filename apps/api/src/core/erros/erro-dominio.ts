import type { CodigoErro, OpcoesProblema } from '@ebisu/contracts';

/**
 * Erro de regra de negócio (spec §5.4): `ErroDominio(code, detalhes, invariante)`.
 * O filtro global o converte no envelope RFC 9457 com status e mensagem do catálogo.
 */
export class ErroDominio extends Error {
  constructor(
    readonly code: CodigoErro,
    readonly detalhes: Pick<OpcoesProblema, 'detail' | 'campos' | 'extras'> = {},
    readonly invariante?: string,
  ) {
    super(detalhes.detail ?? code);
    this.name = 'ErroDominio';
  }
}
