/**
 * The home page's placeholder panels and the docs frame (EXEC 2.2 task 4), against the build.
 */
import { expect, test } from '@playwright/test'

test('home: the hero, its two ways in, and the three panels', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'ASM BOTS' })).toBeVisible()
  for (const name of ['live demo', 'main hill', 'recent matches', 'championship']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('marquee')).toContainText('NEXT CHAMPIONSHIP')
  await page.getByRole('link', { name: 'write a bot' }).click()
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
})

test('docs: the sidebar search takes /, and Enter opens the MDX page', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('region', { name: 'docs home' })).toBeVisible()
  await page.keyboard.press('/')
  const search = page.getByRole('searchbox', { name: 'search the docs' })
  await expect(search).toBeFocused()
  await search.fill('start')
  await search.press('Enter')
  await expect(page).toHaveTitle('ASM BOTS // DOCS · start here')
  const article = page.getByRole('region', { name: 'start here' })
  await expect(article.getByRole('heading', { level: 1 })).toHaveText('Start here')
  await expect(article.locator('pre code')).toContainText('movsw')
  await expect(
    page.getByRole('navigation', { name: 'docs pages' }).getByRole('link', { name: 'start here' }),
  ).toHaveAttribute('data-status', 'active')
})

test('docs: an unknown page is a 404 inside the docs frame', async ({ page }) => {
  await page.goto('/docs/no/such/page')
  await expect(page).toHaveTitle('ASM BOTS // 0X404')
  await expect(page.getByRole('region', { name: '0x404 · nothing at this address' })).toContainText(
    '/docs/no/such/page',
  )
  await expect(page.getByRole('searchbox', { name: 'search the docs' })).toBeVisible()
})
