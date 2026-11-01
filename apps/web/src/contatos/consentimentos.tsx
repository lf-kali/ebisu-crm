import {
  BaseLegal,
  CanalComunicacao,
  Consentimento,
  type Contato,
  EntradaConsentimento,
  FinalidadeConsentimento,
  ROTAS_CONTATOS,
} from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ebisu/ui/components/ui/table';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAcesso } from '../auth/acesso';
import { ErroDaApi } from '../componentes/erro-da-api';
import { AvisoDeErro, dataCurta } from '../configuracoes/aviso';
import { Selecao } from '../formularios/selecao';
import { CHAVE_CONTATOS, consultaConsentimentos, consultaContato } from './consultas';
import { BASES_LEGAIS, CANAIS, FINALIDADES } from './formatacao';

// Consentimentos LGPD na ficha (plano docs/planos/f4-web-1-contatos.md, decisão 8): a situação
// atual por canal e finalidade e o histórico. Só se acrescenta: revogar é um registro novo.

const rotaApp = getRouteApi('/_app');

const rotuloBase = (base: string) => BASES_LEGAIS[base as keyof typeof BASES_LEGAIS] ?? base;

export function Consentimentos({ contato }: { contato: Contato }) {
  const { cliente } = rotaApp.useRouteContext();
  const { pode } = useAcesso();
  const historico = useQuery(consultaConsentimentos(cliente, contato.id));
  const [registrando, setRegistrando] = useState(false);
  const situacao = new Map(contato.consentimentos.map((s) => [`${s.canal}:${s.finalidade}`, s]));

  return (
    <section aria-labelledby="titulo-consentimentos" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-consentimentos" className="text-lg font-semibold">
          Consentimentos
        </h2>
        {pode('contato.update') ? (
          <Button variant="outline" onClick={() => setRegistrando(true)}>
            Registrar consentimento
          </Button>
        ) : null}
      </div>

      <Table>
        <TableCaption className="sr-only">Situação atual por canal e finalidade</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Canal</TableHead>
            {FinalidadeConsentimento.options.map((f) => (
              <TableHead key={f} scope="col">
                {FINALIDADES[f]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {CanalComunicacao.options.map((canal) => (
            <TableRow key={canal}>
              <TableHead scope="row">{CANAIS[canal]}</TableHead>
              {FinalidadeConsentimento.options.map((f) => {
                const atual = situacao.get(`${canal}:${f}`);
                return (
                  <TableCell key={f}>
                    {!atual ? (
                      <span className="text-muted-foreground">Sem registro</span>
                    ) : atual.concedido ? (
                      <Badge variant="secondary">Concedido</Badge>
                    ) : (
                      <Badge variant="outline">Revogado</Badge>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h3 className="text-base font-semibold">Histórico</h3>
      {historico.isPending ? (
        <Carregando />
      ) : historico.isError ? (
        <ErroDaApi erro={historico.error} />
      ) : historico.data.dados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum consentimento registrado.</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">Histórico de consentimentos</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Quando</TableHead>
              <TableHead scope="col">Canal</TableHead>
              <TableHead scope="col">Finalidade</TableHead>
              <TableHead scope="col">Registro</TableHead>
              <TableHead scope="col">Base legal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {historico.data.dados.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{dataCurta(r.coletado_em)}</TableCell>
                <TableCell>{CANAIS[r.canal]}</TableCell>
                <TableCell>{FINALIDADES[r.finalidade]}</TableCell>
                <TableCell>{r.concedido ? 'Concedido' : 'Revogado'}</TableCell>
                <TableCell>{rotuloBase(r.base_legal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {registrando ? (
        <DialogoConsentimento contato={contato} aoFechar={() => setRegistrando(false)} />
      ) : null}
    </section>
  );
}

const Formulario = z.object({
  canal: CanalComunicacao,
  finalidade: FinalidadeConsentimento,
  situacao: z.enum(['concedido', 'revogado']),
  base_legal: BaseLegal,
});
type Valores = z.infer<typeof Formulario>;

function DialogoConsentimento({ contato, aoFechar }: { contato: Contato; aoFechar: () => void }) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<unknown>(null);
  const form = useForm<Valores>({
    resolver: zodResolver(Formulario),
    defaultValues: {
      canal: 'WHATSAPP',
      finalidade: 'TRANSACIONAL',
      situacao: 'concedido',
      base_legal: 'consentimento',
    },
  });
  const { isSubmitting } = form.formState;

  async function salvar({ situacao, ...resto }: Valores) {
    setErro(null);
    const corpo: EntradaConsentimento = {
      ...resto,
      concedido: situacao === 'concedido',
      evidencia: { origem: 'tela' },
    };
    try {
      await cliente.post(`${ROTAS_CONTATOS.contatos}/${contato.id}/consentimentos`, {
        resposta: Consentimento,
        corpo,
      });
      // A situação atual vem no contato; o histórico, na lista própria.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: consultaContato(cliente, contato.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: [...CHAVE_CONTATOS, 'lista'] }),
      ]);
      aoFechar();
    } catch (e) {
      setErro(e);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? null : aoFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar consentimento</DialogTitle>
          <DialogDescription>
            Cada registro fica no histórico. Para revogar, registre de novo com “Revogado”.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(salvar)} className="flex flex-col gap-4">
          <AvisoDeErro erro={erro} />
          <Selecao rotulo="Canal" {...form.register('canal')}>
            {CanalComunicacao.options.map((c) => (
              <option key={c} value={c}>
                {CANAIS[c]}
              </option>
            ))}
          </Selecao>
          <Selecao rotulo="Finalidade" {...form.register('finalidade')}>
            {FinalidadeConsentimento.options.map((f) => (
              <option key={f} value={f}>
                {FINALIDADES[f]}
              </option>
            ))}
          </Selecao>
          <Selecao rotulo="Situação" {...form.register('situacao')}>
            <option value="concedido">Concedido</option>
            <option value="revogado">Revogado</option>
          </Selecao>
          <Selecao rotulo="Base legal" {...form.register('base_legal')}>
            {BaseLegal.options.map((b) => (
              <option key={b} value={b}>
                {BASES_LEGAIS[b]}
              </option>
            ))}
          </Selecao>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando…' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
