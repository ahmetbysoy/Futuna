import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  expect: { timeout: 8_000 },
  use: {
    launchOptions: { headless: true },
    baseURL: 'http://localhost:5173',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testMatch: /(?:desktop|features|screenshots)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: /(?:desktop|features)\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: /(?:desktop|features)\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', testMatch: /(?:mobile|screenshots)\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', testMatch: /mobile\.spec\.ts/, use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 0.0.0.0',
    url: 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
