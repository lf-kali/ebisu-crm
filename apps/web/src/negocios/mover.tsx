import { type Etapa, type Negocio, NegocioDetalhado, ROTAS_NEGOCIOS } from '@ebisu/contracts';
import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import { Button } from '@ebisu/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ebisu/ui/components/ui/dropdown-menu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { ehConflitoDeVersao, ErroApi } from '../api/erro-api';
import { AvisoDeErro } from '../configuracoes/aviso';
import { atualizarCrm } from './consultas';

// "Mover para…" (plano docs/planos/f4-web-2-negocios.md, decisão 3): um menu com as etapas abertas,
// no cartão do quadro e na ficha. O 409 de requisitos mostra o que falta; o de versão recarrega.

const rotaApp = getRouteApi('/_app');

export function MoverNegocio({
  negocio,
  etapas,
}: {
  negocio: Pick<Negocio, 'id' | 'titulo' | 'etapa_id' | 'versao_registro'>;
  etapas: readonly Etapa[];
}) {
  const { cliente } = rotaApp.useRouteContext();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<unknown>(null);
  const mover = useMutation({
    mutationFn: (etapaId: string) =>
      cliente.post(`${ROTAS_NEGOCIOS.negocios}/${negocio.id}/mover`, {
        resposta: NegocioDetalhado,
        corpo: { etapa_id: etapaId, versao_registro: negocio.versao_registro },
      }),
    onMutate: () => setErro(null),
    onSuccess: () => atualizarCrm(queryClient),
    onError: async (e) => {
      setErro(e);
      // Outro pedido mudou o negócio: recarrega para a pessoa conferir (D-A08).
      if (ehConflitoDeVersao(e)) await atualizarCrm(queryClient);
    },
  });
  // Ganho fica para a conversão do orçamento (F6); perder e nutrir têm ações próprias.
  const destinos = etapas.filter((e) => e.tipo === 'ABERTA' && e.id !== negocio.etapa_id);

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={mover.isPending}
            className="w-fit"
            // Começa pelo texto visível (WCAG 2.5.3) e diz qual negócio, para o leitor de tela.
            aria-label={`Mover para… ${negocio.titulo}`}
          >
            {mover.isPending ? 'Movendo…' : 'Mover para…'}
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {destinos.map((e) => (
            <DropdownMenuItem key={e.id} onSelect={() => mover.mutate(e.id)}>
              {e.nome}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ErroAoMover erro={erro} />
    </div>
  );
}

/** "Falta: …" com a lista do 409 `requisitos_pendentes`; o resto, como nas outras telas. */
export function ErroAoMover({ erro }: { erro: unknown }) {
  if (!erro) return null;
  if (erro instanceof ErroApi && erro.codigo === 'requisitos_pendentes') {
    const { requisitos = [] } = erro.problema as { requisitos?: Array<{ descricao: string }> };
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p className="font-medium">Falta para avançar:</p>
          <ul className="list-disc pl-4">
            {requisitos.map((r) => (
              <li key={r.descricao}>{r.descricao}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }
  if (ehConflitoDeVersao(erro))
    return (
      <Alert variant="destructive">
        <AlertDescription>
          O negócio mudou enquanto você olhava. Confira os dados e tente de novo.
        </AlertDescription>
      </Alert>
    );
  return <AvisoDeErro erro={erro} />;
}
