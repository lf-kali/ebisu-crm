import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../../componentes/em-construcao';

export const Route = createFileRoute('/_app/dispositivos/')({
  component: () => <EmConstrucao titulo="Dispositivos" frente="F13-DSP" />,
});
