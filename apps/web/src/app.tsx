import { RespostaSaude } from '@ebisu/contracts';
import { useEffect, useState } from 'react';

type StatusApi = 'verificando' | 'ok' | 'indisponivel';

const ROTULOS: Record<StatusApi, string> = {
  verificando: 'Verificando a API…',
  ok: 'API disponível',
  indisponivel: 'API indisponível',
};

export function App() {
  const [status, setStatus] = useState<StatusApi>('verificando');

  useEffect(() => {
    let ativo = true;
    // O mesmo schema que a API usa no contrato (packages/contracts).
    fetch('/v1/saude')
      .then(
        async (resposta) => resposta.ok && RespostaSaude.safeParse(await resposta.json()).success,
      )
      .then((disponivel) => (ativo ? setStatus(disponivel ? 'ok' : 'indisponivel') : undefined))
      .catch(() => (ativo ? setStatus('indisponivel') : undefined));
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <main>
      <h1>ebisuCRM</h1>
      <p role="status">{ROTULOS[status]}</p>
    </main>
  );
}
