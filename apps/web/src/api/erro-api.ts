import { type CodigoErro, criarProblema, Problema } from '@ebisu/contracts';

/**
 * Erro de uma chamada à API. Sempre carrega um `Problema` (RFC 9457): o que veio da API ou um
 * sintetizado para falha de rede/resposta fora do contrato. `status` 0 = sem resposta do servidor.
 */
export class ErroApi extends Error {
  constructor(
    readonly problema: Problema,
    readonly status: number,
  ) {
    super(problema.title);
    this.name = 'ErroApi';
  }

  get codigo(): CodigoErro {
    return this.problema.code;
  }

  /** Erros por campo do 422 `validacao`, no formato do React Hook Form (`campo` com pontos). */
  get errosDeCampo(): Record<string, string> {
    return Object.fromEntries((this.problema.campos ?? []).map((c) => [c.campo, c.mensagem]));
  }

  static deResposta(status: number, corpo: unknown): ErroApi {
    const problema = Problema.safeParse(corpo);
    if (problema.success) return new ErroApi(problema.data, status);
    // Resposta de erro fora do envelope (ex.: proxy, HTML): trata como falha do servidor.
    return new ErroApi(criarProblema('erro_interno'), status);
  }

  static deRede(): ErroApi {
    return new ErroApi(
      criarProblema('erro_interno', {
        detail: 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
      }),
      0,
    );
  }
}

/** 409 `conflito_versao` (D-A08): o registro mudou; a tela deve recarregar antes de salvar. */
export const ehConflitoDeVersao = (erro: unknown): erro is ErroApi =>
  erro instanceof ErroApi && erro.codigo === 'conflito_versao';
