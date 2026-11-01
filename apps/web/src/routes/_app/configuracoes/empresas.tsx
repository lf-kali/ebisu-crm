import {
  Cnpj,
  Empresa,
  EntradaEmpresa,
  type Empresa as TipoEmpresa,
  ListaEmpresas,
  ROTAS_EMPRESAS,
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
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErroApi } from '../../../api/erro-api';
import { type Coluna, TabelaCursor, usePaginacaoCursor } from '../../../componentes/tabela-cursor';
import { AvisoDeErro, formatarCnpj } from '../../../configuracoes/aviso';
import { Confirmar } from '../../../configuracoes/confirmacao';
import { CabecalhoConfiguracao, SePodeVer } from '../../../configuracoes/pagina';
import { aplicarErrosDaApi, Campo } from '../../../formularios/campo';

// Empresas da conta (plano docs/planos/f3-web-2-configuracoes.md, decisão 3).

export const Route = createFileRoute('/_app/configuracoes/empresas')({ component: Empresas });

const CHAVE = ['configuracoes', 'empresas'] as const;
const SECAO = { permissao: 'config.empresa', daConta: true } as const;

function Empresas() {
  return (
    <SePodeVer secao={SECAO}>
      <ConteudoEmpresas />
    </SePodeVer>
  );
}

function ConteudoEmpresas() {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<TipoEmpresa | 'nova' | null>(null);
  const paginacao = usePaginacaoCursor({
    chave: CHAVE,
    filtros: {},
    buscar: ({ cursor, limit, signal }) =>
      cliente.get(ROTAS_EMPRESAS.empresas, {
        resposta: ListaEmpresas,
        query: { cursor, limit },
        sinal: signal,
      }),
  });
  const desativar = useMutation({
    mutationFn: (id: string) =>
      cliente.delete(`${ROTAS_EMPRESAS.empresas}/${id}`, { resposta: null }),
    // O seletor de empresa (/v1/eu) também muda.
    onSuccess: () => invalidar(queryClient),
  });

  const colunas: Coluna<TipoEmpresa>[] = [
    { id: 'nome', cabecalho: 'Nome fantasia', celula: (e) => e.nome_fantasia },
    { id: 'razao', cabecalho: 'Razão social', celula: (e) => e.razao_social },
    {
      id: 'cnpj',
      cabecalho: 'CNPJ',
      celula: (e) => <span className="tabular-nums">{formatarCnpj(e.cnpj)}</span>,
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      celula: (e) =>
        e.ativo ? (
          <Badge variant="secondary">Ativa</Badge>
        ) : (
          <Badge variant="outline">Inativa</Badge>
        ),
    },
    {
      id: 'acoes',
      cabecalho: <span className="sr-only">Ações</span>,
      className: 'text-right',
      celula: (e) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditando(e)}>
            Editar <span className="sr-only">{e.nome_fantasia}</span>
          </Button>
          {e.ativo ? (
            <Confirmar
              gatilho={
                <Button variant="ghost" size="sm">
                  Desativar <span className="sr-only">{e.nome_fantasia}</span>
                </Button>
              }
              titulo={`Desativar ${e.nome_fantasia}?`}
              descricao="A empresa sai do seletor e das telas; o histórico continua guardado."
              confirmar="Desativar"
              aoConfirmar={() => desativar.mutate(e.id)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <CabecalhoConfiguracao
        titulo="Empresas"
        descricao="Lojas e filiais da conta."
        acoes={<Button onClick={() => setEditando('nova')}>Nova empresa</Button>}
      />
      <div className="mb-4">
        <AvisoDeErro erro={desativar.error} />
      </div>
      <TabelaCursor
        paginacao={paginacao}
        colunas={colunas}
        rotulo="Empresas da conta"
        chaveLinha={(e) => e.id}
        vazio={{ titulo: 'Nenhuma empresa' }}
      />
      {editando ? (
        <DialogoEmpresa
          empresa={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      ) : null}
    </>
  );
}

const invalidar = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAVE }),
    queryClient.invalidateQueries({ queryKey: ['eu'] }),
  ]);

/** CNPJ opcional: vazio vira null (sem CNPJ). */
const Formulario = EntradaEmpresa.extend({
  cnpj: z
    .string()
    .trim()
    .transform((valor) => valor || null)
    .pipe(Cnpj.nullable()),
});
type Entrada = z.input<typeof Formulario>;
type Saida = z.output<typeof Formulario>;

function DialogoEmpresa({
  empresa,
  aoFechar,
}: {
  empresa: TipoEmpresa | null;
  aoFechar: () => void;
}) {
  const { cliente } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<unknown>(null);
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(Formulario),
    defaultValues: {
      razao_social: empresa?.razao_social ?? '',
      nome_fantasia: empresa?.nome_fantasia ?? '',
      cnpj: empresa?.cnpj ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function salvar({ cnpj, ...resto }: Saida) {
    setErro(null);
    try {
      if (empresa)
        await cliente.patch(`${ROTAS_EMPRESAS.empresas}/${empresa.id}`, {
          resposta: Empresa,
          corpo: { ...resto, cnpj },
        });
      else
        await cliente.post(ROTAS_EMPRESAS.empresas, {
          resposta: Empresa,
          corpo: { ...resto, ...(cnpj ? { cnpj } : {}) },
        });
      await invalidar(queryClient);
      aoFechar();
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'duplicado')
        form.setError('cnpj', { message: 'Já existe uma empresa com este CNPJ na conta.' });
      else if (!aplicarErrosDaApi(e, form.setError, ['razao_social', 'nome_fantasia', 'cnpj']))
        setErro(e);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{empresa ? `Editar ${empresa.nome_fantasia}` : 'Nova empresa'}</DialogTitle>
          <DialogDescription>
            {empresa
              ? 'Os dados aparecem nos documentos e no seletor de empresa.'
              : 'A empresa nasce com o funil, as origens e os motivos de perda padrão.'}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(salvar)} className="flex flex-col gap-4">
          <AvisoDeErro erro={erro} />
          <Campo
            rotulo="Nome fantasia"
            erro={errors.nome_fantasia?.message}
            {...form.register('nome_fantasia')}
          />
          <Campo
            rotulo="Razão social"
            erro={errors.razao_social?.message}
            {...form.register('razao_social')}
          />
          <Campo rotulo="CNPJ (opcional)" erro={errors.cnpj?.message} {...form.register('cnpj')} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
