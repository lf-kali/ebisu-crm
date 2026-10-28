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
import { useEffect, useState } from 'react';
import { ErroDaApi } from './componentes/erro-da-api';
import { AppShell } from './layout/app-shell';

type StatusApi =
  { fase: 'verificando' } | { fase: 'ok' } | { fase: 'indisponivel'; erro?: unknown };

export function App() {
  const [status, setStatus] = useState<StatusApi>({ fase: 'verificando' });

  useEffect(() => {
    let ativo = true;
    // O mesmo schema que a API usa no contrato (packages/contracts).
    fetch('/v1/saude')
      .then(async (resposta) => {
        const corpo: unknown = await resposta.json().catch(() => undefined);
        if (resposta.ok && RespostaSaude.safeParse(corpo).success) return { fase: 'ok' } as const;
        return { fase: 'indisponivel', erro: corpo } as const;
      })
      .catch(() => ({ fase: 'indisponivel' }) as const)
      .then((novo) => (ativo ? setStatus(novo) : undefined));
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <AppShell caminhoAtual="/">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Painel</h1>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Status da API</CardTitle>
          <CardDescription>Conexão com o servidor do ebisuCRM.</CardDescription>
        </CardHeader>
        <CardContent>
          {status.fase === 'verificando' ? <Carregando titulo="Verificando a API…" /> : null}
          {status.fase === 'ok' ? (
            <Badge className="bg-sucesso text-sucesso-foreground">API disponível</Badge>
          ) : null}
          {status.fase === 'indisponivel' ? <ErroDaApi erro={status.erro} /> : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
