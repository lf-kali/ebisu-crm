import { createFileRoute } from '@tanstack/react-router';
import { EmConstrucao } from '../../componentes/em-construcao';

export const Route = createFileRoute('/configuracoes/')({
  component: () => <EmConstrucao titulo="Configurações" frente="F13-CFG" />,
});
