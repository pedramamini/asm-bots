/**
 * The arena's runtime budgets (web README "Budgets", PRODUCT_SPEC §11, DESIGN_SYSTEM §5): a
 * 16-bot melee of roster bots at 2,000 cycles a frame, every post effect on, holds 60 fps (the
 * 95th percentile of the gaps between display frames at most 20 ms, over 5 s), and a frame's trip
 * from the Worker to the page (the `arena:frame-transfer` measure, `TRANSFER_MEASURE` in
 * `worker/client.ts`) stays under 1 ms at the 95th percentile. First the arena alone
 * (`e2e/harness/arena.html` on the dev server, DEV_URL, default http://localhost:5173), then the
 * whole battle page of the production build (PREVIEW_URL, default http://localhost:4173): HUD,
 * rail, sparklines, log. The report carries the medians and the worst.
 *
 * The trip is held where the GL is a GPU's (the perf project asks for Metal on a Mac). Under
 * SwiftShader, software GL, the page's thread waits on each image's texture uploads for ~10 ms, and
 * a frame that lands meanwhile waits too; the test reports that trip and says why it is not held.
 */
import { expect, type Page, type TestInfo, test } from '@playwright/test'
import type { MountOptions } from './harness/arena'
import { rosterBots } from './roster'

test.use({ baseURL: process.env.DEV_URL ?? 'http://localhost:5173', colorScheme: 'dark' })

const PREVIEW = process.env.PREVIEW_URL ?? 'http://localhost:4173'

/** The 14 fighting roster bots, and the two painters again: the busiest writers. */
const SIXTEEN = [
  'imp',
  'imp-ring',
  'dwarf',
  'dwarf-wide',
  'gate',
  'decoy',
  'stone',
  'paper',
  'silk',
  'scanner',
  'hybrid',
  'vampire',
  'painter-lcg',
  'painter-spiral',
  'painter-lcg',
  'painter-spiral',
]

const SPEED = 2000
const WINDOW_MS = 5000
const P95_LIMIT_MS = 20
const TRANSFER_P95_LIMIT_MS = 1
const TRANSFER_MEASURE = 'arena:frame-transfer'

/** What a window of play measured: display frame gaps and frame trips, ms. */
interface Played {
  readonly gaps: number[]
  readonly transfers: number[]
}

/**
 * Counts the gaps between display frames for `span` ms, and each frame's trip from the Worker as
 * the page measures it: in the page, from a `PerformanceObserver` and `requestAnimationFrame`.
 */
function playWindow(page: Page, span: number): Promise<Played> {
  return page.evaluate(
    ({ span, name }) =>
      new Promise<Played>((resolve) => {
        const transfers: number[] = []
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntriesByName(name)) transfers.push(entry.duration)
        })
        observer.observe({ type: 'measure' })
        const gaps: number[] = []
        let last = performance.now()
        const start = last
        const tick = (now: number) => {
          gaps.push(now - last)
          last = now
          if (now - start < span) requestAnimationFrame(tick)
          else {
            observer.disconnect()
            resolve({ gaps, transfers })
          }
        }
        requestAnimationFrame(tick)
      }),
    { span, name: TRANSFER_MEASURE },
  )
}

/** The `p` quantile of `values`, and its median and worst, ms, two decimals. */
function stats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) =>
    Number((sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN).toFixed(2))
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) }
}

/** The page's WebGL renderer, as the driver names it: `SwiftShader` is software GL. */
function glRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'none'
  })
}

/**
 * Reports a window and holds it to the budgets: 60 fps, and, on a GPU's GL, frames under 1 ms in
 * transit.
 */
