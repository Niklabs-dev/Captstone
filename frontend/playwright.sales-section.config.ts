import { defineConfig, devices } from '@playwright/test';

// SPRINT-4A-T12: recorrido de la sección de ventas con el Excel real de
// MrComanda (MRCOMANDA_SAMPLE_XLSX), en escritorio y móvil. Se ejecuta contra
// un stack exclusivo: `npm run test:sales-section:real` lo levanta y lo borra.
export default defineConfig({
  testDir: './tests/real-sales-section',
  workers: 1,
  retries: 0,
  timeout: 120000,
  outputDir: 'output/playwright/sales-section/results',
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_REAL_FRONTEND_URL ?? 'http://127.0.0.1:3612',
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
