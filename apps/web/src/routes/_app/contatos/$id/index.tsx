import { type Contato, ROTAS_CONTATOS } from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAcesso } from '../../../../auth/acesso';
import { ErroDaApi } from '../../../../componentes/erro-da-api';
import { AvisoDeErro } from '../../../../configuracoes/aviso';
import { Confirmar } from '../../../../configuracoes/confirmacao';
import { Consentimentos } from '../../../../contatos/consentimentos';
import {
  CHAVE_CONTATOS,
  consultaContato,
  consultaOrigens,
  consultaResponsaveis,
} from '../../../../contatos/consultas';
import {
  CANAIS,
  CICLO_VIDA,
  formatarData,
  formatarDocumento,
  formatarTelefone,
  TIPO_PESSOA,
} from '../../../../contatos/formatacao';
import { CabecalhoContatos } from '../../../../contatos/pagina';
import { SecaoTarefas } from '../../../../crm/tarefas';
import { SecaoTimeline } from '../../../../crm/timeline';
import { NegociosDoContato } from '../../../../negocios/do-contato';

// Ficha do contato (plano docs/planos/f4-web-1-contatos.md, decisões 7 e 8). Score, temperatura e
// "o que falta" chegam com F11 e o PR 2 da F4; por ora, só o ciclo de vida.

export const Route = createFileRoute('/_app/contatos/$id/')({ component: FichaContato });

const VOLTAR = { link: { to: '/contatos' }, rotulo: 'Contatos' } as const;

function FichaContato() {
  const { id } = Route.useParams();
  const { cliente } = Route.useRouteContext();
  const contato = useQuery(consultaContato(cliente, id));

  if (contato.isPending) return <Carregando />;
  if (contato.isError)
    return (
      <>
        <CabecalhoContatos titulo="Contato" voltar={VOLTAR} />
        <ErroDaApi erro={contato.error} />
      </>
    );
  return <Ficha contato={contato.data} />;
}

function Ficha({ contato }: { contato: Contato }) {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pode } = useAcesso();
  const origens = useQuery(consultaOrigens(cliente));
  const responsaveis = useQuery(consultaResponsaveis(cliente));
  const excluir = useMutation({
    mutationFn: () =>
      cliente.delete(`${ROTAS_CONTATOS.contatos}/${contato.id}`, { resposta: null }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: consultaContato(cliente, contato.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: [...CHAVE_CONTATOS, 'lista'] });
      await navigate({ to: '/contatos' });
    },
  });
  const origem = origens.data?.dados.find((o) => o.id === contato.origem_id)?.nome;
  const responsavel = responsaveis.data?.dados.find((r) => r.id === contato.responsavel_id)?.nome;
  const endereco = contato.endereco ?? {};
  const linhaEndereco = [
    [endereco.logradouro, endereco.numero].filter(Boolean).join(', '),
    endereco.complemento,
    endereco.bairro,
    [endereco.cidade, endereco.uf].filter(Boolean).join(' / '),
    endereco.cep,
  ].filter(Boolean);

  return (
    <>
      <CabecalhoContatos
        titulo={contato.nome}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {TIPO_PESSOA[contato.tipo_pessoa]}
            <Badge variant="secondary">{CICLO_VIDA[contato.ciclo_vida]}</Badge>
          </span>
        }
        voltar={VOLTAR}
        acoes={
          <>
            {pode('contato.update') ? (
              <Button variant="outline" asChild>
                <Link to="/contatos/$id/editar" params={{ id: contato.id }}>
                  Editar
                </Link>
              </Button>
            ) : null}
            {pode('contato.delete') ? (
              <Confirmar
                gatilho={<Button variant="ghost">Excluir</Button>}
                titulo={`Excluir ${contato.nome}?`}
                descricao="O contato sai das listas e da busca. O histórico continua guardado."
                confirmar="Excluir"
                aoConfirmar={() => excluir.mutate()}
              />
            ) : null}
          </>
        }
      />
      <div className="mb-4">
        <AvisoDeErro erro={excluir.error} />
      </div>
      <div className="flex max-w-4xl flex-col gap-8">
        <section aria-labelledby="titulo-dados">
          <h2 id="titulo-dados" className="mb-3 text-lg font-semibold">
            Dados
          </h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item rotulo="E-mail">{contato.email ?? '—'}</Item>
            <Item rotulo="Telefone">{formatarTelefone(contato.telefone_e164)}</Item>
            <Item rotulo="WhatsApp">{formatarTelefone(contato.whatsapp_e164)}</Item>
            <Item rotulo="Canal preferido">
              {contato.canal_preferido ? CANAIS[contato.canal_preferido] : '—'}
            </Item>
            <Item rotulo={contato.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'}>
              {formatarDocumento(contato.documento)}
            </Item>
            <Item rotulo="Data de nascimento">{formatarData(contato.data_nascimento)}</Item>
            <Item rotulo="Origem">{origem ?? '—'}</Item>
            <Item rotulo="Responsável">
              {responsavel ?? (contato.responsavel_id ? 'Membro sem acesso' : '—')}
            </Item>
            <Item rotulo="Endereço">{linhaEndereco.length ? linhaEndereco.join(' · ') : '—'}</Item>
            <Item rotulo="Observações">
              <span className="whitespace-pre-line">{contato.observacoes ?? '—'}</span>
            </Item>
          </dl>
        </section>
        <Consentimentos contato={contato} />
        {pode('negocio.read') ? <NegociosDoContato contatoId={contato.id} /> : null}
        {pode('tarefa.read') ? <SecaoTarefas vinculo={{ contato_id: contato.id }} /> : null}
        {pode('atividade.read') ? <SecaoTimeline vinculo={{ contato_id: contato.id }} /> : null}
      </div>
    </>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
