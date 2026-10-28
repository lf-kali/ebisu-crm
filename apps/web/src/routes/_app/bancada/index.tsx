import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../../componentes/em-construcao';

export const Route = createFileRoute('/_app/bancada/')({
  component: () => <EmConstrucao titulo="Bancada" frente="F13-OS" />,
});
