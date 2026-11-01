import {
  camposDoZod,
  type ConsultaConvite,
  criarProblema,
  EntradaAceite,
  EntradaLogin,
  EntradaRegistro,
  EntradaTokenConvite,
  EntradaTrocarConta,
  type CodigoErro,
  type EmpresaDoMembro,
  type RespostaEu,
  type RespostaSessao,
  ROTAS_AUTH,
  ROTAS_CONVITES,
} from '@ebisu/contracts';
import { http, HttpResponse } from 'msw';
import { criarConfiguracoesSimuladas } from './configuracoes-simulada';
import { criarContatosSimulados } from './contatos-simulada';
import { USUARIOS, SENHA_DEMO, type UsuarioDemo } from './dados';

// API simulada (MSW) do contrato de auth e do /v1/eu (packages/contracts/plataforma), usada pelo
// web até a F3 entregar a API real. O "cookie" do refresh é o estado `refresh` daqui (o MSW não
// grava cookie httpOnly); no navegador ele persiste no localStorage, que como um cookie vale em
// todas as abas e sobrevive ao F5.

interface Vinculo {
  usuarioId: string;
  tenantId: string;
}

const CHAVE_PERSISTENCIA = 'ebisu.simulacao.refresh';
const EXPIRA_EM = 900;

/** Mesma mensagem da política de senha da API (apps/api/src/modules/auth/politica-senha.ts). */
export const MENSAGEM_SENHA_FRACA =
  'Senha fraca: use 12 ou mais caracteres, sem seu nome ou e-mail, e evite senhas comuns.';

/** Dono da conta recém-criada: todas as permissões da demonstração, mais as de configuração. */
const PERMISSOES_DO_DONO: EmpresaDoMembro['permissoes'] = Object.fromEntries(
  ['config.empresa', 'config.membros', 'config.rbac', 'config.api_keys', 'contato.read'].map(
    (chave) => [chave, 'TENANT' as const],
  ),
);

interface ConviteSimulado {
  tenantId: string;
  nomeConta: string;
  email: string;
  acao: ConsultaConvite['acao'];
  usado: boolean;
}

const problema = (code: CodigoErro, opcoes?: Parameters<typeof criarProblema>[1]) => {
  const corpo = criarProblema(code, opcoes);
  return HttpResponse.json(corpo, { status: corpo.status });
};

