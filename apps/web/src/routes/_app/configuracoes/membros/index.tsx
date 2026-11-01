import {
  Convite,
  type Convite as TipoConvite,
  EntradaConvite,
  ListaConvites,
  ListaMembros,
  type Membro,
  type Papel,
  ROTAS_CONVITES,
  ROTAS_MEMBROS,
} from '@ebisu/contracts';
import { Badge } from '@ebisu/ui/components/ui/badge';
import { Button } from '@ebisu/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ebisu/ui/components/ui/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAcesso } from '../../../../auth/acesso';
import {
  type Coluna,
  TabelaCursor,
  usePaginacaoCursor,
} from '../../../../componentes/tabela-cursor';
import { AvisoDeErro, dataCurta } from '../../../../configuracoes/aviso';
import { Confirmar } from '../../../../configuracoes/confirmacao';
import { CHAVE_CONVITES, CHAVE_MEMBROS, consultaPapeis } from '../../../../configuracoes/consultas';
import {
  EditorPapeis,
  type LinhaPapel,
  PAPEL_DONO,
  resumoPapeis,
} from '../../../../configuracoes/editor-papeis';
import { CabecalhoConfiguracao, SePodeVer } from '../../../../configuracoes/pagina';
import { Campo } from '../../../../formularios/campo';

// Membros e convites (plano docs/planos/f3-web-2-configuracoes.md, decisões 4 e 5).

export const Route = createFileRoute('/_app/configuracoes/membros/')({ component: Membros });

const SECAO = { permissao: 'config.membros', daConta: true } as const;

const SITUACAO: Record<Membro['status'], string> = {
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  CONVIDADO: 'Convidado',
};
const ENVIO: Record<NonNullable<TipoConvite['envio']>, string> = {
  PENDENTE: 'Na fila',
  ENVIANDO: 'Enviando',
  ENVIADO: 'Enviado',
  FALHOU: 'Falhou',
  CANCELADO: 'Cancelado',
};

function Membros() {
  return (
    <SePodeVer secao={SECAO}>
      <ConteudoMembros />
    </SePodeVer>
  );
}

function ConteudoMembros() {
  const { cliente } = Route.useRouteContext();
  const { empresas, escopo } = useAcesso();
  const [convidando, setConvidando] = useState(false);
  // Convidar é dar papéis: a API pede também config.rbac.
  const podeConvidar = escopo('config.rbac') === 'TENANT';
  const membros = usePaginacaoCursor({
    chave: CHAVE_MEMBROS,
    filtros: {},
    buscar: ({ cursor, limit, signal }) =>
      cliente.get(ROTAS_MEMBROS.membros, {
        resposta: ListaMembros,
        query: { cursor, limit },
        sinal: signal,
      }),
  });

  const colunas: Coluna<Membro>[] = [
    {
      id: 'nome',
      cabecalho: 'Nome',
      celula: (m) => (
        <Link
          to="/configuracoes/membros/$id"
          params={{ id: m.id }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {m.usuario.nome}
        </Link>
      ),
    },
    { id: 'email', cabecalho: 'E-mail', celula: (m) => m.usuario.email },
    { id: 'cargo', cabecalho: 'Cargo', celula: (m) => m.cargo ?? '—' },
    { id: 'papeis', cabecalho: 'Papéis', celula: (m) => resumoPapeis(m.atribuicoes, empresas) },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      celula: (m) => (
        <Badge variant={m.status === 'ATIVO' ? 'secondary' : 'outline'}>{SITUACAO[m.status]}</Badge>
      ),
    },
  ];

  return (
    <>
      <CabecalhoConfiguracao
        titulo="Membros e convites"
        descricao="Quem acessa a conta e com quais papéis."
        acoes={podeConvidar ? <Button onClick={() => setConvidando(true)}>Convidar</Button> : null}
      />
      <TabelaCursor
        paginacao={membros}
        colunas={colunas}
        rotulo="Membros da conta"
        chaveLinha={(m) => m.id}
        vazio={{ titulo: 'Nenhum membro' }}
      />
      <h2 className="mt-8 mb-3 text-lg font-semibold">Convites pendentes</h2>
      <Convites />
      {convidando ? <DialogoConvite aoFechar={() => setConvidando(false)} /> : null}
    </>
  );
}

