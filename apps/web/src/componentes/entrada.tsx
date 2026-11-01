import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import type { ErroApi } from '../api/erro-api';

// Peças das telas de entrada públicas (cadastro e convite).

/** A política de senha da API (PR 4a, decisão 3), dita antes do envio. */
export const REGRA_SENHA =
  'De 12 a 128 caracteres, sem seu nome ou e-mail. Senhas comuns são recusadas.';

/** "Tente de novo em N minutos", pelo Retry-After do 429. */
export function quandoTentarDeNovo(segundos: number | null): string {
  if (!segundos) return 'Tente de novo daqui a pouco.';
  const minutos = Math.ceil(segundos / 60);
  return minutos <= 1 ? 'Tente de novo em 1 minuto.' : `Tente de novo em ${minutos} minutos.`;
}

export function LimiteExcedido({ erro }: { erro: ErroApi }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        Muitas tentativas seguidas. {quandoTentarDeNovo(erro.esperaSegundos)}
      </AlertDescription>
    </Alert>
  );
}