export function criarApiSimulada({ persistir }: { persistir?: Storage } = {}) {
  let refresh: (Vinculo & { token: string }) | null = lerPersistido();
  const acessos = new Map<string, Vinculo>();
  let sequencia = 0;
  const contagem = { refresh: 0 };
  // Cópia mutável: o cadastro e o aceite do convite acrescentam usuários e contas.
  const usuarios: UsuarioDemo[] = USUARIOS.map((u) => ({
    ...u,
    contas: u.contas.map((c) => ({ ...c, empresas: [...c.empresas] })),
  }));
  const convites = new Map<string, ConviteSimulado>();
  const novoId = () => crypto.randomUUID();

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

  const usuario = (id: string) => usuarios.find((u) => u.id === id)!;
  const porEmail = (email: string) => usuarios.find((u) => u.email === email.trim().toLowerCase());

  /** Senha "fraca" na simulação: contém o nome, o e-mail ou a palavra senha. */
  const senhaFraca = (senha: string, email: string, nome = '') => {
    const minuscula = senha.toLowerCase();
    const pedacos = [email.split('@')[0]!, ...nome.toLowerCase().split(/\s+/), 'senha'];
    return pedacos.some((p) => p.length >= 4 && minuscula.includes(p));
  };
  const problemaSenhaFraca = () =>
    problema('validacao', {
      campos: [{ campo: 'senha', code: 'senha_fraca', mensagem: MENSAGEM_SENHA_FRACA }],
    });

  /** Acrescenta a conta ao usuário (criando o usuário se preciso), como dono ou membro. */
  function vincular(u: UsuarioDemo, tenantId: string, nomeConta: string, empresa: string) {
    u.contas.push({
      conta: { tenant_id: tenantId, nome: nomeConta, slug: nomeConta.toLowerCase() },
      membroId: novoId(),
      empresas: [
        {
          id: novoId(),
          nome_fantasia: empresa,
          razao_social: `${empresa} LTDA`,
          logo_url: null,
          permissoes: PERMISSOES_DO_DONO,
        },
      ],
    });
  }

  function novoUsuario(nome: string, email: string): UsuarioDemo {
    const u: UsuarioDemo = { id: novoId(), nome, email: email.trim().toLowerCase(), contas: [] };
    usuarios.push(u);
    return u;
  }

  const conviteValido = (token: string) => {
    const convite = convites.get(token);
    return convite && !convite.usado ? convite : null;
  };
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

  const configuracoes = criarConfiguracoesSimuladas({ autenticado, usuarios });
  const contatos = criarContatosSimulados({ autenticado, usuarios });

  const handlers = [
    // Contatos antes das Configurações: GET /v1/membros/opcoes vem antes de /v1/membros/:id.
    ...contatos.handlers,
    ...configuracoes.handlers,
    http.post(`*${ROTAS_AUTH.login}`, async ({ request }) => {
      const entrada = EntradaLogin.safeParse(await request.json().catch(() => undefined));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const email = entrada.data.email.trim().toLowerCase();
      const u = usuarios.find((x) => x.email === email);
      if (!u || entrada.data.senha !== SENHA_DEMO) return problema('nao_autenticado');
      return HttpResponse.json(abrirSessao(u, u.contas[0]!.conta.tenant_id));
    }),

    http.post(`*${ROTAS_AUTH.registrar}`, async ({ request }) => {
      const entrada = EntradaRegistro.safeParse(await request.json().catch(() => undefined));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const { nome, email, senha, conta, empresa } = entrada.data;
      if (senhaFraca(senha, email, nome)) return problemaSenhaFraca();
      // E-mail já cadastrado: na API real, só com a senha dele; aqui, sempre recusa.
      if (porEmail(email)) return problema('nao_autenticado');
      const u = novoUsuario(nome, email);
      const tenantId = novoId();
      vincular(u, tenantId, conta.nome, empresa.nome_fantasia);
      return HttpResponse.json(abrirSessao(u, tenantId), { status: 201 });
    }),

    http.post(`*${ROTAS_CONVITES.consultar}`, async ({ request }) => {
      const entrada = EntradaTokenConvite.safeParse(await request.json().catch(() => undefined));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const convite = conviteValido(entrada.data.token);
      if (!convite) return problema('link_invalido');
      const consulta: ConsultaConvite = {
        conta: { nome: convite.nomeConta },
        email: convite.email,
        acao: convite.acao,
      };
      return HttpResponse.json(consulta);
    }),

    http.post(`*${ROTAS_CONVITES.aceitar}`, async ({ request }) => {
      const entrada = EntradaAceite.safeParse(await request.json().catch(() => undefined));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const { token, nome, senha } = entrada.data;
      const convite = conviteValido(token);
      if (!convite) return problema('link_invalido');
      const existente = porEmail(convite.email);
      if (existente && vinculoDaConta(existente, convite.tenantId)) return problema('duplicado');
      if (convite.acao === 'SENHA_ATUAL' && senha !== SENHA_DEMO)
        return problema('nao_autenticado');
      if (
        convite.acao !== 'SENHA_ATUAL' &&
        (senha.length < 12 || senhaFraca(senha, convite.email, nome))
      )
        return problemaSenhaFraca();
      if (convite.acao === 'CRIAR_ACESSO' && !nome)
        return problema('validacao', {
          campos: [{ campo: 'nome', code: 'invalid_type', mensagem: 'Campo obrigatório.' }],
        });
      const u = existente ?? novoUsuario(nome!, convite.email);
      vincular(u, convite.tenantId, convite.nomeConta, convite.nomeConta);
      convites.set(token, { ...convite, usado: true });
      return HttpResponse.json(abrirSessao(u, convite.tenantId), { status: 201 });
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
      const u = usuarios.find((x) => x.email === email)!;
      gravarRefresh({
        usuarioId: u.id,
        tenantId: tenantId ?? u.contas[0]!.conta.tenant_id,
        token: 'sim-refresh-inicial',
      });
    },
    /** Testes: vence todos os access tokens (o próximo uso dá 401). */
    expirarAcessos: () => acessos.clear(),
    /** Testes: encerra a sessão no servidor (como um logout feito em outro lugar). */
    revogarRefresh: () => gravarRefresh(null),
    temRefresh: () => refresh !== null,
    configuracoes,
    contatos,
    /**
     * Testes: troca as permissões de quem tem este e-mail em todas as empresas da conta dada (a
     * primeira, por padrão). Vale a partir do próximo /v1/eu.
     */
    definirPermissoes(email: string, permissoes: EmpresaDoMembro['permissoes'], tenantId?: string) {
      const u = usuarios.find((x) => x.email === email)!;
      const vinculo = tenantId ? vinculoDaConta(u, tenantId)! : u.contas[0]!;
      vinculo.empresas = vinculo.empresas.map((e) => ({ ...e, permissoes }));
    },
    /**
     * Testes: um convite pendente para a conta dada; devolve o token do link. A ação segue quem é
     * o e-mail (CRIAR_ACESSO para e-mail novo, SENHA_ATUAL para um usuário da demonstração).
     */
    criarConvite(
      email: string,
      acao: ConsultaConvite['acao'],
      conta = { tenant_id: '0190a000-0000-7000-8000-000000000002', nome: 'Oficina do Bairro' },
    ) {
      const token = `${'t'.repeat(11)}${crypto.randomUUID().replaceAll('-', '')}`;
      convites.set(token, {
        tenantId: conta.tenant_id,
        nomeConta: conta.nome,
        email,
        acao,
        usado: false,
      });
      return token;
    },
    contagem,
  };
}

export type ApiSimulada = ReturnType<typeof criarApiSimulada>;
