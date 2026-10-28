import { type EntradaLogin, RespostaSessao, type ResumoConta, ROTAS_AUTH } from '@ebisu/contracts';
import type { ClienteApi } from '../api/cliente';
import { ErroApi } from '../api/erro-api';

// Sessão do web (D-T05, §5.1): o access token fica só em memória; o refresh token vive no cookie
// httpOnly, que o JavaScript não lê. Recarregar a página = pedir um refresh.

export interface Sessao {
  accessToken: string;
  /** Instante (ms) em que o access token expira. */
  expiraEm: number;
  conta: ResumoConta;
  contas: ResumoConta[];
}

/** Renova um pouco antes de expirar, para a requisição não sair com token vencido. */
const MARGEM_MS = 30_000;
const TRAVA_REFRESH = 'ebisu-refresh';

interface OpcoesSessao {
  /** Cliente sem autenticação (as rotas de auth usam o cookie, não o Bearer). */
  cliente: ClienteApi;
  agora?: () => number;
  /** Serializa o refresh entre abas; padrão: Web Locks API, quando existe. */
  travar?: <T>(fn: () => Promise<T>) => Promise<T>;
}

const travaPadrao = <T>(fn: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? (navigator.locks.request(TRAVA_REFRESH, fn) as Promise<T>)
    : fn();

export function criarSessao({ cliente, agora = Date.now, travar = travaPadrao }: OpcoesSessao) {
  let atual: Sessao | null = null;
  let renovando: Promise<Sessao | null> | null = null;
  const ouvintes = new Set<() => void>();

  const definir = (proxima: Sessao | null) => {
    atual = proxima;
    for (const ouvinte of ouvintes) ouvinte();
  };

  const daResposta = (resposta: RespostaSessao): Sessao => ({
    accessToken: resposta.access_token,
    expiraEm: agora() + resposta.expira_em * 1000,
    conta: resposta.conta,
    contas: resposta.contas,
  });

  /**
   * Pede um refresh. Chamadas simultâneas na aba compartilham a mesma requisição, e entre abas a
   * trava evita dois refresh com o mesmo cookie (a rotação veria reuso e derrubaria a sessão).
   * 401 = sem sessão (devolve null); outro erro (ex.: rede) é repassado.
   */
  function renovar(): Promise<Sessao | null> {
    renovando ??= travar(async () => {
      try {
        const resposta = await cliente.post(ROTAS_AUTH.refresh, { resposta: RespostaSessao });
        definir(daResposta(resposta));
      } catch (erro) {
        if (!(erro instanceof ErroApi && erro.status === 401)) throw erro;
        definir(null);
      }
      return atual;
    }).finally(() => {
      renovando = null;
    });
    return renovando;
  }

  return {
    obter: () => atual,
    assinar(ouvinte: () => void) {
      ouvintes.add(ouvinte);
      return () => void ouvintes.delete(ouvinte);
    },
    /** Sessão válida agora, renovando se faltar ou estiver para vencer. */
    async garantir(): Promise<Sessao | null> {
      if (atual && atual.expiraEm - agora() > MARGEM_MS) return atual;
      return renovar();
    },
    renovar,
    async entrar(credenciais: EntradaLogin): Promise<Sessao> {
      const resposta = await cliente.post(ROTAS_AUTH.login, {
        resposta: RespostaSessao,
        corpo: credenciais,
      });
      const sessao = daResposta(resposta);
      definir(sessao);
      return sessao;
    },
    async trocarConta(tenantId: string): Promise<Sessao> {
      const resposta = await cliente.post(ROTAS_AUTH.trocarConta, {
        resposta: RespostaSessao,
        corpo: { tenant_id: tenantId },
        cabecalhos: atual ? { Authorization: `Bearer ${atual.accessToken}` } : {},
      });
      const sessao = daResposta(resposta);
      definir(sessao);
      return sessao;
    },
    /**
     * Encerra a sessão na API e só então a local. Se a API falhar, o erro sobe e a sessão fica:
     * limpar só a local seria fingir a saída, porque o cookie continua valendo e o próximo
     * refresh a restauraria. 401 = já não havia sessão no servidor, o que conta como saída.
     */
    async sair(): Promise<void> {
      try {
        await cliente.post(ROTAS_AUTH.logout, { resposta: null });
      } catch (erro) {
        if (!(erro instanceof ErroApi && erro.status === 401)) throw erro;
      }
      definir(null);
    },
  };
}

export type GerenciadorSessao = ReturnType<typeof criarSessao>;
