import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Sobe um Postgres real (Testcontainers) e aplica as migrações uma vez por arquivo.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
