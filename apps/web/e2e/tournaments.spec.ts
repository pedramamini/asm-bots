/**
 * Local tournaments in Chromium, against the production build: the new tournament form makes a
 * bracket of five roster bots, the runner plays it in the arena Worker of the build, and its card
 * goes from `running · n / 5` to `finished` with a champion.
 */
import { expect, type Page, test } from '@playwright/test'

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
  expect(errors).toEqual([])
})
