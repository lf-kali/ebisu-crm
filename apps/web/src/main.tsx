import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { criarRouter } from './router';
import { aplicarTemaDoSistema } from './tema';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

aplicarTemaDoSistema();
const router = criarRouter();
createRoot(raiz).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
