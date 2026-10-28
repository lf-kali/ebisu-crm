import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../../componentes/em-construcao';

export const Route = createFileRoute('/_app/negocios/')({
  component: () => <EmConstrucao titulo="Negócios" frente="F13-CRM" />,
});
