import {
  camposDoZod,
  type CodigoErro,
  type Consentimento,
  ConsultaContatos,
  type Contato,
  criarProblema,
  EdicaoContato,
  EntradaConsentimento,
  EntradaContato,
  type EscopoPermissao,
  type OpcaoResponsavel,
  type Origem,
  ROTAS_CONTATOS,
  ROTAS_MEMBROS,
  ROTAS_ORIGENS,
} from '@ebisu/contracts';
import { http, HttpResponse } from 'msw';
import type { BaseSimulada } from './configuracoes-simulada';

// API simulada de contatos (plano docs/planos/f4-web-1-contatos.md, decisão 10): contatos,
// consentimentos, origens e as opções de responsável, com as regras que a tela mostra (dedupe com
// `id_existente`, busca sem acento, filtros, escopo PROPRIO). Estado por empresa, semeado na
// primeira chamada.

interface Empresa {
  contatos: Contato[];
  origens: Origem[];
  /** Por contato, do mais antigo ao mais recente. */
  consentimentos: Map<string, Consentimento[]>;
}

const problema = (code: CodigoErro, opcoes?: Parameters<typeof criarProblema>[1]) => {
  const corpo = criarProblema(code, opcoes);
  return HttpResponse.json(corpo, { status: corpo.status });
};
const invalido = (campo: string, mensagem: string) =>
  problema('validacao', { campos: [{ campo, code: 'custom', mensagem }] });
const agora = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();
const corpo = async (request: Request) => request.json().catch(() => undefined);

const ORIGENS: Array<[string, Origem['tipo']]> = [
  ['Balcão', 'BALCAO'],
  ['Indicação', 'INDICACAO'],
  ['Instagram', 'INSTAGRAM'],
  ['Site', 'FORMULARIO_SITE'],
];

/** Sem acento, minúsculas e espaços simples (como o `nome_busca` da API). */
export const normalizarBusca = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** E.164 simplificado: `+` com DDI fica; 10 ou 11 dígitos são do Brasil; o resto é inválido. */
export function telefoneSimulado(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');
  if (entrada.trim().startsWith('+')) return digitos.length >= 8 ? `+${digitos}` : null;
  return digitos.length === 10 || digitos.length === 11 ? `+55${digitos}` : null;
}

/** Ids fixos dos contatos semeados (os mesmos em cada empresa): links estáveis no `pnpm dev`. */
const ID_SEMEADO = (n: number) => `0190a000-0000-7000-8000-${String(200 + n).padStart(12, '0')}`;

function contatoNovo(empresaId: string, dados: Partial<Contato> & { nome: string }): Contato {
  return {
    id: novoId(),
    empresa_id: empresaId,
    tipo_pessoa: 'PF',
    documento: null,
    email: null,
    telefone_e164: null,
    whatsapp_e164: null,
    canal_preferido: null,
    data_nascimento: null,
    endereco: null,
    origem_id: null,
    responsavel_id: null,
    observacoes: null,
    ciclo_vida: 'LEAD',
    score_total: 0,
    temperatura: 'FRIO',
    quadrante: 'PROSPECTAR',
    completude_perfil: 0,
    campos_faltantes: [],
    ultima_interacao_em: null,
    consentimentos: [],
    created_at: agora(),
    updated_at: agora(),
    ...dados,
  };
}

const MEIOS = [
  ['email', 'email'],
  ['telefone', 'telefone_e164'],
  ['whatsapp', 'whatsapp_e164'],
] as const;

