import { defineConfig, devices } from '@playwright/test';
import { URL_WEB } from './ambiente';

// E2E do MVP (spec §4 F13): Chromium contra API, worker e web reais, que o setup global sobe.

export default defineConfig({
  testDir: './testes',
  globalSetup: './preparar.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: URL_WEB,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
