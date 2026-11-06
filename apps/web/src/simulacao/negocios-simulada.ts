import {
  type Atividade,
  camposDoZod,
  type CodigoErro,
  ConsultaAtividades,
  ConsultaNegocios,
  ConsultaTarefas,
  type Contato,
  criarProblema,
  EdicaoAtividade,
  EdicaoNegocio,
  EdicaoTarefa,
  EntradaAtividade,
  EntradaMoverNegocio,
  EntradaNegocio,
  EntradaNutrirNegocio,
  EntradaPerderNegocio,
  EntradaTarefa,
  type EscopoPermissao,
  type Etapa,
  type Funil,
  type MotivoPerda,
  type Negocio,
  type NegocioDetalhado,
  type Requisito,
  ROTAS_ATIVIDADES,
  ROTAS_FUNIL,
  ROTAS_NEGOCIOS,
  ROTAS_ORIGENS,
  ROTAS_TAREFAS,
  type Tarefa,
} from '@ebisu/contracts';
import { http, HttpResponse } from 'msw';
import type { BaseSimulada } from './configuracoes-simulada';
import type { criarContatosSimulados } from './contatos-simulada';

// API simulada de funil, negócios, tarefas e atividades (plano docs/planos/f4-web-2-negocios.md,
// decisão 8), com as regras que as telas mostram: requisitos pendentes ao avançar (CRM-3),
// `versao_registro`, tarefas do funil, prazo de 24 horas das atividades e escopo PROPRIO. Estado por
// empresa, semeado na primeira chamada; os contatos vêm da simulação de contatos.

interface DadosCrm {
  funil: Funil;
  negocios: Negocio[];
  tarefas: Tarefa[];
  atividades: Atividade[];
  motivos: MotivoPerda[];
}

const problema = (code: CodigoErro, opcoes?: Parameters<typeof criarProblema>[1]) => {
  const corpo = criarProblema(code, opcoes);
  return HttpResponse.json(corpo, { status: corpo.status });
};
const invalido = (campo: string, mensagem: string) =>
  problema('validacao', { campos: [{ campo, code: 'custom', mensagem }] });
const transicao = (detail: string) => problema('transicao_invalida', { detail });
const agora = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();
const corpo = async (request: Request) => request.json().catch(() => undefined);
const consulta = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);
const sem = () => new HttpResponse(null, { status: 204 });

/** Ids fixos das etapas e dos negócios semeados: links estáveis no `pnpm dev`. */
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const ETAPAS_SIMULADAS = {
  novo: id(301),
  qualificacao: id(302),
  diagnostico: id(303),
  enviado: id(304),
  negociacao: id(305),
  ganho: id(306),
  perdido: id(307),
  nutricao: id(308),
} as const;
const DIA = 24 * 60 * 60 * 1000;

const requisito = (
  n: number,
  tipo: Requisito['tipo'],
  chave: string,
  descricao: string,
  titulo_tarefa: string | null = null,
): Requisito => ({
  id: id(400 + n),
  tipo,
  chave,
  descricao,
  obrigatorio: true,
  ordem: n,
  titulo_tarefa,
});

function funilPadrao(): Funil {
  const etapa = (
    chave: keyof typeof ETAPAS_SIMULADAS,
    nome: string,
    ordem: number,
    tipo: Etapa['tipo'],
    requisitos: Requisito[] = [],
  ): Etapa => ({
    id: ETAPAS_SIMULADAS[chave],
    nome,
    ordem,
    tipo,
    probabilidade: ordem * 10,
    sla_horas: tipo === 'ABERTA' ? 48 : null,
    cor: null,
    requisitos,
  });
  return {
    id: id(300),
    nome: 'Funil padrão',
    etapas: [
      etapa('novo', 'Novo contato', 1, 'ABERTA', [
        requisito(1, 'CAMPO', 'contato.nome', 'Nome do contato'),
        requisito(2, 'REGRA', 'contato_tem_meio_contato', 'Telefone ou e-mail'),
        requisito(3, 'REGRA', 'contato_tem_origem', 'Origem do lead'),
      ]),
      etapa('qualificacao', 'Qualificação', 2, 'ABERTA', [
        requisito(4, 'CAMPO', 'negocio.tipo_dispositivo', 'Tipo do dispositivo'),
        requisito(5, 'CAMPO', 'negocio.descricao_problema', 'Problema ou interesse'),
      ]),
      etapa('diagnostico', 'Diagnóstico / Orçamento', 3, 'ABERTA', [
        requisito(6, 'TAREFA', 'elaborar_orcamento', 'Orçamento elaborado', 'Elaborar orçamento'),
      ]),
      etapa('enviado', 'Orçamento enviado', 4, 'ABERTA', [
        requisito(7, 'TAREFA', 'follow_up', 'Follow-up registrado', 'Fazer follow-up'),
      ]),
      etapa('negociacao', 'Negociação', 5, 'ABERTA'),
      etapa('ganho', 'Ganho', 6, 'GANHO'),
      etapa('perdido', 'Perdido', 7, 'PERDIDO'),
      etapa('nutricao', 'Nutrição', 8, 'NUTRICAO', [
        requisito(8, 'CAMPO', 'negocio.nba_adiada_ate', 'Data de reativação'),
      ]),
    ],
  };
}

