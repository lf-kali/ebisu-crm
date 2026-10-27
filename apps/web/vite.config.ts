import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alvoApi = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { '/v1': alvoApi },
  },
  test: {
    environment: 'jsdom',
  },
});
