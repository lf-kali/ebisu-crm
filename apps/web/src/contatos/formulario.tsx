import {
  CanalComunicacao,
  Contato,
  type Contato as TipoContato,
  Data,
  ROTAS_CONTATOS,
  TipoPessoa,
} from '@ebisu/contracts';
import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import { Button } from '@ebisu/ui/components/ui/button';
import { Label } from '@ebisu/ui/components/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ErroApi } from '../api/erro-api';
import { useAcesso } from '../auth/acesso';
import { AvisoDeErro } from '../configuracoes/aviso';
import { aplicarErrosDaApi, Campo } from '../formularios/campo';
import { Selecao } from '../formularios/selecao';
import {
  CHAVE_CONTATOS,
  consultaContato,
  consultaOrigens,
  consultaResponsaveis,
} from './consultas';
import { CANAIS, formatarTelefone, TIPO_PESSOA } from './formatacao';

// Formulário de contato, para criar e editar (plano docs/planos/f4-web-1-contatos.md, decisões 3
// a 5). Valida antes de enviar; campo vazio não vai no POST e vira null no PATCH (remove o valor).
// No PATCH só vão os campos que mudaram.

const rotaApp = getRouteApi('/_app');

const texto = (maximo: number) => z.string().trim().max(maximo);
const opcional = (valido: (v: string) => boolean, mensagem: string) => (schema: z.ZodString) =>
  schema.refine((v) => !v || valido(v), mensagem);
const telefone = opcional(
  (v) => v.replace(/\D/g, '').length >= 8,
  'Telefone incompleto.',
)(texto(30));

export const ValoresContato = z
  .object({
    tipo_pessoa: TipoPessoa,
    nome: z.string().trim().min(1, 'Informe o nome.').max(200),
    documento: texto(20),
    email: opcional((v) => z.email().safeParse(v).success, 'E-mail inválido.')(texto(254)),
    telefone,
    whatsapp: telefone,
    canal_preferido: z.union([z.literal(''), CanalComunicacao]),
    data_nascimento: opcional((v) => Data.safeParse(v).success, 'Data inválida.')(z.string()),
    endereco: z.object({
      cep: opcional((v) => /^\d{5}-?\d{3}$/.test(v), 'CEP inválido.')(texto(9)),
      logradouro: texto(200),
      numero: texto(20),
      complemento: texto(100),
      bairro: texto(100),
      cidade: texto(100),
      uf: opcional((v) => /^[A-Za-z]{2}$/.test(v), 'UF com 2 letras.')(texto(2)),
    }),
    origem_id: z.string(),
    responsavel_id: z.string(),
    observacoes: texto(5000),
  })
  .refine((v) => Boolean(v.email || v.telefone || v.whatsapp), {
    message: 'Informe e-mail, telefone ou WhatsApp.',
    path: ['email'],
  });
type Entrada = z.input<typeof ValoresContato>;
type Valores = z.output<typeof ValoresContato>;

const CAMPOS_ENDERECO = [
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
] as const;

/** Campos do formulário com erro vindo da API (422 por campo, 409 no meio repetido). */
const CAMPOS_DA_API = [
  'tipo_pessoa',
  'nome',
  'documento',
  'email',
  'telefone',
  'whatsapp',
  'canal_preferido',
  'data_nascimento',
  'origem_id',
  'responsavel_id',
  'observacoes',
  ...CAMPOS_ENDERECO.map((c) => `endereco.${c}` as const),
] as const;

const ROTULO_MEIO = { email: 'e-mail', telefone: 'telefone', whatsapp: 'WhatsApp' } as const;

/** Valores do formulário a partir do contato (ou vazios, para um novo). */
export function valoresDe(contato: TipoContato | null): Entrada {
  const telefoneNaTela = (e164: string | null | undefined) => (e164 ? formatarTelefone(e164) : '');
  const endereco = contato?.endereco ?? {};
  return {
    tipo_pessoa: contato?.tipo_pessoa ?? 'PF',
    nome: contato?.nome ?? '',
    documento: contato?.documento ?? '',
    email: contato?.email ?? '',
    telefone: telefoneNaTela(contato?.telefone_e164),
    whatsapp: telefoneNaTela(contato?.whatsapp_e164),
    canal_preferido: contato?.canal_preferido ?? '',
    data_nascimento: contato?.data_nascimento ?? '',
    endereco: Object.fromEntries(
      CAMPOS_ENDERECO.map((c) => [c, endereco[c] ?? '']),
    ) as Entrada['endereco'],
    origem_id: contato?.origem_id ?? '',
    responsavel_id: contato?.responsavel_id ?? '',
    observacoes: contato?.observacoes ?? '',
  };
}

