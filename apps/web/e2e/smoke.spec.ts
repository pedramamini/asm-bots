/**
 * Every route of the app (PRODUCT_SPEC), against the production build: it renders, its tab
 * carries its title, and nothing reaches the console. `/_gallery` is a development route, so the
 * build answers it with the 404 page.
 */
import { expect, type Page, test } from '@playwright/test'

const ROUTES: readonly (readonly [path: string, title: string])[] = [
  ['/', 'ASM BOTS // HOME'],
  ['/arena', 'ASM BOTS // ARENA'],
  ['/arena/r-1a2b', 'ASM BOTS // ARENA · replay r-1a2b'],
  ['/editor', 'ASM BOTS // EDITOR'],
  ['/editor/b-42', 'ASM BOTS // EDITOR · b-42'],
  ['/tournaments', 'ASM BOTS // TOURNAMENTS'],
  ['/tournaments/t-7', 'ASM BOTS // TOURNAMENTS · t-7'],
  ['/hills', 'ASM BOTS // HILLS'],
  ['/hills/main', 'ASM BOTS // HILLS · main'],
  ['/bots/b-42', 'ASM BOTS // BOTS · b-42'],
  ['/u/pedram', 'ASM BOTS // PROFILE · pedram'],
  ['/docs', 'ASM BOTS // DOCS'],
  ['/docs/start-here', 'ASM BOTS // DOCS · start here'],
  ['/docs/no/such/page', 'ASM BOTS // 0X404'],
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

test('frames each route: brand, nav, and status row', async ({ page }) => {
  await page.goto('/hills/main')
  const header = page.getByRole('banner')
  await expect(header).toContainText('ASM BOTS // HILLS')
  await expect(header.getByRole('link', { name: 'hills' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('contentinfo')).toContainText('x16c v1')
  await expect(page.getByRole('link', { name: 'made with maestro' })).toHaveAttribute(
    'href',
    'https://runmaestro.ai',
  )
})

/**
 * Goes to `/` and waits for the app to render: `goto` returns at the load event, which comes
 * before the app's first render and so before its key listener.
 */
async function openHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page).toHaveTitle('ASM BOTS // HOME')
}

test('? opens the key help with the global keys', async ({ page }) => {
  await openHome(page)
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'keys' })
  for (const description of ['show the keys', 'next theme', 'search this page', 'go to arena']) {
    await expect(help.getByText(description, { exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
})

test('t cycles the theme and the choice survives a reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === null) {
      localStorage.setItem('theme', 'sentinel')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await openHome(page)
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'sentinel')
  await page.keyboard.press('t')
  await page.keyboard.press('t')
  await expect(html).toHaveAttribute('data-theme', 'pedurple')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'pedurple')
})

test('g a goes to the arena without a reload', async ({ page }) => {
  await openHome(page)
  await page.keyboard.press('g')
  await page.keyboard.press('a')
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
})
