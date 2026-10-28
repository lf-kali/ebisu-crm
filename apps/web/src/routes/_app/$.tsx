import { EstadoVazio } from '@ebisu/ui/components/estados';
import { createFileRoute } from '@tanstack/react-router';

// Qualquer caminho desconhecido cai aqui, dentro do layout (e atrás do login, como o resto).
export const Route = createFileRoute('/_app/$')({
  component: () => (
    <EstadoVazio titulo="Página não encontrada" descricao="Confira o endereço ou use o menu." />
  ),
});