/** Corpo com `null` no lugar de vazio; o endereço todo vazio também é `null`. */
export function paraCorpo(valores: Valores): Record<string, unknown> {
  const { endereco, ...resto } = valores;
  const preenchido = Object.fromEntries(
    Object.entries(endereco)
      .filter(([, v]) => v)
      .map(([c, v]) => [c, c === 'uf' ? v.toUpperCase() : v]),
  );
  return {
    ...Object.fromEntries(Object.entries(resto).map(([c, v]) => [c, v === '' ? null : v])),
    endereco: Object.keys(preenchido).length ? preenchido : null,
  };
}

/** POST: sem os vazios. PATCH: só o que mudou em relação ao contato (null remove). */
export function corpoDoEnvio(
  valores: Valores,
  contato: TipoContato | null,
  semResponsavel: boolean,
): Record<string, unknown> {
  const corpo = paraCorpo(valores);
  if (semResponsavel) delete corpo.responsavel_id;
  if (!contato) return Object.fromEntries(Object.entries(corpo).filter(([, v]) => v !== null));
  const antes = paraCorpo(ValoresContato.parse(valoresDe(contato)));
  return Object.fromEntries(
    Object.entries(corpo).filter(([c, v]) => JSON.stringify(v) !== JSON.stringify(antes[c])),
  );
}

