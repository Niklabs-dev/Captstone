import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/payroll',
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_PAYROLL_URL ?? 'http://127.0.0.1:3112',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Santiago',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
