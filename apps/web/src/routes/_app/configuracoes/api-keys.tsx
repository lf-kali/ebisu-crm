import {
  ApiKey,
  ApiKeyCriada,
  type ApiKey as TipoApiKey,
  ListaApiKeys,
  ROTAS_API_KEYS,
  type TipoApiKey as Tipo,
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
import { Input } from '@ebisu/ui/components/ui/input';
import { Label } from '@ebisu/ui/components/ui/label';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useAcesso } from '../../../auth/acesso';
import { type Coluna, TabelaCursor, usePaginacaoCursor } from '../../../componentes/tabela-cursor';
import { AvisoDeErro, dataCurta } from '../../../configuracoes/aviso';
import { Confirmar } from '../../../configuracoes/confirmacao';
import { CabecalhoConfiguracao, SePodeVer } from '../../../configuracoes/pagina';
import { Campo } from '../../../formularios/campo';
import { Selecao } from '../../../formularios/selecao';

// API keys da empresa atual (plano docs/planos/f3-web-2-configuracoes.md, decisão 6). O token só
// existe na resposta da criação: aparece uma vez, num diálogo próprio, e sai da memória ao fechar.

export const Route = createFileRoute('/_app/configuracoes/api-keys')({ component: ApiKeys });

const CHAVE = ['configuracoes', 'api-keys'] as const;
const SECAO = { permissao: 'config.api_keys', daConta: false } as const;
const TIPOS: Record<Tipo, string> = { SERVIDOR: 'Servidor', NAVEGADOR: 'Site' };

function ApiKeys() {
  return (
    <SePodeVer secao={SECAO}>
      <ConteudoApiKeys />
    </SePodeVer>
  );
}

const situacao = (k: TipoApiKey) =>
  k.revogada_em
    ? 'Revogada'
    : k.expira_em && Date.parse(k.expira_em) <= Date.now()
      ? 'Vencida'
      : 'Ativa';

function ConteudoApiKeys() {
  const { cliente } = Route.useRouteContext();
  const { empresa } = useAcesso();
  const queryClient = useQueryClient();
  const [dialogo, setDialogo] = useState<TipoApiKey | 'nova' | null>(null);
  const paginacao = usePaginacaoCursor({
    chave: CHAVE,
    filtros: {},
    buscar: ({ cursor, limit, signal }) =>
      cliente.get(ROTAS_API_KEYS.apiKeys, {
        resposta: ListaApiKeys,
        query: { cursor, limit },
        sinal: signal,
      }),
  });
  const revogar = useMutation({
    mutationFn: (id: string) =>
      cliente.delete(`${ROTAS_API_KEYS.apiKeys}/${id}`, { resposta: null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAVE }),
  });

  const colunas: Coluna<TipoApiKey>[] = [
    { id: 'nome', cabecalho: 'Nome', celula: (k) => k.nome },
    { id: 'tipo', cabecalho: 'Tipo', celula: (k) => TIPOS[k.tipo] },
    {
      id: 'prefixo',
      cabecalho: 'Início da chave',
      celula: (k) => <code className="text-xs">{k.prefixo}…</code>,
    },
    {
      id: 'escopos',
      cabecalho: 'Permite',
      celula: (k) =>
        k.tipo === 'NAVEGADOR'
          ? `Captura de lead em ${k.origens_cors.join(', ')}`
          : k.escopos.join(', '),
    },
    { id: 'uso', cabecalho: 'Último uso', celula: (k) => dataCurta(k.ultimo_uso) },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      celula: (k) => (
        <Badge variant={situacao(k) === 'Ativa' ? 'secondary' : 'outline'}>{situacao(k)}</Badge>
      ),
    },
    {
      id: 'acoes',
      cabecalho: <span className="sr-only">Ações</span>,
      className: 'text-right',
      celula: (k) =>
        k.revogada_em ? null : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogo(k)}>
              Editar <span className="sr-only">{k.nome}</span>
            </Button>
            <Confirmar
              gatilho={
                <Button variant="ghost" size="sm">
                  Revogar <span className="sr-only">{k.nome}</span>
                </Button>
              }
              titulo={`Revogar a chave ${k.nome}?`}
              descricao="Quem usa esta chave perde o acesso na hora. Não dá para desfazer."
              confirmar="Revogar"
              aoConfirmar={() => revogar.mutate(k.id)}
            />
          </div>
        ),
    },
  ];

  return (
    <>
      <CabecalhoConfiguracao
        titulo="API keys"
        descricao={`Chaves de ${empresa?.nome_fantasia ?? 'esta empresa'} para integrações e para o formulário do site.`}
        acoes={<Button onClick={() => setDialogo('nova')}>Nova chave</Button>}
      />
      <div className="mb-4">
        <AvisoDeErro erro={revogar.error} />
      </div>
      <TabelaCursor
        paginacao={paginacao}
        colunas={colunas}
        rotulo="API keys da empresa"
        chaveLinha={(k) => k.id}
        vazio={{
          titulo: 'Nenhuma API key',
          descricao: 'Crie uma para ligar o site ou outro sistema.',
        }}
      />
      {dialogo === 'nova' ? <DialogoNovaChave aoFechar={() => setDialogo(null)} /> : null}
      {dialogo && dialogo !== 'nova' ? (
        <DialogoEditarChave chave={dialogo} aoFechar={() => setDialogo(null)} />
      ) : null}
    </>
  );
}

