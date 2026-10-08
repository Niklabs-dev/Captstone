import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/users',
  timeout: 45000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: 'test-results/users',
  use: {
    baseURL: process.env.TEST_USERS_FRONTEND_URL ?? 'http://localhost:3102',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
