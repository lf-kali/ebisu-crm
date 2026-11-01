import { Label } from '@ebisu/ui/components/ui/label';
import { cn } from '@ebisu/ui/lib/utils';
import { type ComponentProps, useId } from 'react';

interface PropsSelecao extends ComponentProps<'select'> {
  rotulo: string;
  erro?: string;
  /** Rótulo só para leitor de tela (ex.: numa linha de tabela com cabeçalho visível). */
  rotuloOculto?: boolean;
}

/**
 * `<select>` nativo com o visual do `Input` (DESIGN.md: listas de opção nativas, acessíveis sem
 * trabalho extra). Rótulo e erro ligados como no `Campo`.
 */
export function Selecao({
  rotulo,
  erro,
  rotuloOculto,
  id,
  className,
  children,
  ...props
}: PropsSelecao) {
  const gerado = useId();
  const idCampo = id ?? gerado;
  const idErro = `${idCampo}-erro`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={idCampo} className={rotuloOculto ? 'sr-only' : undefined}>
        {rotulo}
      </Label>
      <select
        id={idCampo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? idErro : undefined}
        className={cn(
          'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {erro ? (
        <p id={idErro} className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
