import { defineConfig, devices } from '@playwright/test';

// Recorrido end-to-end de propinas y pago (SPRINT-4A-T13) contra el stack
// desechable de docs/docker-compose.tip-flow-test.yml (3613/3614).
export default defineConfig({
  testDir: './tests/real-tip-flow',
  workers: 1,
  retries: 0,
  timeout: 120000,
  outputDir: 'output/playwright/tip-flow/results',
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_REAL_FRONTEND_URL ?? 'http://127.0.0.1:3613',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
