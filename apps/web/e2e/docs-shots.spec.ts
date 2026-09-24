/**
 * The start page's tour screenshots (EXEC 2.6 task 3), taken from the production build:
 * `public/docs-shots/tour-*.webp`, 1280 × 800 in the default theme. It runs only when asked, since
 * each run rewrites the files:
 *
 *   DOCS_SHOTS=1 bunx playwright test e2e/docs-shots.spec.ts
 *
 * Needs `cwebp` (libwebp) on the PATH.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const OUT = new URL('../public/docs-shots/', import.meta.url).pathname
const TMP = mkdtempSync(join(tmpdir(), 'docs-shots-'))

test.skip(!process.env.DOCS_SHOTS, 'set DOCS_SHOTS=1 to take the docs screenshots')
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

// The default theme: Playwright's light color scheme would pick paper.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'sentinel'))
})

/** Saves the page as `public/docs-shots/<name>.webp`. */
async function shoot(page: Page, name: string) {
  const png = join(TMP, `${name}.png`)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: png, animations: 'disabled' })
  execFileSync('cwebp', ['-quiet', '-q', '80', png, '-o', `${OUT}${name}.webp`])
}

/** The arena's cycle, from its HUD chip `cycle 12,480 / 100,000`. */
async function cycle(page: Page): Promise<number> {
  const text = await page
    .getByText(/^cycle [\d,]+ \/ [\d,]+$/)
    .first()
    .textContent()
  return Number((text ?? '').replace(/^cycle ([\d,]+).*$/, '$1').replace(/,/g, ''))
}

test('the arena mid-battle', async ({ page }) => {
  // At seed 6 all four live to cycle 26,525; the default speed, 100 a frame, stops near 12,000.
  await page.goto('/arena?b=roster:imp-ring,roster:stone,roster:scanner,roster:silk&seed=6')
  await page.locator('button[name="fight"]').click()
  await expect(page.getByRole('application', { name: 'arena' })).toBeVisible()
  await expect
    .poll(() => cycle(page), { timeout: 30_000, intervals: [100] })
    .toBeGreaterThan(12_000)
  await page.getByRole('button', { name: 'pause' }).click()
  await shoot(page, 'tour-arena')
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
  // Through the setup: bx holds the base, and the first copy is made.
  for (let k = 0; k < 6; k++) await page.keyboard.press('F11')
  await shoot(page, 'tour-editor')
})

test('a bracket of eight roster bots', async ({ page }) => {
  await page.goto('/tournaments')
  await page.getByRole('button', { name: 'new tournament' }).first().click()
  const form = page.getByRole('dialog', { name: 'new tournament' })
  await form.getByRole('textbox', { name: 'name' }).fill('spring cup')
  await form.getByRole('radio', { name: 'bracket' }).click()
  for (const name of ['Imp', 'Dwarf', 'Stone', 'Paper', 'Scanner', 'Silk', 'Vampire', 'Imp Ring']) {
    await form.getByRole('checkbox', { name, exact: true }).check()
  }
  await form.locator('button[name="create"]').click()
  const card = page.getByRole('listitem', { name: 'spring cup' })
  await expect(card).toContainText('finished', { timeout: 120_000 })
  await card.getByRole('link').click()
  const bracket = page.getByRole('region', { name: 'bracket' }).last()
  await expect(bracket.locator('[data-champion]')).toHaveCount(1)
  await shoot(page, 'tour-tournament')
})
