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
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
