import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/estoque/')({
  component: () => <EmConstrucao titulo="Estoque" frente="F13-EST" />,
});