function Convites() {
  const { cliente } = Route.useRouteContext();
  const { empresas } = useAcesso();
  const queryClient = useQueryClient();
  const convites = usePaginacaoCursor({
    chave: CHAVE_CONVITES,
    filtros: {},
    buscar: ({ cursor, limit, signal }) =>
      cliente.get(ROTAS_CONVITES.convites, {
        resposta: ListaConvites,
        query: { cursor, limit },
        sinal: signal,
      }),
  });
  const atualizar = () => queryClient.invalidateQueries({ queryKey: CHAVE_CONVITES });
  const reenviar = useMutation({
    mutationFn: (id: string) =>
      cliente.post(`${ROTAS_CONVITES.convites}/${id}/reenviar`, { resposta: Convite }),
    onSuccess: atualizar,
  });
  const revogar = useMutation({
    mutationFn: (id: string) =>
      cliente.delete(`${ROTAS_CONVITES.convites}/${id}`, { resposta: null }),
    onSuccess: atualizar,
  });

  const colunas: Coluna<TipoConvite>[] = [
    { id: 'email', cabecalho: 'E-mail', celula: (c) => c.email },
    { id: 'papeis', cabecalho: 'Papéis', celula: (c) => resumoPapeis(c.atribuicoes, empresas) },
    {
      id: 'vence',
      cabecalho: 'Vence em',
      celula: (c) =>
        c.expirado ? <Badge variant="outline">Vencido</Badge> : dataCurta(c.expira_em),
    },
    { id: 'envio', cabecalho: 'Envio', celula: (c) => (c.envio ? ENVIO[c.envio] : '—') },
    {
      id: 'acoes',
      cabecalho: <span className="sr-only">Ações</span>,
      className: 'text-right',
      celula: (c) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => reenviar.mutate(c.id)}>
            Reenviar <span className="sr-only">convite para {c.email}</span>
          </Button>
          <Confirmar
            gatilho={
              <Button variant="ghost" size="sm">
                Revogar <span className="sr-only">convite para {c.email}</span>
              </Button>
            }
            titulo={`Revogar o convite para ${c.email}?`}
            descricao="O link do e-mail deixa de valer na hora."
            confirmar="Revogar"
            aoConfirmar={() => revogar.mutate(c.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <AvisoDeErro erro={reenviar.error ?? revogar.error} />
      {reenviar.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          Convite reenviado. O link anterior deixou de valer.
        </p>
      ) : null}
      <TabelaCursor
        paginacao={convites}
        colunas={colunas}
        rotulo="Convites pendentes"
        chaveLinha={(c) => c.id}
        vazio={{ titulo: 'Nenhum convite pendente' }}
      />
    </div>
  );
}

/** Primeira linha do editor: um papel que não é o de dono, na empresa atual. */
const linhaInicial = (papeis: readonly Papel[], empresaId: string | null): LinhaPapel[] => {
  const papel =
    papeis.find((p) => p.chave === 'ATENDENTE') ?? papeis.find((p) => p.chave !== PAPEL_DONO);
  return papel ? [{ papel_id: papel.id, empresa_id: empresaId }] : [];
};

function DialogoConvite({ aoFechar }: { aoFechar: () => void }) {
  const { cliente } = Route.useRouteContext();
  const { empresas, empresa } = useAcesso();
  const queryClient = useQueryClient();
  const papeis = useQuery(consultaPapeis(cliente));
  const [email, setEmail] = useState('');
  const [linhas, setLinhas] = useState<LinhaPapel[] | null>(null);
  const convidar = useMutation({
    mutationFn: (corpo: { email: string; atribuicoes: LinhaPapel[] }) =>
      cliente.post(ROTAS_CONVITES.convites, { resposta: Convite, corpo }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHAVE_CONVITES });
      aoFechar();
    },
  });
  const atuais = linhas ?? linhaInicial(papeis.data?.dados ?? [], empresa?.id ?? null);
  const [erroEmail, setErroEmail] = useState<string>();

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar para a conta</DialogTitle>
          <DialogDescription>
            A pessoa recebe um link por e-mail, válido por 7 dias, e entra com os papéis escolhidos.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            // Mesma regra do contrato, antes de ir à API.
            const validado = EntradaConvite.shape.email.safeParse(email.trim());
            setErroEmail(validado.success ? undefined : validado.error.issues[0]?.message);
            if (validado.success) convidar.mutate({ email: validado.data, atribuicoes: atuais });
          }}
        >
          <AvisoDeErro erro={convidar.error} />
          <Campo
            rotulo="E-mail"
            type="email"
            autoComplete="off"
            value={email}
            erro={erroEmail}
            onChange={(evento) => setEmail(evento.target.value)}
          />
          {papeis.data ? (
            <EditorPapeis
              papeis={papeis.data.dados}
              empresas={empresas}
              valor={atuais}
              aoMudar={setLinhas}
            />
          ) : (
            <AvisoDeErro erro={papeis.error} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={convidar.isPending || !papeis.data}>
              {convidar.isPending ? 'Enviando…' : 'Enviar convite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
