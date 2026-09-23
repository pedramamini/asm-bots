/**
 * The arena's frame rate (PRODUCT_SPEC §11, DESIGN_SYSTEM §5): a 16-bot melee of roster bots at
 * 2,000 cycles a frame, every post effect on, through the whole path: the Worker, the frames, and
 * the WebGL2 renderer. It measures the gaps between display frames for 5 s and holds the 95th
 * percentile to 20 ms; the report carries the median. The page is `e2e/harness/arena.html` on the
 * dev server (DEV_URL, default http://localhost:5173).
 */
import { expect, test } from '@playwright/test'
import type { MountOptions } from './harness/arena'
import { rosterBots } from './roster'

test.use({ baseURL: process.env.DEV_URL ?? 'http://localhost:5173', colorScheme: 'dark' })

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

test('holds 60 fps with 16 bots at 2,000 cycles a frame', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const bots = rosterBots(SIXTEEN)
  const viewport: MountOptions = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.goto('/e2e/harness/arena.html')
  await page.waitForFunction(() => window.harness !== undefined)
  await page.evaluate((size) => window.harness.mount(size), viewport)

  const run = await page.evaluate(
    async ({ bots, speed, window: span }) => {
      const h = window.harness
      // A million cycles: the melee outlasts the window at this speed.
      await h.load(bots, { seed: 7, maxCycles: 1_000_000 })
      const kind = h.arena().renderer?.kind
      const alive = h.client.store.getState().alive
      h.client.speed(speed)
      h.client.play()
      // Let the first frames warm the JIT and the GPU up before counting.
      await new Promise((resolve) => setTimeout(resolve, 500))
      const startCycle = h.client.store.getState().cycle
      const gaps: number[] = []
      await new Promise<void>((resolve) => {
        let last = performance.now()
        const start = last
        const tick = (now: number) => {
          gaps.push(now - last)
          last = now
          if (now - start < span) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      const state = h.client.store.getState()
      return {
        kind,
        gaps,
        cycles: state.cycle - startCycle,
        aliveAtStart: alive,
        aliveAtEnd: state.alive,
        status: state.status,
      }
    },
    { bots, speed: SPEED, window: WINDOW_MS },
  )

  const gaps = [...run.gaps].sort((a, b) => a - b)
  const at = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] as number
  const p50 = at(0.5)
  const p95 = at(0.95)
  const summary = {
    renderer: run.kind,
    frames: gaps.length,
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    max: Number((gaps[gaps.length - 1] as number).toFixed(2)),
    cyclesPerFrame: Math.round(run.cycles / gaps.length),
    aliveAtStart: run.aliveAtStart,
    aliveAtEnd: run.aliveAtEnd,
    viewport,
  }
  testInfo.annotations.push(
    { type: 'p50', description: `${summary.p50} ms` },
    { type: 'p95', description: `${summary.p95} ms (limit ${P95_LIMIT_MS})` },
    { type: 'cycles per frame', description: String(summary.cyclesPerFrame) },
  )
  await testInfo.attach('frame-times', {
    body: JSON.stringify({ ...summary, gaps: run.gaps }, null, 2),
    contentType: 'application/json',
  })
  console.log(`arena perf: ${JSON.stringify(summary)}`)

  expect(run.kind).toBe('webgl2')
  expect(run.aliveAtStart).toBe(16)
  expect(run.status).toBe('playing')
  // The Worker keeps up: most frames run their 2,000 cycles.
  expect(summary.cyclesPerFrame).toBeGreaterThan(SPEED / 2)
  expect(p95).toBeLessThanOrEqual(P95_LIMIT_MS)
  expect(errors).toEqual([])
})
