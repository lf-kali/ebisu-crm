import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const hostsPermitidos = (valor: string | undefined) =>
  valor
    ?.split(',')
    .map((host) => host.trim())
    .filter(Boolean) ?? [];

// O .env fica na raiz do monorepo, compartilhado com o docker compose e a API.
const RAIZ = new URL('../..', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, RAIZ, ''), ...process.env };

  return {
    // O plugin do roteador precisa vir antes do React (gera src/routeTree.gen.ts e divide o código por rota).
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    envDir: RAIZ,
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: { '/v1': env.VITE_API_PROXY ?? 'http://localhost:3000' },
      // Acesso por outro host (ex.: tailnet via `pnpm dev:tailnet`). Sem a variável, o Vite
      // continua aceitando só localhost (proteção contra DNS rebinding).
      allowedHosts: hostsPermitidos(env.WEB_ALLOWED_HOSTS),
      // Atrás de um proxy HTTPS (tailscale serve), o navegador conecta o HMR na porta do proxy.
      ...(env.WEB_HMR_CLIENT_PORT ? { hmr: { clientPort: Number(env.WEB_HMR_CLIENT_PORT) } } : {}),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/teste/setup.ts'],
    },
  };
});
