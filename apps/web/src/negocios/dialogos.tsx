import {
  Data,
  InteresseNegocio,
  ListaContatos,
  type NegocioDetalhado,
  NegocioDetalhado as SchemaNegocio,
  ROTAS_CONTATOS,
  ROTAS_NEGOCIOS,
  TipoDispositivo,
  Urgencia,
} from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Button } from '@ebisu/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ebisu/ui/components/ui/dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ehConflitoDeVersao } from '../api/erro-api';
import { useAcesso } from '../auth/acesso';
import { consultaResponsaveis } from '../contatos/consultas';
import { AreaDeTexto } from '../contatos/formulario';
import { aplicarErrosDaApi, Campo } from '../formularios/campo';
import { Selecao } from '../formularios/selecao';
import { atualizarCrm, consultaMotivos } from './consultas';
import { ErroAoMover } from './mover';
import { INTERESSE, paraLocal, TIPO_DISPOSITIVO, URGENCIA } from './formatacao';

// Diálogos de negócio (plano docs/planos/f4-web-2-negocios.md, decisões 4 e 5): novo, editar,
// perder e nutrir. Quem decide de fato é a API: aqui só se mostram os erros dela no lugar certo.

const rotaApp = getRouteApi('/_app');

function Janela({
  titulo,
  descricao,
  aoFechar,
  children,
}: {
  titulo: string;
  descricao: string;
  aoFechar: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Rodape({
  enviando,
  acao,
  aoFechar,
}: {
  enviando: boolean;
  acao: string;
  aoFechar: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={aoFechar}>
        Cancelar
      </Button>
      <Button type="submit" disabled={enviando}>
        {enviando ? 'Salvando…' : acao}
      </Button>
    </DialogFooter>
  );
}

const Valores = z.object({
  titulo: z.string().trim().min(1, 'Informe o título.').max(200),
  interesse: InteresseNegocio,
  tipo_dispositivo: z.union([z.literal(''), TipoDispositivo]),
  descricao_problema: z.string().trim().max(5000),
  urgencia: z.union([z.literal(''), Urgencia]),
  valor_estimado: z
    .string()
    .trim()
    .refine((v) => !v || /^\d{1,12}([.,]\d{1,2})?$/.test(v), 'Valor em reais, ex.: 450,00'),
  previsao_fechamento: z.string().refine((v) => !v || Data.safeParse(v).success, 'Data inválida.'),
  responsavel_id: z.string(),
});
type Valores = z.infer<typeof Valores>;

/** "450,5" → "450.50" (o formato do contrato). */
const dinheiro = (v: string) => Number(v.replace(',', '.')).toFixed(2);

function corpoDoNegocio(v: Valores, semResponsavel: boolean) {
  const nulo = (x: string) => (x === '' ? null : x);
  return {
    titulo: v.titulo,
    interesse: v.interesse,
    tipo_dispositivo: nulo(v.tipo_dispositivo),
    descricao_problema: nulo(v.descricao_problema),
    urgencia: nulo(v.urgencia),
    valor_estimado: v.valor_estimado ? dinheiro(v.valor_estimado) : null,
    previsao_fechamento: nulo(v.previsao_fechamento),
    ...(semResponsavel ? {} : { responsavel_id: nulo(v.responsavel_id) }),
  };
}

const valoresDe = (n: NegocioDetalhado | null): Valores => ({
  titulo: n?.titulo ?? '',
  interesse: n?.interesse ?? 'REPARO',
  tipo_dispositivo: n?.tipo_dispositivo ?? '',
  descricao_problema: n?.descricao_problema ?? '',
  urgencia: n?.urgencia ?? '',
  valor_estimado: n?.valor_estimado?.replace('.', ',') ?? '',
  previsao_fechamento: n?.previsao_fechamento ?? '',
  responsavel_id: n?.responsavel_id ?? '',
});

/** Novo negócio (com o contato dado ou pela busca) ou edição do existente. */
export function DialogoNegocio({
  negocio = null,
  contatoId,
  aoFechar,
}: {
  negocio?: NegocioDetalhado | null;
  contatoId?: string;
  aoFechar: () => void;
}) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { escopo } = useAcesso();
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const [contato, setContato] = useState(contatoId ?? '');
  const [erro, setErro] = useState<unknown>(null);
  const form = useForm<Valores>({
    resolver: zodResolver(Valores),
    defaultValues: valoresDe(negocio),
  });
  const { errors, isSubmitting } = form.formState;
  const semResponsavel = escopo(negocio ? 'negocio.update' : 'negocio.create') === 'PROPRIO';

  async function salvar(v: Valores) {
    setErro(null);
    if (!negocio && !contato) return setErro(new Error('Escolha o contato do negócio.'));
    const corpo = corpoDoNegocio(v, semResponsavel);
    try {
      const salvo = negocio
        ? await cliente.patch(`${ROTAS_NEGOCIOS.negocios}/${negocio.id}`, {
            resposta: SchemaNegocio,
            corpo: { ...corpo, versao_registro: negocio.versao_registro },
          })
        : await cliente.post(ROTAS_NEGOCIOS.negocios, {
            resposta: SchemaNegocio,
            corpo: Object.fromEntries(
              Object.entries({ ...corpo, contato_id: contato }).filter(([, x]) => x !== null),
            ),
          });
      await atualizarCrm(queryClient);
      aoFechar();
      if (!negocio) await navigate({ to: '/negocios/$id', params: { id: salvo.id } });
    } catch (e) {
      if (ehConflitoDeVersao(e)) await atualizarCrm(queryClient);
      if (!aplicarErrosDaApi(e, form.setError, Object.keys(v) as (keyof Valores)[])) setErro(e);
    }
  }

  return (
    <Janela
      titulo={negocio ? `Editar ${negocio.titulo}` : 'Novo negócio'}
      descricao={
        negocio
          ? 'Etapa e status mudam pelas ações da ficha.'
          : 'O negócio começa na primeira etapa do funil.'
      }
      aoFechar={aoFechar}
    >
      {/* O select de responsável só monta com as opções: o React Hook Form lê o valor do DOM ao
          salvar, e um select sem a opção do responsável atual mandaria null (apagaria). */}
      {!semResponsavel && !responsaveis.data ? (
        responsaveis.isError ? (
          <ErroOuMensagem erro={responsaveis.error} />
        ) : (
          <Carregando />
        )
      ) : (
        <form noValidate onSubmit={form.handleSubmit(salvar)} className="flex flex-col gap-4">
          <ErroOuMensagem erro={erro} />
          {!negocio && !contatoId ? (
            <BuscaContato escolhido={contato} aoEscolher={setContato} />
          ) : null}
          <Campo rotulo="Título" erro={errors.titulo?.message} {...form.register('titulo')} />
          <Selecao rotulo="Interesse" {...form.register('interesse')}>
            {InteresseNegocio.options.map((i) => (
              <option key={i} value={i}>
                {INTERESSE[i]}
              </option>
            ))}
          </Selecao>
          <Selecao rotulo="Tipo de dispositivo" {...form.register('tipo_dispositivo')}>
            <option value="">Não informado</option>
            {TipoDispositivo.options.map((t) => (
              <option key={t} value={t}>
                {TIPO_DISPOSITIVO[t]}
              </option>
            ))}
          </Selecao>
          <AreaDeTexto
            rotulo="Problema ou interesse"
            erro={errors.descricao_problema?.message}
            {...form.register('descricao_problema')}
          />
          <Selecao rotulo="Urgência" {...form.register('urgencia')}>
            <option value="">Não informada</option>
            {Urgencia.options.map((u) => (
              <option key={u} value={u}>
                {URGENCIA[u]}
              </option>
            ))}
          </Selecao>
          <Campo
            rotulo="Valor estimado (R$)"
            inputMode="decimal"
            erro={errors.valor_estimado?.message}
            {...form.register('valor_estimado')}
          />
          <Campo
            rotulo="Previsão de fechamento"
            type="date"
            erro={errors.previsao_fechamento?.message}
            {...form.register('previsao_fechamento')}
          />
          {semResponsavel ? null : (
            <Selecao rotulo="Responsável" {...form.register('responsavel_id')}>
              <option value="">Sem responsável</option>
              {responsaveis.data?.dados.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
              {negocio?.responsavel_id &&
              !responsaveis.data?.dados.some((r) => r.id === negocio.responsavel_id) ? (
                <option value={negocio.responsavel_id}>Membro sem acesso à empresa</option>
              ) : null}
            </Selecao>
          )}
          <Rodape
            enviando={isSubmitting}
            acao={negocio ? 'Salvar' : 'Criar negócio'}
            aoFechar={aoFechar}
          />
        </form>
      )}
    </Janela>
  );
}

/** Busca de contato para o novo negócio do quadro: 2 caracteres ou mais, até 10 resultados. */
function BuscaContato({
  escolhido,
  aoEscolher,
}: {
  escolhido: string;
  aoEscolher: (id: string) => void;
}) {
  const { cliente } = rotaApp.useRouteContext();
  const grupo = useId();
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const espera = setTimeout(() => setQ(texto.trim()), 300);
    return () => clearTimeout(espera);
  }, [texto]);
  const resultados = useQuery({
    queryKey: ['contatos', 'busca-negocio', q],
    queryFn: ({ signal }) =>
      cliente.get(ROTAS_CONTATOS.contatos, {
        resposta: ListaContatos,
        query: { q, limit: 10 },
        sinal: signal,
      }),
    enabled: q.length >= 2,
  });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Contato</legend>
      <Campo
        rotulo="Buscar contato"
        type="search"
        dica="Nome, e-mail ou telefone, com 2 caracteres ou mais."
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {q.length >= 2 && resultados.data?.dados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p>
      ) : null}
      <div className="flex flex-col gap-1">
        {resultados.data?.dados.map((k) => (
          <label key={k.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={grupo}
              value={k.id}
              checked={escolhido === k.id}
              onChange={() => aoEscolher(k.id)}
              className="accent-primary"
            />
            {k.nome}
            <span className="text-muted-foreground">{k.email ?? ''}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Perder: o motivo é obrigatório e precisa estar ativo (CRM-4). */
export function DialogoPerder({
  negocio,
  aoFechar,
}: {
  negocio: NegocioDetalhado;
  aoFechar: () => void;
}) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const motivos = useQuery(consultaMotivos(cliente));
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  async function perder(evento: React.FormEvent) {
    evento.preventDefault();
    if (!motivo) return setErro(new Error('Escolha o motivo da perda.'));
    setEnviando(true);
    setErro(null);
    try {
      await cliente.post(`${ROTAS_NEGOCIOS.negocios}/${negocio.id}/perder`, {
        resposta: SchemaNegocio,
        corpo: { motivo_perda_id: motivo, versao_registro: negocio.versao_registro },
      });
      await atualizarCrm(queryClient);
      aoFechar();
    } catch (e) {
      if (ehConflitoDeVersao(e)) await atualizarCrm(queryClient);
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Janela
      titulo={`Perder ${negocio.titulo}`}
      descricao="O negócio sai do quadro e as tarefas abertas dele são canceladas."
      aoFechar={aoFechar}
    >
      <form noValidate onSubmit={perder} className="flex flex-col gap-4">
        <ErroOuMensagem erro={erro} />
        <Selecao
          rotulo="Motivo da perda"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        >
          <option value="">Escolha…</option>
          {motivos.data?.dados
            .filter((m) => m.ativo)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
        </Selecao>
        <Rodape enviando={enviando} acao="Perder negócio" aoFechar={aoFechar} />
      </form>
    </Janela>
  );
}

/** Nutrir até a data de reativação, que precisa estar no futuro. */
export function DialogoNutrir({
  negocio,
  aoFechar,
}: {
  negocio: NegocioDetalhado;
  aoFechar: () => void;
}) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  // Amanhã por padrão (calculado uma vez, na montagem).
  const [data, setData] = useState(() =>
    paraLocal(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()).slice(0, 10),
  );
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  async function nutrir(evento: React.FormEvent) {
    evento.preventDefault();
    const quando = new Date(`${data}T09:00:00`);
    if (!data || Number.isNaN(quando.getTime()) || quando.getTime() <= Date.now())
      return setErro(new Error('A data de reativação precisa estar no futuro.'));
    setEnviando(true);
    setErro(null);
    try {
      await cliente.post(`${ROTAS_NEGOCIOS.negocios}/${negocio.id}/nutrir`, {
        resposta: SchemaNegocio,
        corpo: { nba_adiada_ate: quando.toISOString(), versao_registro: negocio.versao_registro },
      });
      await atualizarCrm(queryClient);
      aoFechar();
    } catch (e) {
      if (ehConflitoDeVersao(e)) await atualizarCrm(queryClient);
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Janela
      titulo={`Nutrir ${negocio.titulo}`}
      descricao="O negócio sai do quadro até a data de reativação. Para voltar, mova-o para uma etapa aberta."
      aoFechar={aoFechar}
    >
      <form noValidate onSubmit={nutrir} className="flex flex-col gap-4">
        <ErroOuMensagem erro={erro} />
        <Campo
          rotulo="Reativar em"
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
        <Rodape enviando={enviando} acao="Nutrir" aoFechar={aoFechar} />
      </form>
    </Janela>
  );
}

/** Erro de validação local (Error) como texto; o da API, com versão e requisitos tratados. */
function ErroOuMensagem({ erro }: { erro: unknown }) {
  if (erro instanceof Error && !('problema' in erro))
    return (
      <p role="alert" className="text-sm text-destructive">
        {erro.message}
      </p>
    );
  return <ErroAoMover erro={erro} />;
}
