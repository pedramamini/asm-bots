/**
 * The docs framework (EXEC 2.6 task 1) against the build: a code block's colors and its links
 * into the editor and the arena, the full-text search landing on a heading, and the start page's
 * screenshots (task 3).
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

const imp = (page: Page) => page.getByRole('figure', { name: 'Imp · x16c code' })

test('a code block: colors, then open in editor loads its source', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs/start-here')
  const block = imp(page)
  await expect(block.locator('code span[style*="--accent"]').first()).toBeVisible()
  await block.getByRole('link', { name: 'open in editor' }).click()
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
  await expect(page.locator('.cm-content')).toContainText('%name "Imp"')
  await expect(page.locator('.cm-content')).toContainText('movsw')
  expect(errors).toEqual([])
})

test('a code block: open in arena sets it against its roster opponent', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs/start-here')
  await imp(page).getByRole('link', { name: 'open in arena · vs dwarf' }).click()
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
  await expect(page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')).toHaveText([
    /Imp/,
    /Dwarf.*roster/,
  ])
  await expect(page.locator('button[name="fight"]')).toBeEnabled()
  expect(errors).toEqual([])
})

test('search: a section hit opens the page at its heading', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('region', { name: 'contents' })).toBeVisible()
  await page.keyboard.press('/')
  const search = page.getByRole('searchbox', { name: 'search the docs' })
  await expect(search).toBeFocused()
  await search.fill('first bot')
  const results = page.getByRole('navigation', { name: 'search results' })
  await expect(results.getByRole('link').first()).toContainText('start here › Write your first bot')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/docs\/start-here#write-your-first-bot$/)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Write your first bot' }),
  ).toBeInViewport()
})

test("the start page's tour screenshots load from the build", async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs/start-here')
  const shots = page.getByRole('region', { name: 'start here' }).locator('figure img')
  await expect(shots).toHaveCount(3)
  for (const shot of await shots.all()) {
    await shot.scrollIntoViewIfNeeded()
    await expect
      .poll(() => shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBe(1280)
  }
  expect(errors).toEqual([])
})

test('a melee block: open in arena picks the bot and each rival of its run', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs/strategy/melee')
  await page
    .getByRole('figure', { name: 'Vampire · x16c code' })
    .getByRole('link', { name: 'open in arena · vs dwarf, stone, paper' })
    .click()
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
  await expect(page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')).toHaveText([
    /Vampire/,
    /Dwarf.*roster/,
    /Stone.*roster/,
    /Paper.*roster/,
  ])
  expect(errors).toEqual([])
})

test('the keyboard map draws every group of keys', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs/tools/keys')
  const article = page.getByRole('region', { name: 'keyboard map' })
  for (const group of ['global', 'go', 'arena', 'editor', 'source', 'debugger']) {
    await expect(article.locator('caption', { hasText: new RegExp(`^${group}$`) })).toHaveCount(1)
  }
  await expect(article.getByRole('row', { name: /isolate bot n/ })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('the strategy, tournament, and tools pages load with no errors', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs')
  const links = page
    .getByRole('navigation', { name: 'docs pages' })
    .locator('a[href^="/docs/strategy/"], a[href^="/docs/tournaments/"], a[href^="/docs/tools/"]')
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href') as string))
  expect(hrefs).toHaveLength(21)
  for (const href of [...hrefs, '/docs/changelog', '/docs/isa-versions']) {
    await page.goto(href)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  expect(errors).toEqual([])
})
