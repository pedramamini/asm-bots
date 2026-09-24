import { defineConfig, devices } from '@playwright/test'

/** The production build, served by `vite preview`: what the specs test unless they say otherwise. */
const PREVIEW = 'http://localhost:4173'
/** The dev server: the gallery spec's, since `/_gallery` is a development route. */
const DEV = 'http://localhost:5173'
/**
 * The Worker (`wrangler dev`, apps/api) serving that same build and the API on one origin, as
 * production does, with `DEV_FAKE_AUTH` on: sign-in skips GitHub. Its own port and its own local
 * storage, emptied, migrated, and given the launch seed (the hills, the roster on them) at each
 * start, so `bun run dev` can run beside it. A `Runner` waits `RUNNER_ALARM_DELAY_MS` between its
 * matches, so a spec can watch a submission's progress.
 */
export const WORKER = 'http://localhost:8788'
const WORKER_STATE = '.wrangler/e2e'
const WORKER_COMMAND = [
  'cd ../api',
  `rm -rf ${WORKER_STATE}`,
  `bunx wrangler d1 migrations apply asmbots --local --persist-to ${WORKER_STATE}`,
  `bun run scripts/seed.ts --local --persist-to ${WORKER_STATE}`,
  `bunx wrangler dev --port 8788 --inspector-port 9239 --persist-to ${WORKER_STATE} --var DEV_FAKE_AUTH:1 --var SESSION_SECRET:e2e-session-secret --var RUNNER_ALARM_DELAY_MS:300`,
].join(' && ')
/** The frame-rate spec: it runs alone, since specs beside it on the same CPU slow the frames. */
const PERF = /arena-perf\.spec\.ts$/

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: PERF },
    // After the rest; `--project perf --no-deps` runs it on its own.
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
      testMatch: PERF,
      dependencies: ['chromium'],
    },
  ],
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
    // After the preview, whose command builds the `dist` this serves.
    {
      command: WORKER_COMMAND,
      url: `${WORKER}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