/**
 * Escopos que a pessoa pode dar (decisão 5 do PR 5 da API): o que ela tem na empresa atual com
 * EMPRESA ou TENANT, sem `config.*`.
 */
function useEscoposPermitidos() {
  const { empresa } = useAcesso();
  return Object.entries(empresa?.permissoes ?? {})
    .filter(([chave, escopo]) => !chave.startsWith('config.') && escopo !== 'PROPRIO')
    .map(([chave]) => chave)
    .sort();
}

function Escopos({
  valor,
  aoMudar,
  erro,
}: {
  valor: readonly string[];
  aoMudar: (escopos: string[]) => void;
  erro?: string;
}) {
  const permitidos = useEscoposPermitidos();
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={erro ? `${id}-erro` : undefined}>
      <legend className="mb-1 text-sm font-medium">O que a chave pode fazer</legend>
      {permitidos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Você não tem permissões que possa dar a uma chave.
        </p>
      ) : (
        <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {permitidos.map((escopo) => (
            <label key={escopo} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                checked={valor.includes(escopo)}
                onChange={(evento) =>
                  aoMudar(
                    evento.target.checked ? [...valor, escopo] : valor.filter((e) => e !== escopo),
                  )
                }
              />
              <code>{escopo}</code>
            </label>
          ))}
        </div>
      )}
      {erro ? (
        <p id={`${id}-erro`} className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
    </fieldset>
  );
}

function Origens({ valor, aoMudar }: { valor: string; aoMudar: (texto: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Endereços do site (um por linha)</Label>
      <textarea
        id={id}
        rows={3}
        value={valor}
        aria-describedby={`${id}-dica`}
        onChange={(evento) => aoMudar(evento.target.value)}
        className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p id={`${id}-dica`} className="text-sm text-muted-foreground">
        Ex.: https://www.sualoja.com.br. A chave só funciona nos formulários desses endereços.
      </p>
    </div>
  );
}

const linhas = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean);

