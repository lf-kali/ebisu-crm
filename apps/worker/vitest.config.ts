import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC preserva os metadados de decorators que a injeção de dependência do Nest exige.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
