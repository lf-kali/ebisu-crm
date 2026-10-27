import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// O .env fica na raiz do monorepo, compartilhado com o docker compose e a API.
const RAIZ = new URL('../..', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, RAIZ, ''), ...process.env };

  return {
    plugins: [react()],
    envDir: RAIZ,
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: { '/v1': env.VITE_API_PROXY ?? 'http://localhost:3000' },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
