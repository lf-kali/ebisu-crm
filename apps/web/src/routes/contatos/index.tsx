import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/contatos/')({
  component: () => <EmConstrucao titulo="Contatos" frente="F13-CRM" />,
});
