import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { aplicarTemaDoSistema } from './tema';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

aplicarTemaDoSistema();
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
