import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/** Cabeçalho das telas de contatos: link de volta (opcional), título, descrição e ações. */
export function CabecalhoContatos({
  titulo,
  descricao,
  acoes,
  voltar,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  voltar?: { link: Pick<LinkProps, 'to' | 'params'>; rotulo: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {voltar ? (
        <Link
          {...voltar.link}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {voltar.rotulo}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          {descricao ? <div className="text-sm text-muted-foreground">{descricao}</div> : null}
        </div>
        {acoes ? <div className="flex flex-wrap gap-2">{acoes}</div> : null}
      </div>
    </div>
  );
}
