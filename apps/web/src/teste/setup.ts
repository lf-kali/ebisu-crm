import '../formularios/zod';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { reiniciarSimulacao, servidor } from './servidor';

// Os testes montam o app inteiro (rotas carregadas sob demanda, sessão, /v1/eu). No CI, com os
// arquivos de teste em paralelo, a primeira página de um arquivo passou de 1 s (padrão do
// Testing Library) e os findBy* estouraram; 3 s cobrem a carga a frio sem esconder travamentos.
configure({ asyncUtilTimeout: 3000 });

beforeAll(() => servidor.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  reiniciarSimulacao();
  window.localStorage.clear();
});
afterEach(() => cleanup());
afterAll(() => servidor.close());

// O roteador restaura a rolagem ao navegar; o jsdom não implementa scrollTo.
window.scrollTo = () => undefined;
