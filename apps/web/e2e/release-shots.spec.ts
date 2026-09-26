/**
 * A release's screenshots and melee recording (EXEC 4.2 task 4), from the production build and the
 * seeded e2e Worker: the arena mid-melee in all seven themes, the editor's debugger, a local bracket,
 * and the main hill (`<name>.png`, 1600 × 960), and 22 s of an eight-bot melee (`melee.webm`, 1280
 * × 720, Playwright's video, trimmed with ffmpeg by the release). They go in the directory
 * `RELEASE_SHOTS` names, as the release's assets, not in the repository:
 *
 *   RELEASE_SHOTS=/tmp/release bunx playwright test e2e/release-shots.spec.ts --workers 1
 */
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES } from '@asmbots/ui/themes'
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'
import HILL from './fixtures/home-hill.json' with { type: 'json' }
import MATCHES from './fixtures/home-matches.json' with { type: 'json' }

const OUT = process.env.RELEASE_SHOTS ?? ''
const MELEE = [
  'imp-ring',
  'dwarf',
  'stone',
  'paper',
  'scanner',
  'silk',
  'vampire',
  'painter-spiral',
]
const MELEE_URL = `/arena?b=${MELEE.map((b) => `roster:${b}`).join(',')}&seed=6`

test.skip(!OUT, 'set RELEASE_SHOTS=<dir> to take the release screenshots')
test.use({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 })

// The tours seen: their coach marks would stand over the panels.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'asmbots:settings',
      JSON.stringify({ state: { coachMarksSeen: ['arena', 'editor'] }, version: 1 }),
    ),
  )
})

async function shoot(page: Page, name: string) {
  await page.mouse.move(0, 0)
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' })
}

/** The arena's cycle, from its HUD chip `cycle 12,480 / 100,000`. */
async function cycle(page: Page): Promise<number> {
  const text = await page
    .getByText(/^cycle [\d,]+ \/ [\d,]+$/)
    .first()
    .textContent()
  return Number((text ?? '').replace(/^cycle ([\d,]+).*$/, '$1').replace(/,/g, ''))
}

async function fight(page: Page) {
  await page.goto(MELEE_URL)
  await page.locator('button[name="fight"]').click()
  await expect(page.getByRole('application', { name: 'arena' })).toBeVisible()
}

for (const theme of THEMES) {
  test(`the arena mid-melee · ${theme}`, async ({ page }) => {
    await page.addInitScript((stored) => localStorage.setItem('theme', stored), theme)
    await fight(page)
    await expect
      .poll(() => cycle(page), { timeout: 30_000, intervals: [100] })
      .toBeGreaterThan(12_000)
    await page.getByRole('button', { name: 'pause' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await shoot(page, `arena-${theme}`)
  })
}

test.describe('in the default theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'sentinel'))
  })

  test('the editor and the debugger on the imp', async ({ page }) => {
    await page.goto('/docs/start-here')
    await page
      .getByRole('figure', { name: 'Imp · x16c code' })
      .getByRole('link', { name: 'open in editor' })
      .click()
    await expect(page).toHaveTitle('ASM BOTS // EDITOR')
    const tip = page.getByRole('note', { name: 'tip' })
    if (await tip.isVisible()) await tip.getByRole('button', { name: 'got it' }).click()
    await expect(page.getByRole('region', { name: 'registers' })).toBeVisible()
    for (let k = 0; k < 6; k++) await page.keyboard.press('F11')
    await shoot(page, 'editor')
  })

  test('a bracket of eight roster bots', async ({ page }) => {
    await page.goto('/tournaments')
    await page.getByRole('button', { name: 'new tournament' }).first().click()
    const form = page.getByRole('dialog', { name: 'new tournament' })
    await form.getByRole('textbox', { name: 'name' }).fill('imp gate cup')
    await form.getByRole('radio', { name: 'bracket' }).click()
    for (const name of [
      'Imp',
      'Dwarf',
      'Stone',
      'Paper',
      'Scanner',
      'Silk',
      'Vampire',
      'Imp Ring',
    ]) {
      await form.getByRole('checkbox', { name, exact: true }).check()
    }
    await form.locator('button[name="create"]').click()
    const card = page.getByRole('listitem', { name: 'imp gate cup' })
    await expect(card).toContainText('finished', { timeout: 120_000 })
    await card.getByRole('link').click()
    await expect(
      page.getByRole('region', { name: 'bracket' }).last().locator('[data-champion]'),
    ).toHaveCount(1)
    await shoot(page, 'bracket')
  })

  test.describe('the main hill', () => {
    test.use({ baseURL: WORKER })

    test('its board and feed', async ({ page }) => {
      // The launch seed's board: other specs submit to the hill.
      await page.route('**/api/hills/main', (route) => route.fulfill({ json: HILL }))
      await page.route('**/api/hills/main/matches?*', (route) => route.fulfill({ json: MATCHES }))
      await page.goto('/hills/main')
      await expect(page).toHaveTitle(/^ASM BOTS/)
      await expect(page.locator('[data-skeleton], [aria-label^="loading"]')).toHaveCount(0)
      await page.evaluate(() => document.fonts.ready)
      await shoot(page, 'hill')
    })
  })

  test('22 seconds of an eight-bot melee', async ({ browser, baseURL }, info) => {
    test.setTimeout(60_000)
    const size = { width: 1280, height: 720 }
    const context = await browser.newContext({
      baseURL,
      viewport: size,
      recordVideo: { dir: info.outputDir, size },
    })
    const page = await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'sentinel')
      localStorage.setItem(
        'asmbots:settings',
        JSON.stringify({ state: { coachMarksSeen: ['arena', 'editor'] }, version: 1 }),
      )
    })
    await fight(page)
    await page.waitForTimeout(22_000)
    const video = page.video()
    await context.close()
    if (video) copyFileSync(await video.path(), join(OUT, 'melee.webm'))
  })
})
