import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/real-api',
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: 'output/playwright/real-api',
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_REAL_FRONTEND_URL ?? 'http://127.0.0.1:3310',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablet-768',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
});