function DialogoNovaChave({ aoFechar }: { aoFechar: () => void }) {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>('SERVIDOR');
  const [nome, setNome] = useState('');
  const [expira, setExpira] = useState('');
  const [escopos, setEscopos] = useState<string[]>([]);
  const [origens, setOrigens] = useState('');
  const criar = useMutation({
    mutationFn: () =>
      cliente.post(ROTAS_API_KEYS.apiKeys, {
        resposta: ApiKeyCriada,
        corpo: {
          tipo,
          nome: nome.trim(),
          ...(expira ? { expira_em: new Date(`${expira}T23:59:59`).toISOString() } : {}),
          ...(tipo === 'SERVIDOR' ? { escopos } : { origens_cors: linhas(origens) }),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAVE }),
    // Sem retenção no cache de mutações: depois do reset, a resposta (com o token) some.
    gcTime: 0,
  });

  // Criada: o token aparece aqui, uma vez. Fechar descarta a resposta (reset) junto com o token.
  if (criar.data)
    return (
      <DialogoToken
        nome={criar.data.nome}
        token={criar.data.token}
        aoFechar={() => {
          criar.reset();
          aoFechar();
        }}
      />
    );

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova API key</DialogTitle>
          <DialogDescription>
            De servidor, para integrações (n8n, outro sistema); de site, para o formulário de
            captura de leads, que fica visível no navegador.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            criar.mutate();
          }}
        >
          <AvisoDeErro erro={criar.error} />
          <Selecao
            rotulo="Tipo"
            value={tipo}
            onChange={(evento) => setTipo(evento.target.value as Tipo)}
          >
            <option value="SERVIDOR">Servidor (integrações)</option>
            <option value="NAVEGADOR">Site (formulário de captura)</option>
          </Selecao>
          <Campo
            rotulo="Nome"
            value={nome}
            maxLength={80}
            dica="Para reconhecer a chave depois, ex.: n8n, site da loja."
            onChange={(evento) => setNome(evento.target.value)}
          />
          {tipo === 'SERVIDOR' ? (
            <Escopos valor={escopos} aoMudar={setEscopos} />
          ) : (
            <Origens valor={origens} aoMudar={setOrigens} />
          )}
          <Campo
            rotulo="Vence em (opcional)"
            type="date"
            value={expira}
            onChange={(evento) => setExpira(evento.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Criando…' : 'Criar chave'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoToken({
  nome,
  token,
  aoFechar,
}: {
  nome: string;
  token: string | null;
  aoFechar: () => void;
}) {
  const [copia, setCopia] = useState<'ok' | 'falhou' | null>(null);
  const id = useId();
  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chave {nome} criada</DialogTitle>
          <DialogDescription>
            Copie agora: por segurança, a chave completa não aparece de novo. Se perder, revogue e
            crie outra.
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={id}>Chave (cabeçalho X-Api-Key)</Label>
            <div className="flex gap-2">
              <Input
                id={id}
                readOnly
                value={token}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void Promise.resolve(navigator.clipboard?.writeText(token))
                    .then(() => setCopia(navigator.clipboard ? 'ok' : 'falhou'))
                    .catch(() => setCopia('falhou'))
                }
              >
                Copiar
              </Button>
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {copia === 'ok'
                ? 'Copiada.'
                : copia === 'falhou'
                  ? 'Não foi possível copiar. Selecione o campo e copie à mão.'
                  : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm">
            Esta chave já foi criada antes e o token não pode ser mostrado de novo.
          </p>
        )}
        <DialogFooter>
          <Button onClick={aoFechar}>Já copiei</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEditarChave({ chave, aoFechar }: { chave: TipoApiKey; aoFechar: () => void }) {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(chave.nome);
  const [escopos, setEscopos] = useState<string[]>(chave.escopos);
  const [origens, setOrigens] = useState(chave.origens_cors.join('\n'));
  const salvar = useMutation({
    mutationFn: () =>
      cliente.patch(`${ROTAS_API_KEYS.apiKeys}/${chave.id}`, {
        resposta: ApiKey,
        corpo: {
          nome: nome.trim(),
          ...(chave.tipo === 'SERVIDOR' ? { escopos } : { origens_cors: linhas(origens) }),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHAVE });
      aoFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar {chave.nome}</DialogTitle>
          <DialogDescription>O tipo da chave não muda depois de criada.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            salvar.mutate();
          }}
        >
          <AvisoDeErro erro={salvar.error} />
          <Campo
            rotulo="Nome"
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
          />
          {chave.tipo === 'SERVIDOR' ? (
            <Escopos valor={escopos} aoMudar={setEscopos} />
          ) : (
            <Origens valor={origens} aoMudar={setOrigens} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
