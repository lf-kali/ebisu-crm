import {
  camposDoZod,
  criarProblema,
  EntradaLogin,
  EntradaTrocarConta,
  type CodigoErro,
  type RespostaEu,
  type RespostaSessao,
  ROTAS_AUTH,
} from '@ebisu/contracts';
import { http, HttpResponse } from 'msw';
import { USUARIOS, SENHA_DEMO, type UsuarioDemo } from './dados';

// API simulada (MSW) do contrato de auth e do /v1/eu (packages/contracts/plataforma), usada pelo
// web até a F3 entregar a API real. O "cookie" do refresh é o estado `refresh` daqui (o MSW não
// grava cookie httpOnly); no navegador ele persiste no sessionStorage para sobreviver ao F5.

interface Vinculo {
  usuarioId: string;
  tenantId: string;
}

const CHAVE_PERSISTENCIA = 'ebisu.simulacao.refresh';
const EXPIRA_EM = 900;

const problema = (code: CodigoErro, opcoes?: Parameters<typeof criarProblema>[1]) => {
  const corpo = criarProblema(code, opcoes);
  return HttpResponse.json(corpo, { status: corpo.status });
};

export function criarApiSimulada({ persistir }: { persistir?: Storage } = {}) {
  let refresh: (Vinculo & { token: string }) | null = lerPersistido();
  const acessos = new Map<string, Vinculo>();
  let sequencia = 0;
  const contagem = { refresh: 0 };

  function lerPersistido() {
    try {
      const salvo = persistir?.getItem(CHAVE_PERSISTENCIA);
      return salvo ? (JSON.parse(salvo) as Vinculo & { token: string }) : null;
    } catch {
      return null;
    }
  }

  function gravarRefresh(proximo: typeof refresh) {
    refresh = proximo;
    try {
      if (proximo) persistir?.setItem(CHAVE_PERSISTENCIA, JSON.stringify(proximo));
      else persistir?.removeItem(CHAVE_PERSISTENCIA);
    } catch {
      // Armazenamento indisponível: a sessão só não sobrevive ao F5.
    }
  }

  const usuario = (id: string) => USUARIOS.find((u) => u.id === id)!;
  const vinculoDaConta = (u: UsuarioDemo, tenantId: string) =>
    u.contas.find((c) => c.conta.tenant_id === tenantId);

  function abrirSessao(u: UsuarioDemo, tenantId: string): RespostaSessao {
    sequencia += 1;
    const accessToken = `sim-acesso-${sequencia}`;
    acessos.set(accessToken, { usuarioId: u.id, tenantId });
    gravarRefresh({ usuarioId: u.id, tenantId, token: `sim-refresh-${sequencia}` });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expira_em: EXPIRA_EM,
      conta: vinculoDaConta(u, tenantId)!.conta,
      contas: u.contas.map((c) => c.conta),
    };
  }

  const autenticado = (request: Request) =>
    acessos.get(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');

  const handlers = [
    http.post(`*${ROTAS_AUTH.login}`, async ({ request }) => {
      const entrada = EntradaLogin.safeParse(await request.json().catch(() => undefined));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const email = entrada.data.email.trim().toLowerCase();
      const u = USUARIOS.find((x) => x.email === email);
      if (!u || entrada.data.senha !== SENHA_DEMO) return problema('nao_autenticado');
      return HttpResponse.json(abrirSessao(u, u.contas[0]!.conta.tenant_id));
    }),

    http.post(`*${ROTAS_AUTH.refresh}`, () => {
      contagem.refresh += 1;
      if (!refresh) return problema('nao_autenticado');
      return HttpResponse.json(abrirSessao(usuario(refresh.usuarioId), refresh.tenantId));
    }),

    http.post(`*${ROTAS_AUTH.trocarConta}`, async ({ request }) => {
      const vinculo = autenticado(request);
      if (!vinculo) return problema('nao_autenticado');
      const entrada = EntradaTrocarConta.safeParse(await request.json().catch(() => undefined));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const u = usuario(vinculo.usuarioId);
      if (!vinculoDaConta(u, entrada.data.tenant_id)) return problema('nao_encontrado');
      return HttpResponse.json(abrirSessao(u, entrada.data.tenant_id));
    }),

    http.post(`*${ROTAS_AUTH.logout}`, () => {
      gravarRefresh(null);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`*${ROTAS_AUTH.eu}`, ({ request }) => {
      const vinculo = autenticado(request);
      if (!vinculo) return problema('nao_autenticado');
      const u = usuario(vinculo.usuarioId);
      const daConta = vinculoDaConta(u, vinculo.tenantId)!;
      const eu: RespostaEu = {
        usuario: { id: u.id, nome: u.nome, email: u.email, avatar_url: null },
        membro: { id: daConta.membroId, cargo: null },
        conta: daConta.conta,
        empresas: daConta.empresas,
      };
      return HttpResponse.json(eu);
    }),

    http.get('*/v1/saude', () => HttpResponse.json({ status: 'ok' })),
  ];

  return {
    handlers,
    /** Testes: simula o cookie de refresh de quem já está logado. */
    jaLogado(email: string, tenantId?: string) {
      const u = USUARIOS.find((x) => x.email === email)!;
      gravarRefresh({
        usuarioId: u.id,
        tenantId: tenantId ?? u.contas[0]!.conta.tenant_id,
        token: 'sim-refresh-inicial',
      });
    },
    /** Testes: vence todos os access tokens (o próximo uso dá 401). */
    expirarAcessos: () => acessos.clear(),
    temRefresh: () => refresh !== null,
    contagem,
  };
}

export type ApiSimulada = ReturnType<typeof criarApiSimulada>;
