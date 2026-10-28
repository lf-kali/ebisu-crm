import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/orcamentos/')({
  component: () => <EmConstrucao titulo="Orçamentos" frente="F13-ORC" />,
});