export function criarContatosSimulados({ autenticado, usuarios }: BaseSimulada) {
  const empresas = new Map<string, Empresa>();

  function semear(empresaId: string): Empresa {
    const origens = ORIGENS.map(([nome, tipo]) => ({ id: novoId(), nome, tipo, ativo: true }));
    // Os mais recentes primeiro na lista: criados em ordem.
    const contatos = [
      contatoNovo(empresaId, {
        id: ID_SEMEADO(1),
        nome: 'Pedro Henrique',
        email: 'pedro@cliente.test',
        ciclo_vida: 'CLIENTE',
      }),
      contatoNovo(empresaId, {
        id: ID_SEMEADO(2),
        nome: 'Maria Sá',
        telefone_e164: '+5521998765432',
        origem_id: origens[2]!.id,
      }),
      contatoNovo(empresaId, {
        id: ID_SEMEADO(3),
        nome: 'João Araújo',
        email: 'joao@cliente.test',
        telefone_e164: '+5511987654321',
        origem_id: origens[1]!.id,
      }),
    ].reverse();
    return { contatos, origens, consentimentos: new Map() };
  }

  const daEmpresa = (empresaId: string) => {
    let empresa = empresas.get(empresaId);
    if (!empresa) empresas.set(empresaId, (empresa = semear(empresaId)));
    return empresa;
  };

  /** Quem age, na empresa do cabeçalho; null se não autenticado ou sem acesso à empresa. */
  function contexto(request: Request) {
    const vinculo = autenticado(request);
    if (!vinculo) return { erro: problema('nao_autenticado') } as const;
    const u = usuarios.find((x) => x.id === vinculo.usuarioId)!;
    const daConta = u.contas.find((c) => c.conta.tenant_id === vinculo.tenantId)!;
    const empresaId = request.headers.get('x-empresa-id') ?? '';
    const empresa = daConta.empresas.find((e) => e.id === empresaId);
    if (!empresa) return { erro: problema('sem_permissao') } as const;
    const escopo = (chave: string): EscopoPermissao | undefined => empresa.permissoes[chave];
    return {
      tenantId: vinculo.tenantId,
      empresaId,
      membroId: daConta.membroId,
      escopo,
      dados: daEmpresa(empresaId),
    } as const;
  }
  type Ctx = Exclude<ReturnType<typeof contexto>, { erro: unknown }>;

  /** Contexto com a permissão; senão a resposta de erro. */
  function exigir(request: Request, chave: string): Ctx | { erro: Response } {
    const c = contexto(request);
    if ('erro' in c) return c;
    if (!c.escopo(chave)) return { erro: problema('sem_permissao') };
    return c;
  }

  const visivel = (c: Ctx, k: Contato) =>
    c.escopo('contato.read') !== 'PROPRIO' || k.responsavel_id === c.membroId;
  const doId = (c: Ctx, id: string | undefined) =>
    c.dados.contatos.find((k) => k.id === id && visivel(c, k));

  const responsaveis = (c: Pick<Ctx, 'tenantId' | 'empresaId'>): OpcaoResponsavel[] =>
    usuarios
      .flatMap((u) =>
        u.contas
          .filter(
            (v) => v.conta.tenant_id === c.tenantId && v.empresas.some((e) => e.id === c.empresaId),
          )
          .map((v) => ({ id: v.membroId, nome: u.nome })),
      )
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  /** Normaliza os meios e confere dedupe e referências; devolve os campos ou a resposta de erro. */
  function preparar(
    c: Ctx,
    entrada: Partial<EdicaoContato>,
    excetoId?: string,
  ): Partial<Contato> | Response {
    const { telefone, whatsapp, email, ...resto } = entrada;
    const campos: Partial<Contato> = { ...resto } as Partial<Contato>;
    for (const [campo, valor] of [
      ['telefone', telefone],
      ['whatsapp', whatsapp],
    ] as const) {
      if (valor === undefined) continue;
      const e164 = valor === null ? null : telefoneSimulado(valor);
      if (valor !== null && !e164) return invalido(campo, 'Telefone inválido.');
      campos[campo === 'telefone' ? 'telefone_e164' : 'whatsapp_e164'] = e164;
    }
    if (email !== undefined) campos.email = email;
    if (entrada.documento) campos.documento = entrada.documento.replace(/\W/g, '').toUpperCase();
    if (entrada.origem_id && !c.dados.origens.some((o) => o.id === entrada.origem_id && o.ativo))
      return invalido('origem_id', 'Origem inválida ou inativa.');
    if (entrada.responsavel_id) {
      if (!responsaveis(c).some((r) => r.id === entrada.responsavel_id))
        return invalido('responsavel_id', 'Responsável sem acesso à empresa.');
    }
    for (const [campo, coluna] of MEIOS) {
      const valor = campos[coluna];
      if (!valor) continue;
      const igual = (k: Contato) =>
        coluna === 'email' ? k.email?.toLowerCase() === valor.toLowerCase() : k[coluna] === valor;
      const existente = c.dados.contatos.find((k) => k.id !== excetoId && igual(k));
      if (existente) {
        const mostrarId = visivel(c, existente);
        return problema('duplicado', {
          detail: 'Já existe um contato com este meio de contato na empresa.',
          extras: { campo, ...(mostrarId ? { id_existente: existente.id } : {}) },
        });
      }
    }
    return campos;
  }

  const comSituacao = (c: Ctx, k: Contato): Contato => {
    const historico = c.dados.consentimentos.get(k.id) ?? [];
    const atual = new Map<string, Consentimento>();
    for (const r of historico) atual.set(`${r.canal}:${r.finalidade}`, r);
    return {
      ...k,
      consentimentos: [...atual.values()].map(({ canal, finalidade, concedido, coletado_em }) => ({
        canal,
        finalidade,
        concedido,
        coletado_em,
      })),
    };
  };

  function filtrar(c: Ctx, consulta: ConsultaContatos) {
    const termo = consulta.q ? normalizarBusca(consulta.q) : '';
    const digitos = consulta.q?.replace(/\D/g, '') ?? '';
    return c.dados.contatos
      .filter((k) => visivel(c, k))
      .filter(
        (k) =>
          !termo ||
          normalizarBusca(k.nome).includes(termo) ||
          (k.email ?? '').toLowerCase().includes(termo) ||
          (digitos.length >= 3 &&
            [k.telefone_e164, k.whatsapp_e164].some((t) => t?.includes(digitos))),
      )
      .filter(
        (k) => !consulta['filtro[origem_id]'] || k.origem_id === consulta['filtro[origem_id]'],
      )
      .filter(
        (k) =>
          !consulta['filtro[responsavel_id]'] ||
          k.responsavel_id === consulta['filtro[responsavel_id]'],
      )
      .filter(
        (k) => !consulta['filtro[ciclo_vida]'] || k.ciclo_vida === consulta['filtro[ciclo_vida]'],
      )
      .reverse();
  }

  const rota = ROTAS_CONTATOS.contatos;
  const handlers = [
    http.get(`*${ROTAS_MEMBROS.opcoes}`, ({ request }) => {
      const c = exigir(request, 'contato.read');
      if ('erro' in c) return c.erro;
      return HttpResponse.json({ dados: responsaveis(c) });
    }),

    http.get(`*${ROTAS_ORIGENS.origens}`, ({ request }) => {
      const c = exigir(request, 'contato.read');
      if ('erro' in c) return c.erro;
      return HttpResponse.json({ dados: c.dados.origens });
    }),

    http.get(`*${rota}`, ({ request }) => {
      const c = exigir(request, 'contato.read');
      if ('erro' in c) return c.erro;
      const consulta = ConsultaContatos.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!consulta.success) return problema('validacao', { campos: camposDoZod(consulta.error) });
      const todos = filtrar(c, consulta.data);
      const inicio = consulta.data.cursor ? Number(consulta.data.cursor) : 0;
      const fim = inicio + consulta.data.limit;
      return HttpResponse.json({
        dados: todos.slice(inicio, fim).map((k) => comSituacao(c, k)),
        proximo_cursor: fim < todos.length ? String(fim) : null,
      });
    }),

    http.get(`*${rota}/:id`, ({ request, params }) => {
      const c = exigir(request, 'contato.read');
      if ('erro' in c) return c.erro;
      const k = doId(c, params.id as string);
      return k ? HttpResponse.json(comSituacao(c, k)) : problema('nao_encontrado');
    }),

    http.post(`*${rota}`, async ({ request }) => {
      const c = exigir(request, 'contato.create');
      if ('erro' in c) return c.erro;
      const entrada = EntradaContato.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const proprio = c.escopo('contato.create') === 'PROPRIO';
      if (proprio && entrada.data.responsavel_id && entrada.data.responsavel_id !== c.membroId)
        return problema('sem_permissao');
      const campos = preparar(c, {
        ...entrada.data,
        ...(proprio ? { responsavel_id: c.membroId } : {}),
      });
      if (campos instanceof Response) return campos;
      const k = contatoNovo(c.empresaId, { nome: entrada.data.nome, ...campos });
      c.dados.contatos.push(k);
      return HttpResponse.json(comSituacao(c, k), { status: 201 });
    }),

    http.patch(`*${rota}/:id`, async ({ request, params }) => {
      const c = exigir(request, 'contato.update');
      if ('erro' in c) return c.erro;
      const k = doId(c, params.id as string);
      if (!k) return problema('nao_encontrado');
      const edicao = EdicaoContato.safeParse(await corpo(request));
      if (!edicao.success) return problema('validacao', { campos: camposDoZod(edicao.error) });
      const campos = preparar(c, edicao.data, k.id);
      if (campos instanceof Response) return campos;
      const editado: Contato = { ...k, ...campos, updated_at: agora() };
      if (!editado.email && !editado.telefone_e164 && !editado.whatsapp_e164)
        return invalido('email', 'Informe e-mail, telefone ou WhatsApp');
      c.dados.contatos = c.dados.contatos.map((x) => (x.id === k.id ? editado : x));
      return HttpResponse.json(comSituacao(c, editado));
    }),

    http.delete(`*${rota}/:id`, ({ request, params }) => {
      const c = exigir(request, 'contato.delete');
      if ('erro' in c) return c.erro;
      const k = doId(c, params.id as string);
      if (!k) return problema('nao_encontrado');
      c.dados.contatos = c.dados.contatos.filter((x) => x.id !== k.id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`*${rota}/:id/consentimentos`, ({ request, params }) => {
      const c = exigir(request, 'contato.read');
      if ('erro' in c) return c.erro;
      const k = doId(c, params.id as string);
      if (!k) return problema('nao_encontrado');
      const historico = c.dados.consentimentos.get(k.id) ?? [];
      return HttpResponse.json({ dados: [...historico].reverse() });
    }),

    http.post(`*${rota}/:id/consentimentos`, async ({ request, params }) => {
      const c = exigir(request, 'contato.update');
      if ('erro' in c) return c.erro;
      const k = doId(c, params.id as string);
      if (!k) return problema('nao_encontrado');
      const entrada = EntradaConsentimento.safeParse(await corpo(request));
      if (!entrada.success) return problema('validacao', { campos: camposDoZod(entrada.error) });
      const registro: Consentimento = {
        id: novoId(),
        ...entrada.data,
        evidencia: entrada.data.evidencia ?? null,
        coletado_em: agora(),
      };
      c.dados.consentimentos.set(k.id, [...(c.dados.consentimentos.get(k.id) ?? []), registro]);
      return HttpResponse.json(registro, { status: 201 });
    }),
  ];

  return {
    handlers,
    /** Testes: os contatos da empresa, como estão na simulação. */
    contatos: (empresaId: string) => daEmpresa(empresaId).contatos,
  };
}
