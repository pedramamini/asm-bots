/**
 * The boot screen and the welcome tour in Chromium, against the production build (PRODUCT_SPEC
 * §9): opening `/` boots the core behind the logo, `take tour` walks the whole site with a
 * spotlight on each part, and the tour's last step starts the arena's guided first battle. A browser a script drives skips
 * the boot unless the URL asks (`?boot=1`), so every other spec opens `/` as it always has.
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

/** The tour's steps, in order, and whether each lights a part of its page (`tour-steps.tsx`). */
const STEPS: readonly (readonly [id: string, lit: boolean])[] = [
  ['welcome', false],
  ['nav', true],
  ['header-tools', true],
  ['site', true],
  ['how-it-works', true],
  ['home-hill', true],
  ['arena-roster', true],
  ['arena-config', true],
  ['arena-fight', true],
  ['arena-core', true],
  ['arena-transport', true],
  ['arena-bots', true],
  ['arena-events', true],
  ['editor-source', true],
  ['editor-tools', true],
  ['tournaments', true],
  ['hills', true],
  ['docs', true],
  ['done', false],
]

/** Whether the tour's hole, where it ends its slide, has its middle on the part the step lights. */
function holeOnTarget(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const to = document.querySelector('[data-tour-hole]')?.getAttribute('data-to')
    const selector = document.querySelector('[data-tour-target]')?.getAttribute('data-tour-target')
    const target = selector ? document.querySelector(selector)?.getBoundingClientRect() : undefined
    if (!to || !target) return false
    const [left = 0, top = 0, width = 0, height = 0] = to.split(' ').map(Number)
    const x = left + width / 2
    const y = top + height / 2
    return x >= target.left && x <= target.right && y >= target.top && y <= target.bottom
  })
}

/** The nav link of the page the browser is on: its label. */
function currentPage(page: Page): Promise<string> {
  return page.locator('header nav[aria-label="primary"] [aria-current="page"]').innerText()
}

/** The pixels of the boot's core dump brighter than its black: what it has drawn. */
function litPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-boot] canvas')
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let lit = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 90) lit++
    }
    return lit
  })
}

test('a first visit: the core boots, and take tour walks every page to the first battle', async ({
  page,
}) => {
  // Nineteen steps across six pages, then the intro's battle to first blood.
  test.setTimeout(90_000)
  const errors = watch(page)
  await page.goto('/?boot=1')
  const boot = page.getByRole('dialog', { name: 'asm bots' })
  await expect(boot).toBeVisible()
  // The URL drops the ask, so a reload does not ask again.
  await expect(page).toHaveURL(/\/$/)
  await expect(boot.getByRole('button', { name: 'take tour' })).toBeFocused()
  await expect(boot.getByRole('list', { name: 'boot log' })).toContainText('live')
  await expect(boot.getByRole('button', { name: 'enter site' })).toBeVisible()
  // The dump behind the panel draws, and keeps drawing: the bots run.
  await expect.poll(() => litPixels(page)).toBeGreaterThan(2_000)
  const before = await page.locator('[data-boot] canvas').screenshot()
  await page.waitForTimeout(300)
  const after = await page.locator('[data-boot] canvas').screenshot()
  expect(after.equals(before)).toBe(false)

  await page.keyboard.press('Enter')
  await expect(boot).toBeHidden()
  const tour = page.getByRole('dialog', { name: 'the tour' })
  await expect(tour).toContainText(`1 / ${STEPS.length} · welcome`)
  // Enter walks every step: each goes to its page, and a lit step's hole finds its part there.
  for (const [index, [id, lit]] of STEPS.entries()) {
    await expect(tour).toHaveAttribute('data-tour-step', id)
    await expect(tour).toContainText(`${index + 1} / ${STEPS.length}`)
    await expect(page.locator('[data-tour-hole]'), id).toHaveCount(lit ? 1 : 0)
    if (lit) await expect.poll(() => holeOnTarget(page), { message: id }).toBe(true)
    // The nav is never dimmed, and a ring marks the page the tour stands on.
    await expect(page.locator('[data-tour-page]'), id).toHaveCount(1)
    const here = await currentPage(page)
    await expect(page.locator('[data-tour-page-label]'), id).toHaveText(`on the page: ${here}`, {
      ignoreCase: true,
    })
    if (id === 'arena-roster') await expect(page).toHaveURL(/\/arena\?/)
    if (id === 'arena-core') await expect(page.locator('[data-tour="arena-core"]')).toBeVisible()
    if (id === 'editor-source') await expect(page).toHaveURL(/\/editor/)
    if (id === 'docs') await expect(page).toHaveURL(/\/docs/)
    if (index < STEPS.length - 1) {
      await expect(tour.getByRole('button', { name: 'next' })).toBeFocused()
      await page.keyboard.press('Enter')
    }
  }
  await expect(page).toHaveURL(/\/$/)
  await expect(tour.getByRole('list', { name: 'the pages' }).getByRole('listitem')).toHaveCount(6)
  await tour.getByRole('button', { name: 'watch the first battle' }).click()

  // The arena's guided demo: Dwarf vs Imp, the first coach mark on the transport.
  await expect(page).toHaveURL(/\/arena\?.*seed=263/)
  await expect(page.locator('[data-coach="intro-bots"]')).toContainText('Dwarf and Imp')
  await page.locator('[data-coach="intro-bots"]').getByRole('button', { name: 'play now' }).click()
  await expect(page.locator('[data-coach="intro-blood"]')).toBeVisible({ timeout: 30_000 })

  // Home again without `?boot=1`: a driven browser gets no boot, and no tour.
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'how it works' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('enter site: in at once, and the next load boots with the same choice', async ({ page }) => {
  await page.goto('/?boot=1')
  const boot = page.getByRole('dialog', { name: 'asm bots' })
  await boot.getByRole('button', { name: 'enter site' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'ASM BOTS' })).toBeVisible()

  await page.goto('/?boot=1')
  await expect(boot.getByRole('button', { name: 'take tour' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The tour stays in reach: the home page's `take the tour`.
  await page
    .getByRole('region', { name: 'ASM BOTS' })
    .getByRole('button', { name: 'take the tour' })
    .click()
  const tour = page.getByRole('dialog', { name: 'the tour' })
  await expect(tour).toContainText(`1 / ${STEPS.length}`)
  await tour.getByRole('button', { name: 'skip the tour' }).click()
  await expect(tour).toBeHidden()
})

test('reduced motion: the dump is a still, and the boot log shows whole', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('/?boot=1')
  const boot = page.getByRole('dialog', { name: 'asm bots' })
  await expect(boot.getByRole('list', { name: 'boot log' })).toContainText('live')
  await expect.poll(() => litPixels(page)).toBeGreaterThan(2_000)
  // The dump is set again once the mono face is in: a still after that.
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))))
  const before = await page.locator('[data-boot] canvas').screenshot()
  await page.waitForTimeout(400)
  const after = await page.locator('[data-boot] canvas').screenshot()
  expect(after.equals(before)).toBe(true)
  await context.close()
})

test('a deep link never boots', async ({ page }) => {
  await page.goto('/arena?boot=1')
  await expect(page.locator('button[name="fight"]')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'asm bots' })).toHaveCount(0)
})
