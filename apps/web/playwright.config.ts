import { defineConfig, devices } from '@playwright/test'

/** The production build, served by `vite preview`: what the specs test unless they say otherwise. */
const PREVIEW = 'http://localhost:4173'
/** The dev server: the gallery spec's, since `/_gallery` is a development route. */
const DEV = 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: PREVIEW,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun run build && bun run preview',
      url: PREVIEW,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'bun run dev',
      url: `${DEV}/_gallery`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