type Contatos = ReturnType<typeof criarContatosSimulados>;

export function criarNegociosSimulados(
  { autenticado, usuarios }: BaseSimulada,
  contatos: Pick<Contatos, 'contatos' | 'situacao' | 'atualizar'>,
) {
  const empresas = new Map<string, DadosCrm>();

  function negocioNovo(
    empresaId: string,
    etapaId: string,
    dados: Partial<Negocio> & { contato_id: string; titulo: string },
  ): Negocio {
    return {
      id: novoId(),
      empresa_id: empresaId,
      funil_id: id(300),
      etapa_id: etapaId,
      interesse: 'REPARO',
      tipo_dispositivo: null,
      dispositivo_id: null,
      descricao_problema: null,
      urgencia: null,
      valor_estimado: null,
      previsao_fechamento: null,
      status: 'ABERTO',
      motivo_perda_id: null,
      responsavel_id: null,
      entrou_etapa_em: agora(),
      fechado_em: null,
      completude: 0,
      nba_adiada_ate: null,
      versao_registro: 0,
      created_at: agora(),
      updated_at: agora(),
      ...dados,
    };
  }

  function semear(empresaId: string): DadosCrm {
    const idDe = (nome: string) => contatos.contatos(empresaId).find((k) => k.nome === nome)?.id;
    const [pedro, maria, joao] = ['Pedro Henrique', 'Maria Sá', 'João Araújo'].map(idDe);
    const negocios = [
      negocioNovo(empresaId, ETAPAS_SIMULADAS.novo, {
        id: id(501),
        contato_id: maria!,
        titulo: 'Bateria do notebook',
      }),
      negocioNovo(empresaId, ETAPAS_SIMULADAS.qualificacao, {
        id: id(502),
        contato_id: joao!,
        titulo: 'Troca de tela',
        valor_estimado: '450.00',
        entrou_etapa_em: new Date(Date.now() - 3 * DIA).toISOString(),
      }),
      negocioNovo(empresaId, ETAPAS_SIMULADAS.perdido, {
        id: id(503),
        contato_id: pedro!,
        titulo: 'Upgrade de memória',
        status: 'PERDIDO',
        fechado_em: agora(),
      }),
    ];
    const motivos = ['Preço', 'Prazo', 'Desistiu'].map((nome, i) => ({
      id: id(600 + i),
      nome,
      ativo: true,
    }));
    return { funil: funilPadrao(), negocios, tarefas: [], atividades: [], motivos };
  }

  const daEmpresa = (empresaId: string) => {
    let dados = empresas.get(empresaId);
    if (!dados) empresas.set(empresaId, (dados = semear(empresaId)));
    return dados;
  };

  /** Quem age, na empresa do cabeçalho, com a permissão pedida; senão a resposta de erro. */
  function exigir(request: Request, chave: string) {
    const vinculo = autenticado(request);
    if (!vinculo) return { erro: problema('nao_autenticado') } as const;
    const u = usuarios.find((x) => x.id === vinculo.usuarioId)!;
    const daConta = u.contas.find((c) => c.conta.tenant_id === vinculo.tenantId)!;
    const empresaId = request.headers.get('x-empresa-id') ?? '';
    const empresa = daConta.empresas.find((e) => e.id === empresaId);
    const escopo = (k: string): EscopoPermissao | undefined => empresa?.permissoes[k];
    if (!empresa || !escopo(chave)) return { erro: problema('sem_permissao') } as const;
    return { empresaId, membroId: daConta.membroId, escopo, dados: daEmpresa(empresaId) } as const;
  }
  type Ctx = Exclude<ReturnType<typeof exigir>, { erro: unknown }>;

  /** Membro com acesso à empresa (como `membroComAcesso` da API): senão, 422 no responsável. */
  const comAcesso = (c: Ctx, membroId: string) =>
    usuarios.some((u) =>
      u.contas.some((v) => v.membroId === membroId && v.empresas.some((e) => e.id === c.empresaId)),
    );
  const responsavelInvalido = () =>
    invalido('responsavel_id', 'Responsável sem acesso a esta empresa.');

  /** No escopo PROPRIO, só o que é da pessoa (responsável ou autor). */
  const meu = (c: Ctx, chave: string, dono: string | null) =>
    c.escopo(chave) !== 'PROPRIO' || dono === c.membroId;
  const contatoDe = (c: Ctx, contatoId: string, chave = 'contato.read') =>
    contatos
      .contatos(c.empresaId)
      .find((k) => k.id === contatoId && meu(c, chave, k.responsavel_id));
  const negocioDe = (c: Ctx, negocioId: string | undefined, chave: string) =>
    c.dados.negocios.find((n) => n.id === negocioId && meu(c, chave, n.responsavel_id));
  const etapa = (c: Ctx, etapaId: string) => c.dados.funil.etapas.find((e) => e.id === etapaId)!;

  /** O requisito está atendido com os dados do contato, do negócio e das tarefas. */
  function atendido(c: Ctx, r: Requisito, n: Negocio, contato: Contato | undefined) {
    if (r.tipo === 'TAREFA')
      return c.dados.tarefas.some(
        (t) => t.negocio_id === n.id && t.requisito_id === r.id && t.status === 'CONCLUIDA',
      );
    if (r.tipo === 'REGRA') {
      if (r.chave === 'contato_tem_meio_contato')
        return Boolean(contato?.email || contato?.telefone_e164 || contato?.whatsapp_e164);
      if (r.chave === 'contato_tem_origem') return Boolean(contato?.origem_id);
      return false;
    }
    const [entidade, coluna] = r.chave.split('.') as [string, string];
    const origem = (entidade === 'contato' ? contato : n) as Record<string, unknown> | undefined;
    const valor = origem?.[coluna];
    return valor !== null && valor !== undefined && valor !== '';
  }

  function detalhado(c: Ctx, n: Negocio): NegocioDetalhado {
    const contato = contatos.contatos(c.empresaId).find((k) => k.id === n.contato_id);
    const requisitos = etapa(c, n.etapa_id).requisitos.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      chave: r.chave,
      descricao: r.descricao,
      obrigatorio: r.obrigatorio,
      atendido: atendido(c, r, n, contato),
    }));
    const ok = requisitos.filter((r) => r.atendido).length;
    const completude = requisitos.length ? Math.round((100 * ok) / requisitos.length) : 100;
    return { ...n, completude, requisitos };
  }

  /** Grava o negócio com a versão nova e devolve o detalhado. */
  function gravar(c: Ctx, n: Negocio, campos: Partial<Negocio>) {
    const novo = { ...n, ...campos, versao_registro: n.versao_registro + 1, updated_at: agora() };
    c.dados.negocios = c.dados.negocios.map((x) => (x.id === n.id ? novo : x));
    return detalhado(c, novo);
  }

  /** Tarefas do funil da etapa, sem repetir uma pendente ou concluída do mesmo requisito. */
  function criarTarefasDaEtapa(c: Ctx, n: Negocio, etapaId: string) {
    for (const r of etapa(c, etapaId).requisitos.filter((x) => x.tipo === 'TAREFA')) {
      const ja = c.dados.tarefas.some(
        (t) => t.negocio_id === n.id && t.requisito_id === r.id && t.status !== 'CANCELADA',
      );
      if (!ja) c.dados.tarefas.push(tarefaNova(c, { ...n, origem: 'REQUISITO_ETAPA', r }));
    }
  }

  function tarefaNova(
    c: Ctx,
    {
      origem,
      r,
      ...n
    }: Pick<Negocio, 'id' | 'contato_id' | 'responsavel_id'> & {
      origem: Tarefa['origem'];
      r: Requisito;
    },
  ): Tarefa {
    return {
      id: novoId(),
      empresa_id: c.empresaId,
      contato_id: n.contato_id,
      negocio_id: n.id,
      titulo: r.titulo_tarefa ?? r.descricao,
      descricao: null,
      status: 'PENDENTE',
      prioridade: 'NORMAL',
      origem,
      requisito_id: r.id,
      vence_em: null,
      responsavel_id: n.responsavel_id,
      concluida_em: null,
      created_at: agora(),
      updated_at: agora(),
    };
  }

  /** CRM-3: obrigatórios não atendidos da origem até o destino (da nutrição, desde a 1ª). */
  function pendentes(c: Ctx, n: Negocio, destino: Etapa) {
    const abertas = c.dados.funil.etapas.filter((e) => e.tipo === 'ABERTA');
    const origem = n.status === 'NUTRICAO' ? abertas[0]! : etapa(c, n.etapa_id);
    if (destino.ordem <= origem.ordem) return [];
    const contato = contatos.contatos(c.empresaId).find((k) => k.id === n.contato_id);
    return abertas
      .filter((e) => e.ordem >= origem.ordem && e.ordem < destino.ordem)
      .flatMap((e) => e.requisitos)
      .filter((r) => r.obrigatorio && !atendido(c, r, n, contato))
      .map(({ id: rid, chave, descricao }) => ({ id: rid, chave, descricao }));
  }

  /** CRM-2: passar da segunda etapa aberta leva o contato LEAD a LEAD_QUALIFICADO. */
  function qualificarSePassou(c: Ctx, n: Negocio, destino: Etapa) {
    const abertas = c.dados.funil.etapas.filter((e) => e.tipo === 'ABERTA');
    const origem = n.status === 'NUTRICAO' ? abertas[0]! : etapa(c, n.etapa_id);
    const qualificacao = abertas[1];
    const contato = contatos.contatos(c.empresaId).find((k) => k.id === n.contato_id);
    const passou =
      qualificacao && origem.ordem <= qualificacao.ordem && destino.ordem > qualificacao.ordem;
    if (passou && contato?.ciclo_vida === 'LEAD')
      contatos.atualizar(c.empresaId, n.contato_id, { ciclo_vida: 'LEAD_QUALIFICADO' });
  }

  /** Negócio no escopo da permissão, com a versão que o cliente leu. */
  function exigirNegocio(c: Ctx, negocioId: string, chave: string, versao?: number) {
    const n = negocioDe(c, negocioId, chave);
    if (!n) return problema('nao_encontrado');
    if (versao !== undefined && versao !== n.versao_registro) return problema('conflito_versao');
    return n;
  }

  const handlersNegocios = criarHandlersNegocios();
  const handlersTarefas = criarHandlersTarefas();
  const handlersAtividades = criarHandlersAtividades();

  function criarHandlersNegocios() {
    const rota = ROTAS_NEGOCIOS.negocios;
    return [
      http.get(`*${ROTAS_FUNIL.funil}`, ({ request }) => {
        const c = exigir(request, 'negocio.read');
        return 'erro' in c ? c.erro : HttpResponse.json(c.dados.funil);
      }),
      http.get(`*${ROTAS_ORIGENS.motivosPerda}`, ({ request }) => {
        const c = exigir(request, 'contato.read');
        return 'erro' in c ? c.erro : HttpResponse.json({ dados: c.dados.motivos });
      }),
      http.get(`*${rota}`, ({ request }) => {
        const c = exigir(request, 'negocio.read');
        if ('erro' in c) return c.erro;
        const q = ConsultaNegocios.safeParse(consulta(request));
        if (!q.success) return problema('validacao', { campos: camposDoZod(q.error) });
        const termo = q.data.q?.toLowerCase();
        const todos = c.dados.negocios
          .filter((n) => meu(c, 'negocio.read', n.responsavel_id))
          .filter((n) => !termo || n.titulo.toLowerCase().includes(termo))
          .filter((n) => !q.data['filtro[etapa_id]'] || n.etapa_id === q.data['filtro[etapa_id]'])
          .filter((n) => !q.data['filtro[status]'] || n.status === q.data['filtro[status]'])
          .filter(
            (n) =>
              !q.data['filtro[responsavel_id]'] ||
              n.responsavel_id === q.data['filtro[responsavel_id]'],
          )
          .filter(
            (n) => !q.data['filtro[contato_id]'] || n.contato_id === q.data['filtro[contato_id]'],
          )
          .reverse();
        return pagina(
          todos.map((n) => ({ ...n, completude: detalhado(c, n).completude })),
          q.data,
        );
      }),
      http.get(`*${rota}/:id`, ({ request, params }) => {
        const c = exigir(request, 'negocio.read');
        if ('erro' in c) return c.erro;
        const n = exigirNegocio(c, params.id as string, 'negocio.read');
        return n instanceof Response ? n : HttpResponse.json(detalhado(c, n));
      }),
      http.post(`*${rota}`, async ({ request }) => {
        const c = exigir(request, 'negocio.create');
        if ('erro' in c) return c.erro;
        const e = EntradaNegocio.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        if (!contatoDe(c, e.data.contato_id))
          return invalido('contato_id', 'Contato inexistente nesta empresa.');
        const proprio = c.escopo('negocio.create') === 'PROPRIO';
        if (proprio && e.data.responsavel_id && e.data.responsavel_id !== c.membroId)
          return problema('sem_permissao');
        if (e.data.responsavel_id && !comAcesso(c, e.data.responsavel_id))
          return responsavelInvalido();
        const n = negocioNovo(c.empresaId, ETAPAS_SIMULADAS.novo, {
          ...e.data,
          ...(proprio ? { responsavel_id: c.membroId } : {}),
        } as Partial<Negocio> & { contato_id: string; titulo: string });
        c.dados.negocios.push(n);
        criarTarefasDaEtapa(c, n, n.etapa_id);
        return HttpResponse.json(detalhado(c, n), { status: 201 });
      }),
      http.patch(`*${rota}/:id`, async ({ request, params }) => {
        const c = exigir(request, 'negocio.update');
        if ('erro' in c) return c.erro;
        const e = EdicaoNegocio.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const { versao_registro, ...campos } = e.data;
        const n = exigirNegocio(c, params.id as string, 'negocio.update', versao_registro);
        if (campos.responsavel_id && !comAcesso(c, campos.responsavel_id))
          return responsavelInvalido();
        return n instanceof Response
          ? n
          : HttpResponse.json(gravar(c, n, campos as Partial<Negocio>));
      }),
      http.delete(`*${rota}/:id`, ({ request, params }) => {
        const c = exigir(request, 'negocio.delete');
        if ('erro' in c) return c.erro;
        const n = exigirNegocio(c, params.id as string, 'negocio.delete');
        if (n instanceof Response) return n;
        c.dados.negocios = c.dados.negocios.filter((x) => x.id !== n.id);
        return sem();
      }),
      http.post(`*${rota}/:id/mover`, async ({ request, params }) => {
        const c = exigir(request, 'negocio.update');
        if ('erro' in c) return c.erro;
        const e = EntradaMoverNegocio.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const n = exigirNegocio(c, params.id as string, 'negocio.update', e.data.versao_registro);
        if (n instanceof Response) return n;
        if (n.status === 'GANHO' || n.status === 'PERDIDO')
          return transicao('Negócio fechado não muda de etapa.');
        const destino = c.dados.funil.etapas.find((x) => x.id === e.data.etapa_id);
        if (!destino) return invalido('etapa_id', 'Etapa de outro funil.');
        if (destino.tipo !== 'ABERTA') return transicao('Use a ação própria para esta etapa.');
        const faltam = pendentes(c, n, destino);
        if (faltam.length)
          return problema('requisitos_pendentes', { extras: { requisitos: faltam } });
        qualificarSePassou(c, n, destino);
        const movido = gravar(c, n, {
          etapa_id: destino.id,
          status: 'ABERTO',
          nba_adiada_ate: null,
          entrou_etapa_em: agora(),
        });
        criarTarefasDaEtapa(c, movido, destino.id);
        return HttpResponse.json(
          detalhado(
            c,
            c.dados.negocios.find((x) => x.id === n.id)!,
          ),
        );
      }),
      http.post(`*${rota}/:id/perder`, async ({ request, params }) => {
        const c = exigir(request, 'negocio.update');
        if ('erro' in c) return c.erro;
        const e = EntradaPerderNegocio.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const n = exigirNegocio(c, params.id as string, 'negocio.update', e.data.versao_registro);
        if (n instanceof Response) return n;
        if (!c.dados.motivos.some((m) => m.id === e.data.motivo_perda_id && m.ativo))
          return invalido('motivo_perda_id', 'Motivo de perda inexistente ou inativo.');
        c.dados.tarefas = c.dados.tarefas.map((t) =>
          t.negocio_id === n.id && (t.status === 'PENDENTE' || t.status === 'EM_ANDAMENTO')
            ? { ...t, status: 'CANCELADA' }
            : t,
        );
        return HttpResponse.json(
          gravar(c, n, {
            status: 'PERDIDO',
            etapa_id: ETAPAS_SIMULADAS.perdido,
            motivo_perda_id: e.data.motivo_perda_id,
            fechado_em: agora(),
            entrou_etapa_em: agora(),
          }),
        );
      }),
      http.post(`*${rota}/:id/nutrir`, async ({ request, params }) => {
        const c = exigir(request, 'negocio.update');
        if ('erro' in c) return c.erro;
        const e = EntradaNutrirNegocio.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const n = exigirNegocio(c, params.id as string, 'negocio.update', e.data.versao_registro);
        if (n instanceof Response) return n;
        if (n.status !== 'ABERTO') return transicao('Só um negócio aberto vai para a nutrição.');
        if (new Date(e.data.nba_adiada_ate).getTime() <= Date.now())
          return invalido('nba_adiada_ate', 'A data de reativação precisa estar no futuro.');
        // Como a API: só as tarefas do funil abertas são canceladas; as manuais continuam.
        c.dados.tarefas = c.dados.tarefas.map((t) =>
          t.negocio_id === n.id &&
          t.origem === 'REQUISITO_ETAPA' &&
          (t.status === 'PENDENTE' || t.status === 'EM_ANDAMENTO')
            ? { ...t, status: 'CANCELADA' }
            : t,
        );
        return HttpResponse.json(
          gravar(c, n, {
            status: 'NUTRICAO',
            etapa_id: ETAPAS_SIMULADAS.nutricao,
            nba_adiada_ate: new Date(e.data.nba_adiada_ate).toISOString(),
            entrou_etapa_em: agora(),
          }),
        );
      }),
    ];
  }

  function criarHandlersTarefas() {
    const rota = ROTAS_TAREFAS.tarefas;
    const aberta = (t: Tarefa) => t.status === 'PENDENTE' || t.status === 'EM_ANDAMENTO';
    const doId = (c: Ctx, tid: string, chave: string) =>
      c.dados.tarefas.find((t) => t.id === tid && meu(c, chave, t.responsavel_id));
    const mudar = (c: Ctx, t: Tarefa, campos: Partial<Tarefa>) => {
      const nova = { ...t, ...campos, updated_at: agora() };
      c.dados.tarefas = c.dados.tarefas.map((x) => (x.id === t.id ? nova : x));
      return nova;
    };
    return [
      http.get(`*${rota}`, ({ request }) => {
        const c = exigir(request, 'tarefa.read');
        if ('erro' in c) return c.erro;
        const q = ConsultaTarefas.safeParse(consulta(request));
        if (!q.success) return problema('validacao', { campos: camposDoZod(q.error) });
        const todas = c.dados.tarefas
          .filter((t) => meu(c, 'tarefa.read', t.responsavel_id))
          .filter((t) => !q.data['filtro[status]'] || t.status === q.data['filtro[status]'])
          .filter(
            (t) => !q.data['filtro[negocio_id]'] || t.negocio_id === q.data['filtro[negocio_id]'],
          )
          .filter(
            (t) => !q.data['filtro[contato_id]'] || t.contato_id === q.data['filtro[contato_id]'],
          )
          .sort((a, b) => (a.vence_em ?? '9').localeCompare(b.vence_em ?? '9'));
        return pagina(todas, q.data);
      }),
      http.post(`*${rota}`, async ({ request }) => {
        const c = exigir(request, 'tarefa.create');
        if ('erro' in c) return c.erro;
        const e = EntradaTarefa.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const negocio = e.data.negocio_id ? negocioDe(c, e.data.negocio_id, 'negocio.read') : null;
        if (e.data.negocio_id && !negocio)
          return invalido('negocio_id', 'Negócio inexistente nesta empresa.');
        const contatoId = negocio?.contato_id ?? e.data.contato_id ?? null;
        if (contatoId && !contatoDe(c, contatoId))
          return invalido('contato_id', 'Contato inexistente nesta empresa.');
        const proprio = c.escopo('tarefa.create') === 'PROPRIO';
        const t: Tarefa = {
          id: novoId(),
          empresa_id: c.empresaId,
          contato_id: contatoId,
          negocio_id: negocio?.id ?? null,
          titulo: e.data.titulo,
          descricao: e.data.descricao ?? null,
          status: 'PENDENTE',
          prioridade: e.data.prioridade,
          origem: 'MANUAL',
          requisito_id: null,
          vence_em: e.data.vence_em ?? null,
          responsavel_id: proprio ? c.membroId : (e.data.responsavel_id ?? null),
          concluida_em: null,
          created_at: agora(),
          updated_at: agora(),
        };
        c.dados.tarefas.push(t);
        return HttpResponse.json(t, { status: 201 });
      }),
      http.patch(`*${rota}/:id`, async ({ request, params }) => {
        const c = exigir(request, 'tarefa.update');
        if ('erro' in c) return c.erro;
        const t = doId(c, params.id as string, 'tarefa.update');
        if (!t) return problema('nao_encontrado');
        const e = EdicaoTarefa.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        if (!aberta(t)) return transicao('Tarefa concluída ou cancelada não muda mais.');
        return HttpResponse.json(mudar(c, t, e.data as Partial<Tarefa>));
      }),
      http.post(`*${rota}/:id/concluir`, ({ request, params }) => {
        const c = exigir(request, 'tarefa.update');
        if ('erro' in c) return c.erro;
        const t = doId(c, params.id as string, 'tarefa.update');
        if (!t) return problema('nao_encontrado');
        if (!aberta(t)) return transicao('Tarefa concluída ou cancelada não muda mais.');
        return HttpResponse.json(mudar(c, t, { status: 'CONCLUIDA', concluida_em: agora() }));
      }),
      http.delete(`*${rota}/:id`, ({ request, params }) => {
        const c = exigir(request, 'tarefa.delete');
        if ('erro' in c) return c.erro;
        const t = doId(c, params.id as string, 'tarefa.delete');
        if (!t) return problema('nao_encontrado');
        if (!aberta(t)) return transicao('Tarefa concluída ou cancelada não muda mais.');
        mudar(c, t, { status: 'CANCELADA' });
        return sem();
      }),
    ];
  }

  function criarHandlersAtividades() {
    const rota = ROTAS_ATIVIDADES.atividades;
    const doId = (c: Ctx, aid: string, chave: string) =>
      c.dados.atividades.find((a) => a.id === aid && meu(c, chave, a.membro_id));
    /** Prazo de 24 horas do autor PROPRIO; SISTEMA e FORMULARIO nunca mudam. */
    function corrigivel(c: Ctx, aid: string, chave: string) {
      const a = doId(c, aid, chave);
      if (!a) return problema('nao_encontrado');
      if (a.tipo === 'SISTEMA' || a.tipo === 'FORMULARIO')
        return transicao('Atividade do sistema não muda.');
      const vencido = Date.now() - new Date(a.registrada_em).getTime() > DIA;
      if (c.escopo(chave) === 'PROPRIO' && vencido)
        return transicao('O prazo de 24 horas para corrigir a própria atividade terminou.');
      return a;
    }
    const ultimaInteracao = (c: Ctx, contatoId: string | null) => {
      if (!contatoId) return;
      const datas = c.dados.atividades
        .filter((a) => a.contato_id === contatoId && a.direcao !== 'INTERNA')
        .map((a) => a.ocorreu_em)
        .sort();
      contatos.atualizar(c.empresaId, contatoId, { ultima_interacao_em: datas.at(-1) ?? null });
    };
    return [
      http.get(`*${rota}`, ({ request }) => {
        const c = exigir(request, 'atividade.read');
        if ('erro' in c) return c.erro;
        const q = ConsultaAtividades.safeParse(consulta(request));
        if (!q.success) return problema('validacao', { campos: camposDoZod(q.error) });
        const todas = c.dados.atividades
          .filter((a) => meu(c, 'atividade.read', a.membro_id))
          .filter(
            (a) => !q.data['filtro[contato_id]'] || a.contato_id === q.data['filtro[contato_id]'],
          )
          .filter(
            (a) => !q.data['filtro[negocio_id]'] || a.negocio_id === q.data['filtro[negocio_id]'],
          )
          .filter((a) => !q.data['filtro[tipo]'] || a.tipo === q.data['filtro[tipo]'])
          .sort((a, b) => b.ocorreu_em.localeCompare(a.ocorreu_em));
        return pagina(todas, q.data);
      }),
      http.post(`*${rota}`, async ({ request }) => {
        const c = exigir(request, 'atividade.create');
        if ('erro' in c) return c.erro;
        const e = EntradaAtividade.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const negocio = e.data.negocio_id ? negocioDe(c, e.data.negocio_id, 'negocio.read') : null;
        if (e.data.negocio_id && !negocio)
          return invalido('negocio_id', 'Negócio inexistente nesta empresa.');
        const contatoId = negocio?.contato_id ?? e.data.contato_id ?? null;
        if (contatoId && !contatoDe(c, contatoId))
          return invalido('contato_id', 'Contato inexistente nesta empresa.');
        const quando = e.data.ocorreu_em ?? agora();
        if (new Date(quando).getTime() > Date.now() + 5 * 60 * 1000)
          return invalido('ocorreu_em', 'A atividade não pode estar no futuro.');
        const a: Atividade = {
          id: novoId(),
          empresa_id: c.empresaId,
          contato_id: contatoId,
          negocio_id: negocio?.id ?? null,
          tipo: e.data.tipo,
          direcao: e.data.tipo === 'NOTA' ? 'INTERNA' : e.data.direcao!,
          assunto: e.data.assunto ?? null,
          conteudo: e.data.conteudo ?? null,
          resultado: e.data.resultado ?? null,
          membro_id: c.membroId,
          ocorreu_em: new Date(quando).toISOString(),
          registrada_em: agora(),
        };
        c.dados.atividades.push(a);
        ultimaInteracao(c, contatoId);
        return HttpResponse.json(a, { status: 201 });
      }),
      http.patch(`*${rota}/:id`, async ({ request, params }) => {
        const c = exigir(request, 'atividade.update');
        if ('erro' in c) return c.erro;
        const a = corrigivel(c, params.id as string, 'atividade.update');
        if (a instanceof Response) return a;
        const e = EdicaoAtividade.safeParse(await corpo(request));
        if (!e.success) return problema('validacao', { campos: camposDoZod(e.error) });
        const nova = { ...a, ...e.data } as Atividade;
        c.dados.atividades = c.dados.atividades.map((x) => (x.id === a.id ? nova : x));
        ultimaInteracao(c, a.contato_id);
        return HttpResponse.json(nova);
      }),
      http.delete(`*${rota}/:id`, ({ request, params }) => {
        const c = exigir(request, 'atividade.delete');
        if ('erro' in c) return c.erro;
        const a = corrigivel(c, params.id as string, 'atividade.delete');
        if (a instanceof Response) return a;
        c.dados.atividades = c.dados.atividades.filter((x) => x.id !== a.id);
        ultimaInteracao(c, a.contato_id);
        return sem();
      }),
    ];
  }

  return {
    handlers: [...handlersNegocios, ...handlersTarefas, ...handlersAtividades],
    /** Testes: o estado da empresa na simulação. */
    dados: daEmpresa,
  };
}

/** Página por posição (cursor = índice), como as outras simulações. */
function pagina<T>(todos: T[], { cursor, limit }: { cursor?: string | undefined; limit: number }) {
  const inicio = cursor ? Number(cursor) : 0;
  const fim = inicio + limit;
  return HttpResponse.json({
    dados: todos.slice(inicio, fim),
    proximo_cursor: fim < todos.length ? String(fim) : null,
  });
}