export function FormularioContato({ contato }: { contato: TipoContato | null }) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { escopo } = useAcesso();
  const origens = useQuery(consultaOrigens(cliente));
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const [erro, setErro] = useState<unknown>(null);
  const [duplicado, setDuplicado] = useState<{ meio: string; id?: string } | null>(null);
  const form = useForm<Entrada, unknown, Valores>({
    resolver: zodResolver(ValoresContato),
    defaultValues: valoresDe(contato),
  });
  const { errors, isSubmitting } = form.formState;
  // Quem só tem o próprio escopo não escolhe: a API grava a própria pessoa (decisão 5).
  const semResponsavel = escopo(contato ? 'contato.update' : 'contato.create') === 'PROPRIO';
  const tipo = useWatch({ control: form.control, name: 'tipo_pessoa' });
  const abrirFicha = (id: string) => navigate({ to: '/contatos/$id', params: { id } });

  async function salvar(valores: Valores) {
    setErro(null);
    setDuplicado(null);
    const corpo = corpoDoEnvio(valores, contato, semResponsavel);
    try {
      if (contato && Object.keys(corpo).length === 0) return await abrirFicha(contato.id);
      const salvo = contato
        ? await cliente.patch(`${ROTAS_CONTATOS.contatos}/${contato.id}`, {
            resposta: Contato,
            corpo,
          })
        : await cliente.post(ROTAS_CONTATOS.contatos, { resposta: Contato, corpo });
      queryClient.setQueryData(consultaContato(cliente, salvo.id).queryKey, salvo);
      await queryClient.invalidateQueries({ queryKey: [...CHAVE_CONTATOS, 'lista'] });
      await abrirFicha(salvo.id);
    } catch (e) {
      if (!tratarDuplicado(e) && !aplicarErrosDaApi(e, form.setError, CAMPOS_DA_API)) setErro(e);
    }
  }

  /** 409: a mensagem vai no campo que repetiu, com o link quando a API dá o id (decisão 4). */
  function tratarDuplicado(e: unknown) {
    if (!(e instanceof ErroApi) || e.codigo !== 'duplicado') return false;
    const { campo, id_existente: id } = e.problema as { campo?: unknown; id_existente?: unknown };
    if (campo !== 'email' && campo !== 'telefone' && campo !== 'whatsapp') return false;
    const meio = ROTULO_MEIO[campo];
    form.setError(campo, { type: 'server', message: `Já existe um contato com este ${meio}.` });
    setDuplicado({ meio, ...(typeof id === 'string' ? { id } : {}) });
    return true;
  }

  const ativas = origens.data?.dados.filter((o) => o.ativo || o.id === contato?.origem_id) ?? [];
  const opcoesResponsavel = responsaveis.data?.dados ?? [];
  const responsavelForaDaLista =
    contato?.responsavel_id && !opcoesResponsavel.some((r) => r.id === contato.responsavel_id);

  return (
    <form noValidate onSubmit={form.handleSubmit(salvar)} className="flex max-w-3xl flex-col gap-6">
      <AvisoDeErro erro={erro} />
      {duplicado ? (
        <Alert variant="destructive">
          <AlertDescription>
            Já existe um contato com este {duplicado.meio} na empresa.{' '}
            {duplicado.id ? (
              <Link
                to="/contatos/$id"
                params={{ id: duplicado.id }}
                className="font-medium underline underline-offset-4"
              >
                Abrir contato existente
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Grupo titulo="Identificação">
        <Selecao
          rotulo="Tipo de pessoa"
          erro={errors.tipo_pessoa?.message}
          {...form.register('tipo_pessoa')}
        >
          {TipoPessoa.options.map((t) => (
            <option key={t} value={t}>
              {TIPO_PESSOA[t]}
            </option>
          ))}
        </Selecao>
        <Campo
          rotulo="Nome"
          autoComplete="off"
          erro={errors.nome?.message}
          {...form.register('nome')}
        />
        <Campo
          rotulo={tipo === 'PJ' ? 'CNPJ (opcional)' : 'CPF (opcional)'}
          inputMode={tipo === 'PJ' ? 'text' : 'numeric'}
          erro={errors.documento?.message}
          {...form.register('documento')}
        />
        <Campo
          rotulo="Data de nascimento (opcional)"
          type="date"
          erro={errors.data_nascimento?.message}
          {...form.register('data_nascimento')}
        />
      </Grupo>

      <Grupo
        titulo="Meios de contato"
        descricao="Informe ao menos um: e-mail, telefone ou WhatsApp."
      >
        <Campo
          rotulo="E-mail"
          type="email"
          erro={errors.email?.message}
          {...form.register('email')}
        />
        <Campo
          rotulo="Telefone"
          type="tel"
          dica="Com DDD; de outro país, com +DDI."
          erro={errors.telefone?.message}
          {...form.register('telefone')}
        />
        <Campo
          rotulo="WhatsApp"
          type="tel"
          erro={errors.whatsapp?.message}
          {...form.register('whatsapp')}
        />
        <Selecao
          rotulo="Canal preferido"
          erro={errors.canal_preferido?.message}
          {...form.register('canal_preferido')}
        >
          <option value="">Sem preferência</option>
          {CanalComunicacao.options.map((c) => (
            <option key={c} value={c}>
              {CANAIS[c]}
            </option>
          ))}
        </Selecao>
      </Grupo>

      <Grupo titulo="Endereço (opcional)">
        <Campo
          rotulo="CEP"
          inputMode="numeric"
          erro={errors.endereco?.cep?.message}
          {...form.register('endereco.cep')}
        />
        <Campo
          rotulo="Logradouro"
          erro={errors.endereco?.logradouro?.message}
          {...form.register('endereco.logradouro')}
        />
        <Campo
          rotulo="Número"
          erro={errors.endereco?.numero?.message}
          {...form.register('endereco.numero')}
        />
        <Campo
          rotulo="Complemento"
          erro={errors.endereco?.complemento?.message}
          {...form.register('endereco.complemento')}
        />
        <Campo
          rotulo="Bairro"
          erro={errors.endereco?.bairro?.message}
          {...form.register('endereco.bairro')}
        />
        <Campo
          rotulo="Cidade"
          erro={errors.endereco?.cidade?.message}
          {...form.register('endereco.cidade')}
        />
        <Campo
          rotulo="UF"
          maxLength={2}
          erro={errors.endereco?.uf?.message}
          {...form.register('endereco.uf')}
        />
      </Grupo>

      <Grupo titulo="Atendimento">
        <Selecao rotulo="Origem" erro={errors.origem_id?.message} {...form.register('origem_id')}>
          <option value="">Sem origem</option>
          {ativas.map((o) => (
            <option key={o.id} value={o.id}>
              {o.ativo ? o.nome : `${o.nome} (inativa)`}
            </option>
          ))}
        </Selecao>
        {semResponsavel ? null : (
          <Selecao
            rotulo="Responsável"
            erro={errors.responsavel_id?.message}
            {...form.register('responsavel_id')}
          >
            <option value="">Sem responsável</option>
            {opcoesResponsavel.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
            {responsavelForaDaLista ? (
              <option value={contato.responsavel_id!}>Membro sem acesso à empresa</option>
            ) : null}
          </Selecao>
        )}
        <AreaDeTexto
          rotulo="Observações (opcional)"
          erro={errors.observacoes?.message}
          {...form.register('observacoes')}
        />
      </Grupo>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando…' : contato ? 'Salvar' : 'Criar contato'}
        </Button>
        <Button variant="outline" asChild>
          {contato ? (
            <Link to="/contatos/$id" params={{ id: contato.id }}>
              Cancelar
            </Link>
          ) : (
            <Link to="/contatos">Cancelar</Link>
          )}
        </Button>
      </div>
    </form>
  );
}

function Grupo({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-base font-semibold">{titulo}</legend>
      {descricao ? <p className="-mt-2 text-sm text-muted-foreground">{descricao}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function AreaDeTexto({
  rotulo,
  erro,
  ...props
}: { rotulo: string; erro?: string } & React.ComponentProps<'textarea'>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <textarea
        id={id}
        rows={4}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
        {...props}
      />
      {erro ? (
        <p id={`${id}-erro`} className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
