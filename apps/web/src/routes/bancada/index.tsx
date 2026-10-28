import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/bancada/')({
  component: () => <EmConstrucao titulo="Bancada" frente="F13-OS" />,
});
