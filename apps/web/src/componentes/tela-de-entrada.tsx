import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@ebisu/ui/components/ui/card';
import type { ReactNode } from 'react';

/** Moldura das telas fora do layout autenticado (login, escolha de conta). */
export function TelaDeEntrada({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-sm font-semibold tracking-tight text-muted-foreground">ebisuCRM</p>
          <CardTitle>
            <h1 className="text-xl">{titulo}</h1>
          </CardTitle>
          {descricao ? <CardDescription>{descricao}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
