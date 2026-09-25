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
 * matches, so a spec can watch a submission's progress. `--local-upstream` keeps the Worker's
 * request URLs on localhost: without it `wrangler dev` gives them the production route's host
 * (`asmbots.io`), so fake sign-in (localhost only) and the same-origin check on writes refuse.
 */
export const WORKER = 'http://localhost:8788'
const WORKER_STATE = '.wrangler/e2e'
export const WORKER_COMMAND = [
  'cd ../api',
  `rm -rf ${WORKER_STATE}`,
  `bunx wrangler d1 migrations apply asmbots --local --persist-to ${WORKER_STATE}`,
  `bun run scripts/seed.ts --local --persist-to ${WORKER_STATE}`,
  `bunx wrangler dev --port 8788 --inspector-port 9239 --local-upstream localhost:8788 --persist-to ${WORKER_STATE} --var DEV_FAKE_AUTH:1 --var SESSION_SECRET:e2e-session-secret --var RUNNER_ALARM_DELAY_MS:300`,
].join(' && ')
/**
 * The runtime budgets' specs: the frame rate, and the 10-minute soak (opt-in, `SOAK=1`). They run
 * alone, since specs beside them on the same CPU slow the frames, and on the real GPU where there
 * is one (Metal on a Mac, as PRODUCT_SPEC §11's "Chrome, M1"): headless Chromium's default GL is
 * SwiftShader, whose work on the CPU holds the page's thread (web README "Budgets").
 * `PERF_GL=software` keeps SwiftShader, as a machine with no GPU has it.
 */
const PERF = /arena-(perf|soak)\.spec\.ts$/
const GPU_ARGS =
  process.platform === 'darwin' && process.env.PERF_GL !== 'software' ? ['--use-angle=metal'] : []

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Committed baselines (`themes.spec.ts`), one set a platform: fonts and raster differ by OS.
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}-{platform}{ext}',
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
      use: { ...devices['Desktop Chrome'], launchOptions: { args: GPU_ARGS } },
      testMatch: PERF,
      dependencies: ['chromium'],
    },
  ],
  webServer: [
    {
      // The Vite build alone: the type check is `bun run check`'s, and needs a `tsc` on the PATH.
      command: 'bun run build:vite && bun run preview',
      url: PREVIEW,
      // Its `/api` goes to the seeded e2e Worker, not a `bun run dev` one on :8787.
      env: { API_ORIGIN: WORKER },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'bun run dev',
      url: `${DEV}/_gallery`,
      env: { API_ORIGIN: WORKER },
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
