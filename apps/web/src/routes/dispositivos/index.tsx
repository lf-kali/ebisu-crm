import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/dispositivos/')({
  component: () => <EmConstrucao titulo="Dispositivos" frente="F13-DSP" />,
});
