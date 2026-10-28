import { RespostaSaude } from '@ebisu/contracts';
import { Carregando } from '@ebisu/ui/components/estados';
import { Badge } from '@ebisu/ui/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@ebisu/ui/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../api/cliente';
import { ErroDaApi } from '../componentes/erro-da-api';

export const consultaSaude = {
  queryKey: ['saude'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api.get('/v1/saude', { resposta: RespostaSaude, sinal: signal }),
} as const;

function Painel() {
  const saude = useQuery(consultaSaude);
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Painel</h1>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Status da API</CardTitle>
          <CardDescription>Conexão com o servidor do ebisuCRM.</CardDescription>
        </CardHeader>
        <CardContent>
          {saude.isPending ? <Carregando titulo="Verificando a API…" /> : null}
          {saude.isSuccess ? (
            <Badge className="bg-sucesso text-sucesso-foreground">API disponível</Badge>
          ) : null}
          {saude.isError ? <ErroDaApi erro={saude.error} /> : null}
        </CardContent>
      </Card>
    </>
  );
}

export const Route = createFileRoute('/')({ component: Painel });
