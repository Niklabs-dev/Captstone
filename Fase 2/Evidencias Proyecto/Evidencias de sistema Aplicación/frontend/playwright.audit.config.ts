import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/audit',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_AUDIT_FRONTEND_URL ?? 'http://localhost:3106',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
