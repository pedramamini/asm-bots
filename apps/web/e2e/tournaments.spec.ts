/**
 * Local tournaments in Chromium, against the production build: the new tournament form makes a
 * bracket of five roster bots, the runner plays it in the arena Worker of the build, and its card
 * goes from `running · n / 5` to `finished` with a champion. Its bracket then shows eight matches;
 * the final's panel opens, and `watch` replays a round in the arena. A round robin of four bots
 * runs to its end with a full results matrix and standings, and its share link opens read only in
 * a browser that has no tournaments. The server's list is stubbed empty: these are this browser's.
 */
import { expect, type Page, test } from '@playwright/test'
import { pickShare } from './share'

// This browser's tournaments: the server's list (tournaments-server.spec.ts) is empty here.
test.beforeEach(async ({ context }) => {
  await context.route('**/api/tournaments', (route) => route.fulfill({ json: { tournaments: [] } }))
})

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('a bracket of five roster bots runs to a champion', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/tournaments')
  await expect(page.getByText(/no tournaments yet/)).toBeVisible()
  await page.getByRole('button', { name: 'new tournament' }).first().click()

  const form = page.getByRole('dialog', { name: 'new tournament' })
  await expect(form).toBeVisible()
  await form.getByRole('textbox', { name: 'name' }).fill('spring cup')
  await form.getByRole('radio', { name: 'bracket' }).click()
  await expect(form.getByText('a bracket takes 3..32 bots: 0 bots picked')).toBeVisible()
  for (const name of ['Imp', 'Dwarf', 'Stone', 'Paper', 'Scanner']) {
    await form.getByRole('checkbox', { name, exact: true }).check()
  }
  await expect(form.getByRole('list', { name: 'entrants' }).getByRole('listitem')).toHaveCount(5)
  // Hill rules at the most cycles: long enough a run to see it running.
  await form.getByRole('radio', { name: 'hill rules' }).click()
  await form.getByRole('slider', { name: 'cycles' }).focus()
  await page.keyboard.press('End')
  await expect(form.getByText(/^5 matches · ~\d+ s at max speed$/)).toBeVisible()
  await form.locator('button[name="create"]').click()
  await expect(form).toBeHidden()

  const card = page.getByRole('listitem', { name: 'spring cup' })
  await expect(card).toContainText('bracket')
  await expect(card).toContainText('5 bots')
  await expect(card).toContainText(/running · \d \/ 5/)
  await expect(card).toContainText('finished', { timeout: 60_000 })
  await expect(card).toContainText('champion')

  // The bracket: five bots in a bracket of 8, three byes, seven matches and the third place.
  await card.getByRole('link').click()
  const bracket = page.getByRole('region', { name: 'bracket' }).last()
  await expect(bracket.locator('[data-match-id]')).toHaveCount(8)
  await expect(bracket.locator('[data-status="walkover"]')).toHaveCount(3)
  await expect(bracket.locator('[data-champion]')).toHaveCount(1)
  await bracket.getByRole('button', { name: /^final, match 7/ }).click()
  const match = page.getByRole('region', { name: 'match' })
  await expect(match).toContainText('final · match 7')
  await match.getByRole('button', { name: 'watch round 1', exact: true }).click()
  const watching = page.getByRole('dialog')
  await expect(watching.getByRole('application', { name: /^arena: / })).toBeVisible()
  await expect(watching.getByRole('button', { name: 'pause' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(watching).toBeHidden()
  expect(errors).toEqual([])
})

test('a round robin of four roster bots fills its matrix', async ({ page, browser }) => {
  const errors = watch(page)
  await page.goto('/tournaments')
  await page.getByRole('button', { name: 'new tournament' }).first().click()
  const form = page.getByRole('dialog', { name: 'new tournament' })
  await form.getByRole('textbox', { name: 'name' }).fill('league')
  await form.getByRole('radio', { name: 'round robin' }).click()
  for (const name of ['Imp', 'Dwarf', 'Stone', 'Paper']) {
    await form.getByRole('checkbox', { name, exact: true }).check()
  }
  await expect(form.getByText(/^6 matches · /)).toBeVisible()
  await form.locator('button[name="create"]').click()
  await expect(form).toBeHidden()

  const card = page.getByRole('listitem', { name: 'league' })
  await card.getByRole('link').click()
  const matrix = page.getByRole('table', { name: 'results matrix' })
  await expect(matrix.locator('[data-diagonal]')).toHaveCount(4)
  await expect(page.getByText('finished', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(matrix.locator('[data-played]')).toHaveCount(12)
  await expect(matrix.locator('[data-live]')).toHaveCount(0)
  const standings = page.getByRole('table', { name: 'standings' })
  await expect(standings.getByRole('row')).toHaveCount(5)
  // Entrants go in the order picked: Imp v Dwarf is the schedule's first match.
  await matrix.getByRole('button', { name: /^Dwarf v Imp: / }).click()
  await expect(page.getByRole('region', { name: 'match' })).toContainText('Imp v Dwarf · match 1')

  // Its share link opens in a browser that has no tournaments: the same matrix, read only.
  await page.evaluate(() => {
    const copied = window as unknown as { copied: string }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.copied = text
        },
      },
    })
  })
  const header = page.getByRole('region', { name: 'league' })
  await expect(header.getByRole('list', { name: 'entrants' }).getByRole('listitem')).toHaveCount(4)
  await pickShare(page, header, 'copy link')
  await expect(page.getByText('link copied.')).toBeVisible()
  const link = await page.evaluate(() => (window as unknown as { copied: string }).copied)
  expect(link).toMatch(/\/tournaments\/[\w-]+#t=[\w-]+$/)
  const other = await browser.newContext()
  const fresh = await other.newPage()
  const freshErrors = watch(fresh)
  await fresh.goto(link)
  const shared = fresh.getByRole('region', { name: 'league' })
  await expect(shared).toContainText('shared')
  await expect(shared).toContainText('finished')
  await expect(shared.getByRole('button', { name: 'auto-watch' })).toHaveCount(0)
  const sharedMatrix = fresh.getByRole('table', { name: 'results matrix' })
  await expect(sharedMatrix.locator('[data-played]')).toHaveCount(12)
  await expect(fresh.getByRole('table', { name: 'standings' }).getByRole('row')).toHaveCount(5)
  await other.close()
  expect(freshErrors).toEqual([])
  expect(errors).toEqual([])
})
