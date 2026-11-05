import { defineConfig, devices } from '@playwright/test';
// Requiere `next start -p 3112` con BACKEND_INTERNAL_URL=http://127.0.0.1:3147
// y el backend simulado de tests/sales-dashboard/backend.mjs.
export default defineConfig({
  testDir: './tests/sales-dashboard',
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_SALES_DASHBOARD_URL ?? 'http://127.0.0.1:3112',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Santiago',
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
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } },
    },
  ],
});
