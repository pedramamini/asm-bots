/**
 * The home page's placeholder panels and the docs frame (EXEC 2.2 task 4), against the build.
 */
import { expect, test } from '@playwright/test'

test('home: the name, each part of the site, the art, the panels, the footer', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'ASM BOTS' })).toBeVisible()
  const parts = page.getByRole('list', { name: 'the site' })
  await expect(parts.getByRole('heading', { level: 3 })).toHaveText([
    'arena',
    'editor',
    'hills',
    'tournaments',
    'docs',
    'for agents',
  ])
  for (const name of ['how it works', 'main hill', 'recent matches', 'championship']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  }
  // Nothing on the page plays: no demo battle (the art's canvases draw once and stay still).
  await expect(page.locator('[data-demo]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'site' })).toBeAttached()
  await expect(page.getByRole('marquee')).toContainText('NEXT CHAMPIONSHIP')
  await parts.getByRole('link', { name: 'editor', exact: true }).click()
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
  // Home again from the nav's first button.
  await page.getByRole('banner').getByRole('link', { name: 'home', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
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
