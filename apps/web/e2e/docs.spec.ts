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
  await expect(page.getByRole('region', { name: 'docs home' })).toBeVisible()
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
  // The sidebar lists every page; the home's cards list only each section's first few.
  const links = page
    .getByRole('navigation', { name: 'docs pages' })
    .locator('a[href^="/docs/strategy/"], a[href^="/docs/tournaments/"], a[href^="/docs/tools/"]')
  // The home is a lazy route: wait for the links before reading them. A closed section's links
  // are in the page but hidden.
  await expect(links.first()).toBeAttached()
  expect(await links.count()).toBeGreaterThanOrEqual(21)
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href') as string))
  for (const href of [...hrefs, '/docs/changelog', '/docs/isa-versions']) {
    await page.goto(href)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  expect(errors).toEqual([])
})

// The quality pass (EXEC 2.6 task 5): the two paths a reader takes most, and the page's measure.

test('search: "rep movsw" finds the papers page and opens it at the heading', async ({ page }) => {
  await page.goto('/docs/start-here')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('/')
  const search = page.getByRole('searchbox', { name: 'search the docs' })
  await expect(search).toBeFocused()
  await search.fill('rep movsw')
  const results = page.getByRole('navigation', { name: 'search results' })
  await expect(results.getByRole('link').first()).toContainText(
    'papers and silk › Why spl after rep movsw',
  )
  await search.press('Enter')
  await expect(page).toHaveURL(/\/docs\/strategy\/papers#why-spl-after-rep-movsw$/)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Why spl after rep movsw' }),
  ).toBeInViewport()
  await expect(search).toHaveValue('')
})

test('the imp page: open in arena lands on a loaded arena that fights', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/docs/strategy/imps')
  await page
    .getByRole('figure', { name: 'Imp Ring · x16c code' })
    .getByRole('link', { name: 'open in arena · vs dwarf' })
    .click()
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
  await expect(page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')).toHaveText([
    /Imp Ring/,
    /Dwarf.*roster/,
  ])
  const fight = page.locator('button[name="fight"]')
  await expect(fight).toBeEnabled()
  await fight.click()
  await expect(page.getByRole('application', { name: 'arena' })).toBeVisible()
  expect(errors).toEqual([])
})

/** The article's width, and the width of the panel it fills (the panel's padding in). */
function measure(page: Page) {
  return page.locator('article').evaluate((article) => {
    const panel = article.parentElement as HTMLElement
    const style = getComputedStyle(panel)
    const inner =
      panel.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    return { width: article.getBoundingClientRect().width, panel: inner }
  })
}

/** Each code block of the article: does it wrap, and does it scroll sideways? */
function codeBlocks(page: Page) {
  return page.locator('article pre').evaluateAll((pres) =>
    pres.map((pre) => {
      const code = pre.querySelector('code') as HTMLElement
      const lines = (code.textContent ?? '').replace(/\n$/, '').split('\n').length
      const lineHeight = Number.parseFloat(getComputedStyle(code).lineHeight)
      return {
        whiteSpace: getComputedStyle(code).whiteSpace,
        // A wrapped line would make the code taller than its lines.
        wraps: code.getBoundingClientRect().height > lines * lineHeight + 1,
        scrolls: pre.scrollWidth > pre.clientWidth,
        overflowX: getComputedStyle(pre).overflowX,
      }
    }),
  )
}

test('a page fills its panel, and its code scrolls sideways rather than wrap', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/docs/strategy/imps')
  await expect(page.locator('article pre code span[style*="--accent"]').first()).toBeVisible()
  // No reading measure holds the text narrow: the article is as wide as its panel.
  const wide = await measure(page)
  expect(wide.width).toBeCloseTo(wide.panel, 0)

  // A phone: the article still fills its panel, the docs do not scroll sideways, the code does.
  // (The page's own `main` scrolls the docs; the app header above it is the kit's.)
  await page.setViewportSize({ width: 390, height: 844 })
  const narrow = await measure(page)
  expect(narrow.width).toBeCloseTo(narrow.panel, 0)
  expect(await page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(
    true,
  )
  const blocks = await codeBlocks(page)
  expect(blocks.length).toBeGreaterThan(0)
  for (const block of blocks) {
    expect(block).toMatchObject({ whiteSpace: 'pre', wraps: false, overflowX: 'auto' })
  }
  expect(blocks.some((block) => block.scrolls)).toBe(true)
})