async function judge(testInfo: TestInfo, label: string, played: Played, gl: string, extra: object) {
  const frames = stats(played.gaps)
  const transfer = stats(played.transfers)
  const software = /swiftshader/i.test(gl)
  const summary = { gl, frames, transfer, ...extra }
  testInfo.annotations.push(
    { type: 'frame gap p50', description: `${frames.p50} ms` },
    { type: 'frame gap p95', description: `${frames.p95} ms (limit ${P95_LIMIT_MS})` },
    {
      type: 'transfer p95',
      description: `${transfer.p95} ms (limit ${TRANSFER_P95_LIMIT_MS}), max ${transfer.max} ms`,
    },
  )
  await testInfo.attach(`${label}.json`, {
    body: JSON.stringify({ ...summary, gaps: played.gaps, transfers: played.transfers }, null, 2),
    contentType: 'application/json',
  })
  console.log(`${label}: ${JSON.stringify(summary)}`)
  expect(frames.p95).toBeLessThanOrEqual(P95_LIMIT_MS)
  // Most frames carry a trip: the Worker answers each display frame.
  expect(transfer.count).toBeGreaterThan(frames.count / 2)
  if (software) {
    testInfo.annotations.push({
      type: 'transfer not held',
      description: `software GL (${gl}): a frame waits while the page's thread uploads textures`,
    })
    return
  }
  expect(transfer.p95).toBeLessThan(TRANSFER_P95_LIMIT_MS)
}

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('holds 60 fps with 16 bots at 2,000 cycles a frame', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const errors = watch(page)
  const bots = rosterBots(SIXTEEN)
  const viewport: MountOptions = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.goto('/e2e/harness/arena.html')
  await page.waitForFunction(() => window.harness !== undefined)
  await page.evaluate((size) => window.harness.mount(size), viewport)

  const setup = await page.evaluate(
    async ({ bots, speed }) => {
      const h = window.harness
      // A million cycles: the melee outlasts the window at this speed.
      await h.load(bots, { seed: 7, maxCycles: 1_000_000 })
      const kind = h.arena().renderer?.kind
      const alive = h.client.store.getState().alive
      h.client.speed(speed)
      h.client.play()
      // Let the first frames warm the JIT and the GPU up before counting.
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { kind, alive, cycle: h.client.store.getState().cycle }
    },
    { bots, speed: SPEED },
  )
  const played = await playWindow(page, WINDOW_MS)
  const after = await page.evaluate(() => window.harness.client.store.getState())
  const cyclesPerFrame = Math.round((after.cycle - setup.cycle) / played.gaps.length)

  expect(setup.kind).toBe('webgl2')
  expect(setup.alive).toBe(16)
  expect(after.status).toBe('playing')
  // The Worker keeps up: most frames run their 2,000 cycles.
  expect(cyclesPerFrame).toBeGreaterThan(SPEED / 2)
  await judge(testInfo, 'arena perf', played, await glRenderer(page), {
    renderer: setup.kind,
    cyclesPerFrame,
    viewport,
  })
  expect(errors).toEqual([])
})

test('the battle page holds 60 fps with 16 bots at 2,000 cycles a frame', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors = watch(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'asmbots:settings',
      JSON.stringify({ state: { theme: 'sentinel', coachMarksSeen: ['arena'] }, version: 1 }),
    )
  })
  const bots = SIXTEEN.map((slug) => `roster:${slug}`).join(',')
  // The arena test's melee: seed 7 and a million cycles, which all 16 outlast the window in.
  await page.goto(`${PREVIEW}/arena?b=${bots}&seed=7&cycles=1000000`)
  await page.locator('button[name="fight"]').click()
  const arena = page.getByRole('application', { name: 'arena' })
  await expect(arena).toBeVisible()
  // `]` four times: 100, 200, 500, 1,000, 2,000 cycles a frame.
  const speed = page.getByRole('slider', { name: 'speed' })
  for (let step = 0; step < 4; step++) await page.keyboard.press(']')
  await expect(speed).toHaveAttribute('aria-valuetext', '2,000/f')
  await expect(page.getByRole('button', { name: 'pause' })).toBeVisible()
  await page.waitForTimeout(500)

  const scrub = page.getByRole('slider', { name: 'cycle' })
  const before = Number(await scrub.inputValue())
  const played = await playWindow(page, WINDOW_MS)
  const cycles = Number(await scrub.inputValue()) - before
  const cyclesPerFrame = Math.round(cycles / played.gaps.length)

  await expect(page.getByRole('button', { name: 'pause' })).toBeVisible()
  expect(cyclesPerFrame).toBeGreaterThan(SPEED / 2)
  await judge(testInfo, 'battle page perf', played, await glRenderer(page), {
    cyclesPerFrame,
    viewport: page.viewportSize(),
  })
  expect(errors).toEqual([])
})
