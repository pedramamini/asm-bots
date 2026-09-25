/**
 * Memory over a long autoplay (web README "Budgets"): the production build's battle page
 * (PREVIEW_URL, default http://localhost:4173) plays a 16-bot melee of 10 rounds at 2,000 cycles a
 * frame with autoplay on, and a rematch at each match's end, for SOAK_MINUTES (10). At the first
 * match's end and at the last one's it collects the garbage and reads the heaps as a heap snapshot
 * counts them: the page's (JS, and the DOM's) and the arena Worker's. The last may hold at most
 * 20 MB more than the first. Both reads are at a match's end, so the Worker holds its full set of
 * keyframes each time (128, ~17 MB), not a set half filled. Opt-in, `SOAK=1`: it takes the whole
 * run. `SOAK_MINUTES=2` makes a short one. It runs in the perf project, alone:
 * `SOAK=1 bunx playwright test --project perf --no-deps e2e/arena-soak.spec.ts`.
 */
import { type Browser, type CDPSession, expect, type Page, test } from '@playwright/test'

const PREVIEW = process.env.PREVIEW_URL ?? 'http://localhost:4173'
const MINUTES = Number(process.env.SOAK_MINUTES ?? 10)
const GROWTH_LIMIT_MB = 20
const MB = 1024 * 1024

/** The perf spec's melee, in a match of 10 rounds of 300,000 cycles (`melee 16`'s). */
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

/**
 * The heaps after a collection, bytes: the page's JS and DOM, and the arena Worker's JS. JS counts
 * the typed arrays' buffers too (the frames, the keyframes), as a heap snapshot does.
 */
interface Heaps {
  readonly page: number
  readonly dom: number
  readonly worker: number
}

/**
 * `Runtime.getHeapUsage` of the target a CDP message goes to: its JS heap, its ArrayBuffers'
 * backing stores (kept apart from the heap), and the embedder's (Blink's DOM) heap.
 */
interface HeapUsage {
  readonly usedSize: number
  readonly backingStorageSize?: number
  readonly embedderHeapUsedSize?: number
}

/** A target's JS, with its buffers. */
const js = (usage: HeapUsage | undefined) =>
  (usage?.usedSize ?? 0) + (usage?.backingStorageSize ?? 0)

/**
 * Sends `method` to the arena Worker, through the browser's session: Playwright gives a Worker no
 * session of its own. The Worker's target is attached for the call and detached after.
 */
async function toWorker<T>(browser: CDPSession, methods: readonly string[]): Promise<T[]> {
  const { targetInfos } = (await browser.send('Target.getTargets')) as {
    targetInfos: { targetId: string; type: string; url: string }[]
  }
  const target = targetInfos.find((t) => t.type === 'worker' && t.url.includes('arena.worker'))
  if (target === undefined) throw new Error('no arena Worker to read')
  const { sessionId } = (await browser.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  })) as { sessionId: string }
  const waiting = new Map<number, (result: T) => void>()
  const onMessage = (event: { sessionId: string; message: string }) => {
    const reply = JSON.parse(event.message) as { id: number; result: T }
    if (event.sessionId === sessionId) waiting.get(reply.id)?.(reply.result)
  }
  browser.on('Target.receivedMessageFromTarget', onMessage)
  try {
    const results: T[] = []
    for (const [i, method] of methods.entries()) {
      const id = i + 1
      const replied = new Promise<T>((resolve) => waiting.set(id, resolve))
      await browser.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params: {} }),
      })
      results.push(await replied)
    }
    return results
  } finally {
    browser.off('Target.receivedMessageFromTarget', onMessage)
    await browser.send('Target.detachFromTarget', { sessionId })
  }
}

/** Collects the garbage in the page and the Worker, and reads what is left. */
async function heaps(page: CDPSession, browser: CDPSession): Promise<Heaps> {
  await page.send('HeapProfiler.collectGarbage')
  const own = (await page.send('Runtime.getHeapUsage')) as HeapUsage
  const [, worker] = await toWorker<HeapUsage>(browser, [
    'HeapProfiler.collectGarbage',
    'Runtime.getHeapUsage',
  ])
  return { page: js(own), dom: own.embedderHeapUsedSize ?? 0, worker: js(worker) }
}

const mb = (bytes: number) => Number((bytes / MB).toFixed(2))

/** Waits for the match's end: the victory overlay's `rematch`. */
async function matchEnd(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'rematch' })).toBeVisible({ timeout: 5 * 60_000 })
}

test('holds its memory over a 10-minute autoplay', async ({ page, browser }, testInfo) => {
  test.skip(process.env.SOAK === undefined, 'a run of SOAK_MINUTES (10): set SOAK=1')
  test.setTimeout((MINUTES + 6) * 60_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      'asmbots:settings',
      JSON.stringify({ state: { theme: 'sentinel', coachMarksSeen: ['arena'] }, version: 1 }),
    )
  })
  const bots = SIXTEEN.map((slug) => `roster:${slug}`).join(',')
  await page.goto(`${PREVIEW}/arena?b=${bots}&seed=7&cycles=300000&rounds=10`)
  await page.locator('button[name="fight"]').click()
  await expect(page.getByRole('application', { name: 'arena' })).toBeVisible()
  for (let step = 0; step < 4; step++) await page.keyboard.press(']')
  await expect(page.getByRole('slider', { name: 'speed' })).toHaveAttribute(
    'aria-valuetext',
    '2,000/f',
  )
  await page.getByRole('button', { name: 'autoplay' }).click()
  await expect(page.getByRole('button', { name: 'autoplay' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const pageSession = await page.context().newCDPSession(page)
  const browserSession = await (browser as Browser).newBrowserCDPSession()
  const started = Date.now()
  await matchEnd(page)
  const first = await heaps(pageSession, browserSession)
  let matches = 1
  while (Date.now() - started < MINUTES * 60_000) {
    await page.getByRole('button', { name: 'rematch' }).click()
    await expect(page.getByRole('button', { name: 'rematch' })).toBeHidden()
    await matchEnd(page)
    matches++
  }
  const last = await heaps(pageSession, browserSession)

  const growth = {
    page: last.page - first.page,
    dom: last.dom - first.dom,
    worker: last.worker - first.worker,
  }
  const total = growth.page + growth.dom + growth.worker
  const summary = {
    minutes: Number(((Date.now() - started) / 60_000).toFixed(1)),
    matches,
    rounds: matches * 10,
    firstMb: { page: mb(first.page), dom: mb(first.dom), worker: mb(first.worker) },
    lastMb: { page: mb(last.page), dom: mb(last.dom), worker: mb(last.worker) },
    growthMb: { page: mb(growth.page), dom: mb(growth.dom), worker: mb(growth.worker) },
    totalGrowthMb: mb(total),
  }
  testInfo.annotations.push({
    type: 'heap growth',
    description: `${mb(total)} MB over ${summary.minutes} min, ${matches} matches (limit ${GROWTH_LIMIT_MB} MB)`,
  })
  await testInfo.attach('soak.json', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  })
  console.log(`arena soak: ${JSON.stringify(summary)}`)
  expect(total).toBeLessThan(GROWTH_LIMIT_MB * MB)
  expect(errors).toEqual([])
})
