import type { z } from 'zod';
import { ErroApi } from './erro-api';

// Cliente HTTP tipado (spec §5.1, §4 F12): toda resposta passa pelo schema do contrato
// (@ebisu/contracts) e todo erro vira ErroApi com o `Problema` da API.

type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type ValorQuery = string | number | boolean | undefined | null;

export interface OpcoesRequisicao<S extends z.ZodType> {
  /** Schema da resposta; `null` para respostas sem corpo (204). */
  resposta: S | null;
  query?: Record<string, ValorQuery>;
  corpo?: unknown;
  /**
   * Idempotency-Key (D-A07). Em POST é gerada automaticamente; passe a mesma chave para repetir
   * a mesma operação com segurança (ex.: novo envio após falha de rede).
   */
  chaveIdempotencia?: string;
  sinal?: AbortSignal;
}

export interface ConfigCliente {
  /** Base das URLs; padrão: a origem da página (o Vite encaminha /v1 para a API). */
  baseUrl?: string;
  /** Cabeçalhos por requisição: Authorization e X-Empresa-Id (entram com a autenticação). */
  cabecalhos?: () => Record<string, string>;
  fetch?: typeof fetch;
}

function montarUrl(baseUrl: string, caminho: string, query: Record<string, ValorQuery> = {}): URL {
  const url = new URL(caminho, baseUrl);
  for (const [chave, valor] of Object.entries(query)) {
    if (valor !== undefined && valor !== null && valor !== '')
      url.searchParams.set(chave, String(valor));
  }
  return url;
}

export function criarClienteApi(config: ConfigCliente = {}) {
  const buscar = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function requisitar<S extends z.ZodType>(
    metodo: Metodo,
    caminho: string,
    opcoes: OpcoesRequisicao<S>,
  ): Promise<S extends z.ZodType ? z.infer<S> : undefined> {
    const cabecalhos: Record<string, string> = {
      Accept: 'application/json',
      ...config.cabecalhos?.(),
    };
    if (opcoes.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    if (metodo === 'POST')
      cabecalhos['Idempotency-Key'] = opcoes.chaveIdempotencia ?? crypto.randomUUID();

    const url = montarUrl(config.baseUrl ?? window.location.origin, caminho, opcoes.query);
    let resposta: Response;
    try {
      resposta = await buscar(url, {
        method: metodo,
        headers: cabecalhos,
        body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
        signal: opcoes.sinal,
      });
    } catch (erro) {
      // Cancelamento não é falha de rede: repassa o erro do abort (checar o sinal vale em qualquer realm).
      if (opcoes.sinal?.aborted) throw erro;
      throw ErroApi.deRede();
    }

    const texto = await resposta.text();
    let corpo: unknown;
    try {
      corpo = texto ? JSON.parse(texto) : undefined;
    } catch {
      corpo = undefined;
    }
    if (!resposta.ok) throw ErroApi.deResposta(resposta.status, corpo);
    if (opcoes.resposta === null) return undefined as never;
    const validado = opcoes.resposta.safeParse(corpo);
    // Sucesso fora do contrato é bug de integração: trata como falha do servidor.
    if (!validado.success) throw ErroApi.deResposta(500, undefined);
    return validado.data as never;
  }

  return {
    get: <S extends z.ZodType>(
      caminho: string,
      opcoes: Omit<OpcoesRequisicao<S>, 'corpo' | 'chaveIdempotencia'>,
    ) => requisitar('GET', caminho, opcoes),
    post: <S extends z.ZodType>(caminho: string, opcoes: OpcoesRequisicao<S>) =>
      requisitar('POST', caminho, opcoes),
    patch: <S extends z.ZodType>(
      caminho: string,
      opcoes: Omit<OpcoesRequisicao<S>, 'chaveIdempotencia'>,
    ) => requisitar('PATCH', caminho, opcoes),
    delete: <S extends z.ZodType>(
      caminho: string,
      opcoes: Omit<OpcoesRequisicao<S>, 'corpo' | 'chaveIdempotencia'>,
    ) => requisitar('DELETE', caminho, opcoes),
  };
}

export type ClienteApi = ReturnType<typeof criarClienteApi>;

/** Cliente padrão do web (a autenticação injeta os cabeçalhos no PR 3 da F12). */
export const api = criarClienteApi();
