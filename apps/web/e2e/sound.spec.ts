/**
 * The arena's sound in Chromium, against the production build (DESIGN_SYSTEM §7): a replay that
 * plays by itself makes no AudioContext before the page's first gesture, even with sound stored
 * on; `m` turns sound on in a battle, whose cues then start sources, and off again; the settings
 * page plays what it turns on; the home demo stays silent. An init script counts the contexts
 * made and the sources started.
 *
 * Playwright's `goto` gives the page a user activation (`navigator.userActivation` says so at
 * once), which a person's fresh page does not have: `freshPage` takes it away again, so the first
 * gesture is the spec's own.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

interface AudioCount {
  contexts: number
  sources: number
}

/** Counts, in `window.__audio`, each AudioContext made and each oscillator or buffer started. */
async function countAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const count = { contexts: 0, sources: 0 }
    ;(window as unknown as { __audio: AudioCount }).__audio = count
    const Real = window.AudioContext
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options)
        count.contexts++
      }
    }
    for (const proto of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = proto.start as (...args: number[]) => void
      proto.start = function (this: AudioScheduledSourceNode, ...args: number[]) {
        count.sources++
        start.apply(this, args)
      }
    }
  })
}

const audio = (page: Page): Promise<AudioCount> =>
  page.evaluate(() => ({ ...(window as unknown as { __audio: AudioCount }).__audio }))

/** The page reports no user activation, as a page a person just opened does. */
async function freshPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userActivation', {
      get: () => ({ hasBeenActive: false, isActive: false }),
    })
  })
}

/** Sound on in the stored settings, before the page's scripts run. */
async function storeSoundOn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { sound: { on: true, volume: 0.5 } }
    localStorage.setItem('asmbots:settings', JSON.stringify({ state, version: 1 }))
  })
}

/** The page's errors, and whatever the console says of audio (Chrome's autoplay warnings). */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/audio/i.test(message.text())) errors.push(message.text())
  })
  return errors
}

/** A click in the header's corner: a gesture that does nothing else. */
const gesture = (page: Page) =>
  page
    .locator('header')
    .first()
    .click({ position: { x: 8, y: 8 } })
const victory = (page: Page) => page.locator('section[data-result-hash]')
const soundButton = (page: Page) =>
  page.getByRole('toolbar', { name: 'arena view' }).getByRole('button', { name: 'sound' })
/** The cycle the HUD shows. */
const hudCycle = async (page: Page) =>
  Number(
    ((await page.getByRole('application', { name: 'arena' }).textContent()) ?? '')
      .match(/cycle ([\d,]+) \//)?.[1]
      ?.replace(/,/g, '') ?? Number.NaN,
  )

/** Two imps, which never die: a battle that runs to its cycle cap. Its `replay link`. */
async function impsReplay(context: BrowserContext): Promise<string> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  await page.goto('/arena?b=roster:imp,roster:imp&seed=1')
  await page.locator('button[name="fight"]').click()
  await page.getByRole('button', { name: 'max speed' }).click()
  await expect(victory(page)).toBeVisible({ timeout: 30_000 })
  await victory(page).getByRole('button', { name: 'replay link' }).click()
  await expect(page.getByText('replay link copied.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  await page.close()
  return link
}

test('a replay plays silent until the page’s first gesture, even with sound on', async ({
  context,
}) => {
  const link = await impsReplay(context)
  const page = await context.newPage()
  const errors = watch(page)
  await countAudio(page)
  await freshPage(page)
  await storeSoundOn(page)
  await page.goto(link)
  await expect(soundButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => hudCycle(page)).toBeGreaterThan(500)
  expect(await audio(page)).toEqual({ contexts: 0, sources: 0 })
  await gesture(page)
  await expect.poll(async () => (await audio(page)).sources).toBeGreaterThan(0)
  expect((await audio(page)).contexts).toBe(1)
  expect(errors).toEqual([])
})

test('m turns sound on in a battle, and off again', async ({ page }) => {
  const errors = watch(page)
  await countAudio(page)
  await page.goto('/arena?b=roster:imp,roster:imp&seed=1')
  await page.locator('button[name="fight"]').click()
  await expect.poll(() => hudCycle(page)).toBeGreaterThan(0)
  await expect(soundButton(page)).toHaveAttribute('aria-pressed', 'false')
  expect(await audio(page)).toEqual({ contexts: 0, sources: 0 })
  await page.keyboard.press('m')
  await expect(soundButton(page)).toHaveAttribute('aria-pressed', 'true')
  // The click that says sound is on, then the writes' clicks.
  await expect.poll(async () => (await audio(page)).sources).toBeGreaterThan(3)
  await page.keyboard.press('m')
  await expect(soundButton(page)).toHaveAttribute('aria-pressed', 'false')
  const off = await audio(page)
  await page.waitForTimeout(600)
  expect(await audio(page)).toEqual(off)
  expect(off.contexts).toBe(1)
  const stored = await page.evaluate(() => localStorage.getItem('asmbots:settings'))
  expect(JSON.parse(stored ?? '{}').state.sound.on).toBe(false)
  expect(errors).toEqual([])
})

test('the settings page plays the click it turns on, and each cue it turns on', async ({
  page,
}) => {
  await countAudio(page)
  await page.goto('/settings')
  const panel = page.getByRole('region', { name: 'sound' })
  await panel.getByRole('button', { name: 'sound', exact: true }).click()
  await expect.poll(async () => (await audio(page)).sources).toBe(1)
  const victoryCue = panel.getByRole('button', { name: 'victory' })
  await victoryCue.click()
  await expect(victoryCue).toHaveAttribute('aria-pressed', 'false')
  await victoryCue.click()
  // Its three notes.
  await expect.poll(async () => (await audio(page)).sources).toBe(4)
  expect((await audio(page)).contexts).toBe(1)
})

test('the home demo makes no sound, even with sound on', async ({ page }) => {
  await countAudio(page)
  await storeSoundOn(page)
  await page.goto('/')
  await expect(page.locator('[data-demo="live"]')).toBeVisible()
  await gesture(page)
  await page.waitForTimeout(1500)
  expect(await audio(page)).toEqual({ contexts: 0, sources: 0 })
})
