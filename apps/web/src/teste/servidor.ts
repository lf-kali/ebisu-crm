import { setupServer } from 'msw/node';
import { criarApiSimulada } from '../simulacao/api-simulada';

// API simulada (MSW) para os testes do web: a mesma do `pnpm dev` (src/simulacao), recriada a
// cada teste. Cada teste troca respostas com `servidor.use(...)`; requisição sem handler falha o
// teste (onUnhandledFrame: 'error' no setup).
export let simulada = criarApiSimulada();

export const servidor = setupServer(...simulada.handlers);

export function reiniciarSimulacao() {
  simulada = criarApiSimulada();
  servidor.resetHandlers(...simulada.handlers);
}
