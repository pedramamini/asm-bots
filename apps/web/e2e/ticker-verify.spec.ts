/**
 * The live ticker and `verify` against the Worker (`wrangler dev`, the launch seed; see
 * playwright.config.ts): the ticker's feed names the weekly championship the seed made, with its
 * countdown; and `verify` on one of the main hill's matches runs it in this browser's arena Worker
 * and checks it against the server's row, without opening its replay.
 */
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'

test.use({ baseURL: WORKER })

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('the ticker reads the live feed: the next championship, counting down', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs')
  const ticker = page.getByRole('marquee')
  await expect(ticker).toContainText('▍LIVE')
  await expect(ticker).toContainText(/NEXT CHAMPIONSHIP (IN (\d+D \d\dH|\d+H \d\dM|\d+M)|STARTING)/)
  expect(errors).toEqual([])
})

test("verify runs a main hill match here and checks it against the server's result", async ({
  page,
}) => {
  const errors = watch(page)
  // The list as it first comes: other specs submit to the main hill, and a refetch mid-test would
  // move another match into the row under test.
  let first: unknown
  await page.route('**/api/hills/main/matches?*', async (route) => {
    first ??= await (await route.fetch()).json()
    await route.fulfill({ json: first })
  })
  await page.goto('/hills/main')
  const matches = page.getByRole('table', { name: 'recent matches' })
  const row = matches.getByRole('row').nth(1)
  const verify = row.getByRole('button', { name: /^verify / })
  await verify.click()
  const chip = row.locator('[data-check]')
  await expect(chip).toHaveAttribute('data-check', 'verified', { timeout: 30_000 })
  await expect(chip).toHaveText('verified')
  // The row's own click opens the replay: the button's did not.
  await expect(page).toHaveURL(`${WORKER}/hills/main`)
  expect(errors).toEqual([])
})
