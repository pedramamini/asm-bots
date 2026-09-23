/**
 * Every route of the app (PRODUCT_SPEC), against the production build: it renders, its tab
 * carries its title, and nothing reaches the console. `/_gallery` is a development route, so the
 * build answers it with the 404 page.
 */
import { expect, type Page, test } from '@playwright/test'

const ROUTES: readonly (readonly [path: string, title: string])[] = [
  ['/', 'ASM BOTS // HOME'],
  ['/arena', 'ASM BOTS // ARENA'],
  ['/arena/r-1a2b', 'ASM BOTS // ARENA · r-1a2b'],
  ['/editor', 'ASM BOTS // EDITOR'],
  ['/editor/b-42', 'ASM BOTS // EDITOR · b-42'],
  ['/tournaments', 'ASM BOTS // TOURNAMENTS'],
  ['/tournaments/t-7', 'ASM BOTS // TOURNAMENTS · t-7'],
  ['/hills', 'ASM BOTS // HILLS'],
  ['/hills/main', 'ASM BOTS // HILLS · main'],
  ['/bots/b-42', 'ASM BOTS // BOTS · b-42'],
  ['/u/pedram', 'ASM BOTS // PROFILE · pedram'],
  ['/docs', 'ASM BOTS // DOCS'],
  ['/docs/start-here/first-bot', 'ASM BOTS // DOCS · start-here/first-bot'],
  ['/settings', 'ASM BOTS // SETTINGS'],
  ['/_gallery', 'ASM BOTS // 0X404'],
  ['/no/such/address', 'ASM BOTS // 0X404'],
]

for (const [path, title] of ROUTES) {
  test(`${path} · ${title}`, async ({ page }) => {
    const errors = watch(page)
    await page.goto(path)
    await expect(page).toHaveTitle(title)
    await expect(page.locator('main, section').first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/)
    expect(errors).toEqual([])
  })
}

test('navigates without a reload', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/no/such/address')
  await page.evaluate(() => {
    ;(window as { marker?: boolean }).marker = true
  })
  await page.getByRole('link', { name: 'go home' }).click()
  await expect(page).toHaveTitle('ASM BOTS // HOME')
  expect(await page.evaluate(() => (window as { marker?: boolean }).marker)).toBe(true)
  expect(errors).toEqual([])
})

test('applies the stored theme before the first paint', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'paper'))
  // With the bundle blocked, only the inline script can set the theme.
  await page.route('**/assets/*.js', (route) => route.abort())
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F4F1EA')
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
