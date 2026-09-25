/**
 * Onboarding in Chromium, against the production build (PRODUCT_SPEC §9): the arena's first-visit
 * tour (roster → fight → watch, then never again), the home page's intro (Dwarf vs Imp at 200 cycles a
 * frame, first blood pointed out on the events log, then the setup), and the status bar's offline
 * banner over an arena that fights on.
 */
import { expect, type Page, test } from '@playwright/test'

/** A coach mark by its `data-coach`. */
const mark = (page: Page, name: string) => page.locator(`[data-coach="${name}"]`)
const fightButton = (page: Page) => page.locator('button[name="fight"]')
const picked = (page: Page) => page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('the arena tour: roster, then fight, then watch, and never again', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/arena')
  const roster = mark(page, 'arena-roster')
  await expect(roster).toContainText('1/3')
  const cards = page.getByRole('list', { name: 'bots to add' }).getByRole('listitem')
  // It hangs under the first card's +, and stays in view.
  await expect(cards.nth(0).locator('[data-coach="arena-roster"]')).toBeInViewport()
  await cards.nth(0).getByRole('button', { name: /^add / }).click()
  await cards.nth(1).getByRole('button', { name: /^add / }).click()
  await expect(roster).toBeHidden()
  const fight = mark(page, 'arena-fight')
  await expect(fight).toContainText('2/3')
  await expect(fight).toBeInViewport()
  await fightButton(page).click()
  const events = page.getByRole('region', { name: 'events' })
  await expect(events.locator('[data-coach="arena-watch"]')).toContainText('3/3')
  await page.getByRole('region', { name: 'arena' }).getByRole('button', { name: 'setup' }).click()
  await expect(page.locator('[data-coach]')).toHaveCount(0)
  // Done for good: a reload, and a fight, show none.
  await page.reload()
  await expect(fightButton(page)).toBeEnabled()
  await fightButton(page).click()
  await expect(page.getByRole('region', { name: 'events' })).toBeVisible()
  await expect(page.locator('[data-coach]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('skip the tour puts it away at once', async ({ page }) => {
  await page.goto('/arena')
  await mark(page, 'arena-roster').getByRole('button', { name: 'skip the tour' }).click()
  await expect(page.locator('[data-coach]')).toHaveCount(0)
  await page.getByRole('button', { name: /try dwarf vs paper/ }).click()
  await expect(fightButton(page)).toBeEnabled()
  await expect(page.locator('[data-coach]')).toHaveCount(0)
})

test('the intro plays Dwarf vs Imp at 200 a frame and points at first blood', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'watch the intro fight' }).click()
  // The setup it runs is in the URL, so a reload keeps the bots.
  await expect(page).toHaveURL(/\/arena\?b=roster:dwarf,roster:imp&seed=263&cycles=100000&/)
  const bots = mark(page, 'intro-bots')
  await expect(bots).toContainText('intro 1/3')
  await expect(bots).toBeInViewport()
  const arena = page.getByRole('application', { name: 'arena' })
  await expect(arena).toContainText('200/f')
  await expect(arena).toContainText('cycle 0 /')
  await bots.getByRole('button', { name: 'play now' }).click()
  // Dwarf's bomb lands on Imp's next word at cycle 55,602: about 5 s at 60 fps.
  const blood = page.getByRole('region', { name: 'events' }).locator('[data-coach="intro-blood"]')
  await expect(blood).toContainText('first blood at cycle 55,602: Dwarf’s bomb hit Imp.', {
    timeout: 30_000,
  })
  await expect(bots).toBeHidden()
  await expect(page.getByRole('region', { name: 'events' })).toContainText(
    'first blood · Dwarf → Imp',
  )
  await blood.getByRole('button', { name: 'next' }).click()
  const yours = mark(page, 'intro-yours')
  await expect(yours).toContainText('your turn')
  await yours.getByRole('button', { name: 'pick bots' }).click()
  await expect(picked(page)).toHaveText([/Dwarf/, /Imp/])
  // The tour takes over from the intro: the bots are in, so its fight step.
  await expect(mark(page, 'arena-fight')).toContainText('2/3')
  expect(errors).toEqual([])
})

test('the intro plays by itself after its hold', async ({ page }) => {
  await page.goto('/arena?intro=true')
  const arena = page.getByRole('application', { name: 'arena' })
  await expect(mark(page, 'intro-bots')).toBeVisible()
  await expect(arena).toContainText('cycle 0 /')
  await expect(arena).not.toContainText('cycle 0 /', { timeout: 15_000 })
})

test('offline, the status bar says so and what still works, and the arena fights on', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const state = { coachMarksSeen: ['arena'] }
    localStorage.setItem('asmbots:settings', JSON.stringify({ state, version: 1 }))
  })
  await page.goto('/arena?b=roster:dwarf,roster:paper&seed=42')
  // A fight first: the arena's Worker is loaded while the network is up.
  await fightButton(page).click()
  const arena = page.getByRole('application', { name: 'arena' })
  await expect(arena).toBeVisible()
  const status = page.getByRole('contentinfo').getByRole('status')
  await expect(status).toHaveText('● local')
  await context.setOffline(true)
  await expect(status).toContainText('○ offline')
  await expect(status).toContainText('arena, editor, and local tournaments still work')
  // The arena needs no network: a new fight plays.
  await page.getByRole('region', { name: 'arena' }).getByRole('button', { name: 'setup' }).click()
  await fightButton(page).click()
  await expect(arena).not.toContainText('cycle 0 /', { timeout: 10_000 })
  await context.setOffline(false)
  await expect(status).toHaveText('● local')
})
