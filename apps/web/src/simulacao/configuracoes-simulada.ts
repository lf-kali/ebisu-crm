import {
  type ApiKey,
  type AtribuicaoDoMembro,
  camposDoZod,
  type CodigoErro,
  type Convite,
  criarProblema,
  EdicaoApiKey,
  EdicaoEmpresa,
  EdicaoMembro,
  type Empresa,
  EntradaApiKey,
  EntradaAtribuicoes,
  EntradaConvite,
  EntradaEmpresa,
  type EscopoPermissao,
  type Membro,
  normalizarCnpj,
  type Papel,
  ROTAS_API_KEYS,
  ROTAS_CONVITES,
  ROTAS_EMPRESAS,
  ROTAS_MEMBROS,
} from '@ebisu/contracts';
import { http, HttpResponse } from 'msw';
import type { UsuarioDemo } from './dados';

// API simulada das Configurações (plano docs/planos/f3-web-2-configuracoes.md, decisão 8): as
// rotas de empresas, membros, papéis, convites e API keys, com as regras que as telas exibem (dono,
// última empresa, duplicados, token só na criação). Estado por conta, montado na primeira chamada
// a partir dos usuários da demonstração.

interface Vinculo {
  usuarioId: string;
  tenantId: string;
}

export interface BaseSimulada {
  autenticado(request: Request): Vinculo | undefined;
  usuarios: UsuarioDemo[];
}

interface MembroSimulado {
  id: string;
  usuarioId: string;
  status: Membro['status'];
  cargo: string | null;
  atribuicoes: AtribuicaoDoMembro[];
  created_at: string;
}

interface Conta {
  empresas: Empresa[];
  papeis: Papel[];
  membros: MembroSimulado[];
  convites: Convite[];
  /** Por empresa. */
  chaves: Map<string, ApiKey[]>;
}

const problema = (code: CodigoErro, opcoes?: Parameters<typeof criarProblema>[1]) => {
  const corpo = criarProblema(code, opcoes);
  return HttpResponse.json(corpo, { status: corpo.status });
};
const invalido = (campo: string, mensagem: string) =>
  problema('validacao', { campos: [{ campo, code: 'custom', mensagem }] });
const sem = () => new HttpResponse(null, { status: 204 });
const agora = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();
const corpo = async (request: Request) => request.json().catch(() => undefined);

const PAPEIS: Array<[string, string, Record<string, EscopoPermissao>]> = [
  ['OWNER', 'Proprietário', { 'config.empresa': 'TENANT', 'config.membros': 'TENANT' }],
  ['ADMIN', 'Administrador', { 'config.empresa': 'TENANT', 'config.membros': 'TENANT' }],
  ['ATENDENTE', 'Atendente', { 'contato.read': 'EMPRESA', 'contato.create': 'EMPRESA' }],
  ['TECNICO', 'Técnico', { 'os.read': 'PROPRIO', 'os.update': 'PROPRIO' }],
];

