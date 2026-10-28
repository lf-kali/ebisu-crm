import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// API simulada (MSW) para os testes do web. Cada teste troca as respostas com `servidor.use(...)`;
// requisição sem handler falha o teste (onUnhandledFrame: 'error' no setup).
export const handlersPadrao = [http.get('*/v1/saude', () => HttpResponse.json({ status: 'ok' }))];

export const servidor = setupServer(...handlersPadrao);
