import { Membro, type Membro as TipoMembro, ROTAS_MEMBROS } from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useAcesso } from '../../../../auth/acesso';
import { ErroDaApi } from '../../../../componentes/erro-da-api';
import { AvisoDeErro } from '../../../../configuracoes/aviso';
import { Confirmar } from '../../../../configuracoes/confirmacao';
import { CHAVE_MEMBROS, consultaMembro, consultaPapeis } from '../../../../configuracoes/consultas';
import {
  EditorPapeis,
  type LinhaPapel,
  resumoPapeis,
} from '../../../../configuracoes/editor-papeis';
import { CabecalhoConfiguracao, SePodeVer } from '../../../../configuracoes/pagina';
import { Campo } from '../../../../formularios/campo';

// Um membro: cargo, situação e papéis (plano docs/planos/f3-web-2-configuracoes.md, decisão 4).
// As regras do dono (só um dono mexe no dono; a conta nunca fica sem dono ativo) vêm da API.

export const Route = createFileRoute('/_app/configuracoes/membros/$id')({
  component: PaginaMembro,
});

const SECAO = { permissao: 'config.membros', daConta: true } as const;

function PaginaMembro() {
  return (
    <SePodeVer secao={SECAO}>
      <ConteudoMembro />
    </SePodeVer>
  );
}

function ConteudoMembro() {
  const { id } = Route.useParams();
  const { cliente } = Route.useRouteContext();
  const membro = useQuery(consultaMembro(cliente, id));
  const voltar = { para: '/configuracoes/membros', rotulo: 'Membros e convites' } as const;

  if (membro.isPending) return <Carregando />;
  if (membro.isError)
    return (
      <>
        <CabecalhoConfiguracao titulo="Membro" voltar={voltar} />
        <ErroDaApi erro={membro.error} />
      </>
    );
  const { usuario, status } = membro.data;
  return (
    <>
      <CabecalhoConfiguracao
        titulo={usuario.nome}
        descricao={usuario.email}
        voltar={voltar}
        acoes={
          <Badge variant={status === 'ATIVO' ? 'secondary' : 'outline'}>
            {status === 'ATIVO' ? 'Ativo' : 'Suspenso'}
          </Badge>
        }
      />
      <div className="flex max-w-2xl flex-col gap-8">
        <Cargo membro={membro.data} />
        <Situacao membro={membro.data} />
        <Papeis membro={membro.data} />
      </div>
    </>
  );
}

function Cargo({ membro }: { membro: TipoMembro }) {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [cargo, setCargo] = useState(membro.cargo ?? '');
  const salvar = useMutation({
    mutationFn: () =>
      cliente.patch(`${ROTAS_MEMBROS.membros}/${membro.id}`, {
        resposta: Membro,
        corpo: { cargo: cargo.trim() || null },
      }),
    onSuccess: (atualizado) => queryClient.setQueryData([...CHAVE_MEMBROS, membro.id], atualizado),
  });
  return (
    <section aria-labelledby="titulo-cargo" className="flex flex-col gap-3">
      <h2 id="titulo-cargo" className="text-lg font-semibold">
        Cargo
      </h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="min-w-56 flex-1">
          <Campo
            rotulo="Cargo (opcional)"
            value={cargo}
            maxLength={120}
            onChange={(evento) => setCargo(evento.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={salvar.isPending}>
          Salvar cargo
        </Button>
      </form>
      <AvisoDeErro erro={salvar.error} />
      {salvar.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargo salvo.
        </p>
      ) : null}
    </section>
  );
}

function Situacao({ membro }: { membro: TipoMembro }) {
  const { cliente } = Route.useRouteContext();
  const { eu } = useAcesso();
  const queryClient = useQueryClient();
  const alternar = useMutation({
    mutationFn: (status: 'ATIVO' | 'SUSPENSO') =>
      cliente.patch(`${ROTAS_MEMBROS.membros}/${membro.id}`, {
        resposta: Membro,
        corpo: { status },
      }),
    onSuccess: (atualizado) => {
      queryClient.setQueryData([...CHAVE_MEMBROS, membro.id], atualizado);
      void queryClient.invalidateQueries({ queryKey: CHAVE_MEMBROS, exact: true });
    },
  });
  // Ninguém muda a própria situação (a API recusa; a tela nem oferece).
  if (eu?.membro.id === membro.id) return null;
  const suspenso = membro.status === 'SUSPENSO';
  return (
    <section aria-labelledby="titulo-situacao" className="flex flex-col gap-3">
      <h2 id="titulo-situacao" className="text-lg font-semibold">
        Acesso
      </h2>
      <p className="text-sm text-muted-foreground">
        {suspenso
          ? 'Membro suspenso: não entra na conta até ser reativado.'
          : 'Suspender tira o acesso na hora, em todas as empresas; os registros dele continuam.'}
      </p>
      {suspenso ? (
        <Button className="w-fit" variant="outline" onClick={() => alternar.mutate('ATIVO')}>
          Reativar
        </Button>
      ) : (
        <Confirmar
          gatilho={
            <Button className="w-fit" variant="destructive">
              Suspender
            </Button>
          }
          titulo={`Suspender ${membro.usuario.nome}?`}
          descricao="A pessoa perde o acesso na próxima ação, em todas as empresas da conta."
          confirmar="Suspender"
          aoConfirmar={() => alternar.mutate('SUSPENSO')}
        />
      )}
      <AvisoDeErro erro={alternar.error} />
    </section>
  );
}

function Papeis({ membro }: { membro: TipoMembro }) {
  const { cliente } = Route.useRouteContext();
  const { empresas, escopo } = useAcesso();
  const queryClient = useQueryClient();
  const podeEditar = escopo('config.rbac') === 'TENANT';
  const papeis = useQuery({ ...consultaPapeis(cliente), enabled: podeEditar });
  const [linhas, setLinhas] = useState<LinhaPapel[]>(() =>
    membro.atribuicoes.map((a) => ({ papel_id: a.papel.id, empresa_id: a.empresa_id })),
  );
  const salvar = useMutation({
    mutationFn: () =>
      cliente.put(`${ROTAS_MEMBROS.membros}/${membro.id}/atribuicoes`, {
        resposta: Membro,
        corpo: { atribuicoes: linhas },
      }),
    onSuccess: (atualizado) => {
      queryClient.setQueryData([...CHAVE_MEMBROS, membro.id], atualizado);
      void queryClient.invalidateQueries({ queryKey: CHAVE_MEMBROS, exact: true });
    },
  });

  return (
    <section aria-labelledby="titulo-papeis" className="flex flex-col gap-3">
      <h2 id="titulo-papeis" className="text-lg font-semibold">
        Papéis
      </h2>
      {!podeEditar ? (
        <p className="text-sm">{resumoPapeis(membro.atribuicoes, empresas)}</p>
      ) : papeis.data ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            salvar.mutate();
          }}
        >
          <EditorPapeis
            papeis={papeis.data.dados}
            empresas={empresas}
            valor={linhas}
            aoMudar={setLinhas}
          />
          <AvisoDeErro erro={salvar.error} />
          {salvar.isSuccess ? (
            <p role="status" className="text-sm text-muted-foreground">
              Papéis salvos. Valem a partir da próxima ação da pessoa.
            </p>
          ) : null}
          <Button type="submit" className="w-fit" disabled={salvar.isPending}>
            Salvar papéis
          </Button>
        </form>
      ) : papeis.isError ? (
        <ErroDaApi erro={papeis.error} />
      ) : (
        <Carregando />
      )}
    </section>
  );
}
