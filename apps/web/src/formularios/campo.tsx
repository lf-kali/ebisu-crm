import { Input } from '@ebisu/ui/components/ui/input';
import { Label } from '@ebisu/ui/components/ui/label';
import { type ComponentProps, useId } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ErroApi } from '../api/erro-api';

interface PropsCampo extends ComponentProps<typeof Input> {
  rotulo: string;
  erro?: string;
}

/** Rótulo + campo + mensagem de erro ligada por aria-describedby (o leitor de tela lê o erro). */
export function Campo({ rotulo, erro, id, ...props }: PropsCampo) {
  const gerado = useId();
  const idCampo = id ?? gerado;
  const idErro = `${idCampo}-erro`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={idCampo}>{rotulo}</Label>
      <Input
        id={idCampo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? idErro : undefined}
        {...props}
      />
      {erro ? (
        <p id={idErro} className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Leva os erros por campo de um 422 `validacao` para o formulário. Devolve true se havia algum
 * campo do formulário entre eles (os demais ficam para a mensagem geral).
 */
export function aplicarErrosDaApi<T extends FieldValues>(
  erro: unknown,
  setError: UseFormSetError<T>,
  campos: readonly Path<T>[],
): boolean {
  if (!(erro instanceof ErroApi) || erro.codigo !== 'validacao') return false;
  let aplicou = false;
  for (const [campo, mensagem] of Object.entries(erro.errosDeCampo)) {
    if (!campos.includes(campo as Path<T>)) continue;
    setError(campo as Path<T>, { type: 'server', message: mensagem });
    aplicou = true;
  }
  return aplicou;
}
