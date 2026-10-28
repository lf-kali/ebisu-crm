import './index.css';
import './formularios/zod';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { criarRouter } from './router';
import { aplicarTemaDoSistema } from './tema';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

/**
 * API simulada (MSW) no navegador até a F3 entregar a API real. Só em `pnpm dev` com
 * VITE_API_SIMULADA=1: o `import.meta.env.DEV` tira tudo isto do build de produção.
 */
async function iniciarSimulacao() {
  if (!import.meta.env.DEV || import.meta.env.VITE_API_SIMULADA !== '1') return;
  const [{ setupWorker }, { criarApiSimulada }] = await Promise.all([
    import('msw/browser'),
    import('./simulacao/api-simulada'),
  ]);
  const simulada = criarApiSimulada({ persistir: window.sessionStorage });
  await setupWorker(...simulada.handlers).start({ onUnhandledFrame: 'bypass' });
}

aplicarTemaDoSistema();
await iniciarSimulacao();
const router = criarRouter();
createRoot(raiz).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
