import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@ebisu/ui/lib/utils';

// Estados padrão de uma tela/seção (spec §4 F12): vazio, erro e carregando.

interface PropsEstado {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
}

export function EstadoVazio({ titulo, descricao, acao, className }: PropsEstado) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}>
      <Inbox aria-hidden className="size-10 text-muted-foreground" />
      <p className="text-base font-medium">{titulo}</p>
      {descricao ? <p className="max-w-sm text-sm text-muted-foreground">{descricao}</p> : null}
      {acao}
    </div>
  );
}

interface PropsErro extends PropsEstado {
  /** Código para o suporte localizar a falha nos logs (`request_id`). */
  codigoSuporte?: string;
}

export function EstadoErro({ titulo, descricao, acao, codigoSuporte, className }: PropsErro) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}
    >
      <AlertCircle aria-hidden className="size-10 text-destructive" />
      <p className="text-base font-medium">{titulo}</p>
      {descricao ? <p className="max-w-sm text-sm text-muted-foreground">{descricao}</p> : null}
      {codigoSuporte ? (
        <p className="text-xs text-muted-foreground">
          Código para o suporte: <code className="font-mono">{codigoSuporte}</code>
        </p>
      ) : null}
      {acao}
    </div>
  );
}

export function Carregando({
  titulo = 'Carregando…',
  className,
}: {
  titulo?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground',
        className,
      )}
    >
      <Loader2 aria-hidden className="size-4 animate-spin" />
      <span>{titulo}</span>
    </div>
  );
}
