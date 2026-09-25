/**
 * The three main routes (`/`, `/arena`, `/editor`) in all five themes, against the production build
 * and the seeded e2e Worker (PRODUCT_SPEC §11): each compared with its committed baseline in
 * `e2e/__snapshots__/themes.spec.ts/`, 0.2% of the pixels at most may differ. A first visit, under
 * reduced motion, so the home demo is a still and nothing moves. The main hill's standings and
 * matches come from `e2e/fixtures/` (the launch seed's, as other specs submit to the hill). What
 * changes from run to run is masked: the ticker (live feed, clock), the version stamp, every
 * canvas, the home demo (its bots and seed are random), and the next championship (a date).
 *
 * Baselines are per platform (`-darwin`, `-linux`): fonts and GPU raster differ between them. CI's
 * are the Playwright image's; make them with the command in the web README ("Screenshots").
 */
import { THEMES } from '@asmbots/ui/themes'
import { expect, type Page, test } from '@playwright/test'
import HILL from './fixtures/home-hill.json' with { type: 'json' }
import MATCHES from './fixtures/home-matches.json' with { type: 'json' }

const ROUTES = [
  ['home', '/'],
  ['arena', '/arena'],
  ['editor', '/editor'],
] as const

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })

/** What differs between two runs of the same build: the parts a screenshot hides. */
function volatile(page: Page) {
  return [
    page.getByRole('complementary', { name: 'ticker' }),
    page.locator('a[aria-label$=": the changelog"]'),
    page.locator('canvas'),
    // Home: the demo draws its bots and seed at random; the next championship is a date.
    page.getByRole('region', { name: 'live demo' }),
    page.getByRole('region', { name: 'championship' }),
  ]
}

/** Goes to `path` and waits for it to settle: its fonts in, nothing loading, a frame drawn. */
async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page).toHaveTitle(/^ASM BOTS/)
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  await expect(page.locator('[data-skeleton], [aria-label^="loading"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))))
}

for (const theme of THEMES) {
  for (const [name, path] of ROUTES) {
    test(`${name} · ${theme}`, async ({ page }) => {
      await page.addInitScript((stored) => localStorage.setItem('theme', stored), theme)
      // The main hill as the launch seed made it: other specs submit to it as they run.
      await page.route('**/api/hills/main', (route) => route.fulfill({ json: HILL }))
      await page.route('**/api/hills/main/matches?*', (route) => route.fulfill({ json: MATCHES }))
      await settle(page, path)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        maxDiffPixelRatio: 0.002,
        animations: 'disabled',
        caret: 'hide',
        mask: volatile(page),
      })
    })
  }
}