export function criarConfiguracoesSimuladas({ autenticado, usuarios }: BaseSimulada) {
  const contas = new Map<string, Conta>();

  function montarConta(tenantId: string): Conta {
    const papeis: Papel[] = PAPEIS.map(([chave, nome, permissoes]) => ({
      id: novoId(),
      chave,
      nome,
      descricao: null,
      sistema: true,
      permissoes,
    }));
    const papel = (chave: string) => {
      const p = papeis.find((x) => x.chave === chave)!;
      return { id: p.id, chave: p.chave, nome: p.nome };
    };
    const empresas = new Map<string, Empresa>();
    const membros: MembroSimulado[] = [];
    for (const u of usuarios) {
      const vinculo = u.contas.find((c) => c.conta.tenant_id === tenantId);
      if (!vinculo) continue;
      for (const e of vinculo.empresas)
        empresas.set(e.id, {
          id: e.id,
          razao_social: e.razao_social,
          nome_fantasia: e.nome_fantasia,
          cnpj: null,
          ativo: true,
          created_at: agora(),
        });
      // Quem tem config.membros com TENANT é dono; o resto, técnico na primeira empresa.
      const dono = vinculo.empresas.some((e) => e.permissoes['config.membros'] === 'TENANT');
      membros.push({
        id: vinculo.membroId,
        usuarioId: u.id,
        status: 'ATIVO',
        cargo: null,
        created_at: agora(),
        atribuicoes: [
          dono
            ? { id: novoId(), papel: papel('OWNER'), empresa_id: null }
            : { id: novoId(), papel: papel('TECNICO'), empresa_id: vinculo.empresas[0]!.id },
        ],
      });
    }
    return { empresas: [...empresas.values()], papeis, membros, convites: [], chaves: new Map() };
  }

  const contaDe = (tenantId: string) => {
    let conta = contas.get(tenantId);
    if (!conta) contas.set(tenantId, (conta = montarConta(tenantId)));
    return conta;
  };

  const ehDono = (m: MembroSimulado | undefined) =>
    !!m &&
    m.status === 'ATIVO' &&
    m.atribuicoes.some((a) => a.papel.chave === 'OWNER' && a.empresa_id === null);

  const paraMembro = (m: MembroSimulado): Membro => {
    const u = usuarios.find((x) => x.id === m.usuarioId)!;
    return {
      id: m.id,
      usuario: { nome: u.nome, email: u.email },
      status: m.status,
      cargo: m.cargo,
      atribuicoes: m.atribuicoes,
      created_at: m.created_at,
    };
  };

  /** Contexto da requisição: conta e o membro de quem age; 401 se não autenticado. */
  function contexto(request: Request) {
    const vinculo = autenticado(request);
    if (!vinculo) return null;
    const conta = contaDe(vinculo.tenantId);
    const u = usuarios.find((x) => x.id === vinculo.usuarioId)!;
    const membroId = u.contas.find((c) => c.conta.tenant_id === vinculo.tenantId)!.membroId;
    return { vinculo, conta, eu: conta.membros.find((m) => m.id === membroId), usuario: u };
  }

  /** Empresa nova ou desativada aparece (ou some) no /v1/eu de quem tem todas as empresas. */
  function refletirNoEu(tenantId: string, empresa: Empresa) {
    for (const u of usuarios) {
      const vinculo = u.contas.find((c) => c.conta.tenant_id === tenantId);
      const membro = contaDe(tenantId).membros.find((m) => m.id === vinculo?.membroId);
      if (!vinculo || !membro?.atribuicoes.some((a) => a.empresa_id === null)) continue;
      vinculo.empresas = vinculo.empresas.filter((e) => e.id !== empresa.id);
      if (empresa.ativo)
        vinculo.empresas.push({
          id: empresa.id,
          nome_fantasia: empresa.nome_fantasia,
          razao_social: empresa.razao_social,
          logo_url: null,
          permissoes: vinculo.empresas[0]?.permissoes ?? {},
        });
    }
  }

  /** Atribuições do corpo com o papel completo; 422 se papel ou empresa não forem da conta. */
  function atribuicoesDe(conta: Conta, entrada: EntradaAtribuicoes['atribuicoes']) {
    const resultado: AtribuicaoDoMembro[] = [];
    for (const a of entrada) {
      const p = conta.papeis.find((x) => x.id === a.papel_id);
      const empresaOk = a.empresa_id === null || conta.empresas.some((e) => e.id === a.empresa_id);
      if (!p || !empresaOk) return null;
      resultado.push({
        id: novoId(),
        papel: { id: p.id, chave: p.chave, nome: p.nome },
        empresa_id: a.empresa_id,
      });
    }
    return resultado;
  }
  const temDonoEm = (lista: { papel: { chave: string } }[]) =>
    lista.some((a) => a.papel.chave === 'OWNER');

  const empresasHandlers = [
    http.get(`*${ROTAS_EMPRESAS.empresas}`, ({ request }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      return HttpResponse.json({ dados: c.conta.empresas, proximo_cursor: null });
    }),
    http.post(`*${ROTAS_EMPRESAS.empresas}`, async ({ request }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EntradaEmpresa.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const cnpj = entrada.data.cnpj ? normalizarCnpj(entrada.data.cnpj) : null;
      const repetida = cnpj && c.conta.empresas.find((e) => e.cnpj === cnpj);
      if (repetida) return problema('duplicado', { extras: { id_existente: repetida.id } });
      const empresa: Empresa = {
        id: novoId(),
        razao_social: entrada.data.razao_social,
        nome_fantasia: entrada.data.nome_fantasia,
        cnpj,
        ativo: true,
        created_at: agora(),
      };
      c.conta.empresas.push(empresa);
      refletirNoEu(c.vinculo.tenantId, empresa);
      return HttpResponse.json(empresa, { status: 201 });
    }),
    http.patch(`*${ROTAS_EMPRESAS.empresas}/:id`, async ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EdicaoEmpresa.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const atual = c.conta.empresas.find((e) => e.id === params.id);
      if (!atual) return problema('nao_encontrado');
      const { cnpj, ...resto } = entrada.data;
      const novoCnpj = cnpj === undefined ? atual.cnpj : cnpj && normalizarCnpj(cnpj);
      const repetida = novoCnpj && c.conta.empresas.find((e) => e.cnpj === novoCnpj && e !== atual);
      if (repetida) return problema('duplicado', { extras: { id_existente: repetida.id } });
      Object.assign(atual, resto, { cnpj: novoCnpj });
      refletirNoEu(c.vinculo.tenantId, atual);
      return HttpResponse.json(atual);
    }),
    http.delete(`*${ROTAS_EMPRESAS.empresas}/:id`, ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const atual = c.conta.empresas.find((e) => e.id === params.id);
      if (!atual) return problema('nao_encontrado');
      if (atual.ativo && c.conta.empresas.filter((e) => e.ativo).length === 1)
        return problema('transicao_invalida', {
          detail: 'A conta precisa de ao menos uma empresa ativa.',
        });
      atual.ativo = false;
      refletirNoEu(c.vinculo.tenantId, atual);
      return sem();
    }),
  ];

  const membrosHandlers = [
    http.get(`*${ROTAS_MEMBROS.papeis}`, ({ request }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      return HttpResponse.json({ dados: c.conta.papeis });
    }),
    http.get(`*${ROTAS_MEMBROS.membros}`, ({ request }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      return HttpResponse.json({ dados: c.conta.membros.map(paraMembro), proximo_cursor: null });
    }),
    http.get(`*${ROTAS_MEMBROS.membros}/:id`, ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const m = c.conta.membros.find((x) => x.id === params.id);
      return m ? HttpResponse.json(paraMembro(m)) : problema('nao_encontrado');
    }),
    http.patch(`*${ROTAS_MEMBROS.membros}/:id`, async ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EdicaoMembro.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const m = c.conta.membros.find((x) => x.id === params.id);
      if (!m) return problema('nao_encontrado');
      const { status, cargo } = entrada.data;
      if (status && status !== m.status) {
        if (m === c.eu)
          return problema('transicao_invalida', {
            detail: 'Você não pode mudar a própria situação.',
          });
        if (ehDono(m) && !ehDono(c.eu))
          return problema('sem_permissao', {
            detail: 'Só um dono da conta mexe no papel de dono.',
          });
        if (status === 'SUSPENSO' && ehDono(m) && c.conta.membros.filter(ehDono).length === 1)
          return problema('transicao_invalida', { detail: 'A conta precisa de um dono ativo.' });
        m.status = status;
      }
      if (cargo !== undefined) m.cargo = cargo;
      return HttpResponse.json(paraMembro(m));
    }),
    http.put(`*${ROTAS_MEMBROS.membros}/:id/atribuicoes`, async ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EntradaAtribuicoes.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const m = c.conta.membros.find((x) => x.id === params.id);
      if (!m) return problema('nao_encontrado');
      const novas = atribuicoesDe(c.conta, entrada.data.atribuicoes);
      if (!novas) return invalido('atribuicoes', 'Papel ou empresa inexistente.');
      if (novas.some((a) => a.papel.chave === 'OWNER' && a.empresa_id !== null))
        return invalido('atribuicoes', 'O papel de dono vale para todas as empresas.');
      const mexeNoDono = temDonoEm(novas) !== temDonoEm(m.atribuicoes);
      if (mexeNoDono && !ehDono(c.eu))
        return problema('sem_permissao', { detail: 'Só um dono da conta mexe no papel de dono.' });
      if (ehDono(m) && !temDonoEm(novas) && c.conta.membros.filter(ehDono).length === 1)
        return problema('transicao_invalida', { detail: 'A conta precisa de um dono ativo.' });
      m.atribuicoes = novas;
      return HttpResponse.json(paraMembro(m));
    }),
  ];

  const convitesHandlers = [
    http.get(`*${ROTAS_CONVITES.convites}`, ({ request }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      return HttpResponse.json({ dados: c.conta.convites, proximo_cursor: null });
    }),
    http.post(`*${ROTAS_CONVITES.convites}`, async ({ request }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EntradaConvite.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const email = entrada.data.email.trim().toLowerCase();
      const atribuicoes = atribuicoesDe(c.conta, entrada.data.atribuicoes);
      if (!atribuicoes) return invalido('atribuicoes', 'Papel ou empresa inexistente.');
      if (temDonoEm(atribuicoes) && !ehDono(c.eu))
        return problema('sem_permissao', { detail: 'Só um dono da conta mexe no papel de dono.' });
      const jaMembro = c.conta.membros.some(
        (m) => usuarios.find((u) => u.id === m.usuarioId)?.email === email,
      );
      if (jaMembro) return problema('duplicado', { detail: 'Esta pessoa já é membro da conta.' });
      const pendente = c.conta.convites.find((x) => x.email === email);
      if (pendente)
        return problema('duplicado', {
          detail: 'Já há um convite pendente para este e-mail: reenvie.',
          extras: { id_existente: pendente.id },
        });
      const convite: Convite = {
        id: novoId(),
        email,
        atribuicoes: atribuicoes.map(({ papel, empresa_id }) => ({ papel, empresa_id })),
        expira_em: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        expirado: false,
        envio: 'PENDENTE',
        created_at: agora(),
      };
      c.conta.convites.push(convite);
      return HttpResponse.json(convite, { status: 201 });
    }),
    http.post(`*${ROTAS_CONVITES.convites}/:id/reenviar`, ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const convite = c.conta.convites.find((x) => x.id === params.id);
      if (!convite) return problema('nao_encontrado');
      Object.assign(convite, { envio: 'PENDENTE', expirado: false });
      return HttpResponse.json(convite);
    }),
    http.delete(`*${ROTAS_CONVITES.convites}/:id`, ({ request, params }) => {
      const c = contexto(request);
      if (!c) return problema('nao_autenticado');
      const antes = c.conta.convites.length;
      c.conta.convites = c.conta.convites.filter((x) => x.id !== params.id);
      return c.conta.convites.length < antes ? sem() : problema('nao_encontrado');
    }),
  ];

  /** Chaves da empresa do X-Empresa-Id, com as permissões de quem age nela. */
  function naEmpresa(request: Request) {
    const c = contexto(request);
    if (!c) return null;
    const empresaId = request.headers.get('x-empresa-id') ?? '';
    const vinculo = c.usuario.contas.find((x) => x.conta.tenant_id === c.vinculo.tenantId)!;
    const permissoes = vinculo.empresas.find((e) => e.id === empresaId)?.permissoes ?? {};
    let chaves = c.conta.chaves.get(empresaId);
    if (!chaves) c.conta.chaves.set(empresaId, (chaves = []));
    return { ...c, chaves, permissoes };
  }
  const escopoNegado = (escopos: string[], permissoes: Record<string, string>) =>
    escopos.find(
      (e) => e.startsWith('config.') || (permissoes[e] !== 'EMPRESA' && permissoes[e] !== 'TENANT'),
    );

  const chavesHandlers = [
    http.get(`*${ROTAS_API_KEYS.apiKeys}`, ({ request }) => {
      const c = naEmpresa(request);
      if (!c) return problema('nao_autenticado');
      return HttpResponse.json({ dados: c.chaves, proximo_cursor: null });
    }),
    http.post(`*${ROTAS_API_KEYS.apiKeys}`, async ({ request }) => {
      const c = naEmpresa(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EntradaApiKey.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const escopos = [...entrada.data.escopos];
      const negado = entrada.data.tipo === 'SERVIDOR' && escopoNegado(escopos, c.permissoes);
      if (negado) return invalido('escopos', `Escopo não permitido: ${negado}.`);
      const token = `ebk_live_${crypto.randomUUID().replaceAll('-', '')}${'x'.repeat(11)}`;
      const chave: ApiKey = {
        id: novoId(),
        nome: entrada.data.nome,
        tipo: entrada.data.tipo,
        prefixo: token.slice(0, 17),
        escopos,
        origens_cors: entrada.data.tipo === 'NAVEGADOR' ? entrada.data.origens_cors : [],
        expira_em: entrada.data.expira_em ?? null,
        revogada_em: null,
        ultimo_uso: null,
        criado_por: c.eu?.id ?? null,
        created_at: agora(),
      };
      c.chaves.push(chave);
      return HttpResponse.json({ ...chave, token }, { status: 201 });
    }),
    http.patch(`*${ROTAS_API_KEYS.apiKeys}/:id`, async ({ request, params }) => {
      const c = naEmpresa(request);
      if (!c) return problema('nao_autenticado');
      const entrada = EdicaoApiKey.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const chave = c.chaves.find((k) => k.id === params.id);
      if (!chave) return problema('nao_encontrado');
      if (chave.revogada_em)
        return problema('transicao_invalida', { detail: 'A chave está revogada.' });
      const negado = entrada.data.escopos && escopoNegado(entrada.data.escopos, c.permissoes);
      if (negado) return invalido('escopos', `Escopo não permitido: ${negado}.`);
      Object.assign(chave, entrada.data);
      return HttpResponse.json(chave);
    }),
    http.delete(`*${ROTAS_API_KEYS.apiKeys}/:id`, ({ request, params }) => {
      const c = naEmpresa(request);
      if (!c) return problema('nao_autenticado');
      const chave = c.chaves.find((k) => k.id === params.id);
      if (!chave) return problema('nao_encontrado');
      chave.revogada_em ??= agora();
      return sem();
    }),
  ];

  return {
    // Convites antes de membros: /v1/membros/convites casaria com /v1/membros/:id (como na API).
    handlers: [...empresasHandlers, ...convitesHandlers, ...membrosHandlers, ...chavesHandlers],
    /** Testes: o estado da conta (para conferir o que a tela gravou). */
    conta: contaDe,
  };
}
