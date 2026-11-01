import { Alert, AlertDescription } from '@ebisu/ui/components/ui/alert';
import { ErroApi } from '../api/erro-api';
import { LimiteExcedido } from '../componentes/entrada';
import { ErroDaApi } from '../componentes/erro-da-api';

/**
 * Erro de uma ação (salvar, revogar, convidar): o `detail` da API quando há (é a regra que a
 * pessoa precisa ler, ex.: "a conta precisa de um dono ativo"), senão o título do catálogo.
 */
export function AvisoDeErro({ erro }: { erro: unknown }) {
  if (!erro) return null;
  if (erro instanceof ErroApi && erro.status === 429) return <LimiteExcedido erro={erro} />;
  if (erro instanceof ErroApi && erro.status >= 400 && erro.status < 500)
    return (
      <Alert variant="destructive">
        <AlertDescription>{erro.problema.detail ?? erro.problema.title}</AlertDescription>
      </Alert>
    );
  return <ErroDaApi erro={erro} />;
}

/** CNPJ com máscara (numérico ou alfanumérico): 12.ABC.345/01DE-35. */
export const formatarCnpj = (cnpj: string | null) =>
  cnpj && cnpj.length === 14
    ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    : (cnpj ?? '—');

/** Data e hora curtas em pt-BR, ou "—". */
export const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
