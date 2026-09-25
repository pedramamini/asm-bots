/**
 * Reduced motion in Chromium (DESIGN_SYSTEM §8), against the production build: the system's
 * `prefers-reduced-motion`, or the app's own setting over it (`/settings`: reduce, full), stills
 * the ticker's marquee and the coach marks' slide, as it stills the arena's ripples and pulses
 * (`arena-canvas.test.tsx`). A narrow window makes the ticker's line wider than its bar.
 */
import { expect, type Page, test } from '@playwright/test'

test.use({ viewport: { width: 420, height: 800 } })

/** A first visit (the arena's tour shows) with the motion setting `motion`, or none. */
async function visit(page: Page, motion?: 'reduce' | 'full'): Promise<void> {
  await page.addInitScript((setting) => {
    if (setting !== null) {
      localStorage.setItem(
        'asmbots:settings',
        JSON.stringify({ state: { motion: setting }, version: 1 }),
      )
    }
  }, motion ?? null)
  await page.goto('/arena')
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
  await expect(page.locator('[data-coach="arena-roster"]')).toBeVisible()
}

/** Whether the ticker's line scrolls: a running `marquee` animation on the page. */
function marquee(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .some((a) => (a as CSSAnimation).animationName === 'marquee' && a.playState === 'running'),
  )
}

/** The coach mark's transition: `none` when it appears in place. */
function coachTransition(page: Page): Promise<string> {
  return page
    .locator('[data-coach="arena-roster"]')
    .evaluate((el) => getComputedStyle(el).transitionProperty)
}

test('full motion: the ticker scrolls and the coach mark slides in', async ({ page }) => {
  await visit(page)
  await expect.poll(() => marquee(page)).toBe(true)
  expect(await coachTransition(page)).not.toBe('none')
  expect(await page.locator('html').getAttribute('data-motion')).toBeNull()
})

test("the system's reduced motion stills both", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await visit(page)
  expect(await marquee(page)).toBe(false)
  expect(await coachTransition(page)).toBe('none')
  await context.close()
})

test("the app's reduce stills both where the system asks for none", async ({ page }) => {
  await visit(page, 'reduce')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce')
  expect(await marquee(page)).toBe(false)
  expect(await coachTransition(page)).toBe('none')
})

test("the app's full moves both where the system asks to reduce", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await visit(page, 'full')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await expect.poll(() => marquee(page)).toBe(true)
  expect(await coachTransition(page)).not.toBe('none')
  await context.close()
})
