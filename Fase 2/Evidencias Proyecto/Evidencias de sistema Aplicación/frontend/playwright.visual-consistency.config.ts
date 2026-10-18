import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual-consistency',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  outputDir: 'output/playwright/visual-consistency/results',
  use: {
    baseURL: process.env.TEST_UI_FRONTEND_URL ?? 'http://127.0.0.1:3115',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
