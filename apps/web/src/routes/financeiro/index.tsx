import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/financeiro/')({
  component: () => <EmConstrucao titulo="Financeiro" frente="F13-FIN" />,
});
