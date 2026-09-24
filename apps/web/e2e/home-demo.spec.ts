/**
 * The home page's demo battle against the production build (PRODUCT_SPEC §1): four roster bots in
 * the arena renderer with no controls, a core that changes as it plays, a new seed once a battle
 * is over, and under reduced motion a still of one battle.
 */
import { expect, type Page, test } from '@playwright/test'

const hero = (page: Page) => page.getByRole('region', { name: 'live demo' })

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** The seed the hero's status names: `4 bots · seed 83712`. */
async function seedOf(page: Page): Promise<string | undefined> {
  const status = await hero(page).locator('header').textContent()
  return status?.match(/4 bots · seed (\d+)/)?.[1]
}

test('plays four roster bots with no controls, and loops to a new seed', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/')
  const demo = hero(page).getByRole('img', {
    name: 'demo battle: LCG Painter, Spiral Painter, Dwarf, Paper',
  })
  await expect(demo).toBeVisible()
  await expect(demo).toHaveAttribute('data-renderer', 'webgl2')
  await expect(hero(page).getByRole('list', { name: "the demo's bots" })).toContainText('Paper')
  await expect.poll(() => seedOf(page)).toMatch(/^\d+$/)
  const first = await seedOf(page)

  // It plays: two looks a moment apart differ.
  const before = await demo.screenshot()
  await page.waitForTimeout(300)
  expect((await demo.screenshot()).equals(before)).toBe(false)

  // A picture, not a control: out of the tab order, and the wheel scrolls the page past it.
  await expect(demo).not.toHaveAttribute('tabindex')
  await demo.hover()
  await page.mouse.wheel(0, 300)
  await expect
    .poll(() => page.locator('main').evaluate((main) => main.scrollTop))
    .toBeGreaterThan(0)
  await page.locator('main').evaluate((main) => main.scrollTo(0, 0))

  // Each battle ends within 100,000 cycles (4 s at 400 a frame), holds 3 s, and the next has a new seed.
  await expect.poll(() => seedOf(page), { timeout: 30_000 }).not.toBe(first)
  expect(errors).toEqual([])
})

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('is a still: one battle’s owner map, with no renderer running', async ({ page }) => {
    const errors = watch(page)
    await page.goto('/')
    const still = hero(page).getByRole('img', {
      name: 'demo battle at cycle 24,000: the core as LCG Painter, Spiral Painter, Dwarf, Paper own it',
    })
    await expect(still).toBeVisible()
    await expect(hero(page).locator('header')).toContainText('4 bots · seed 62 · cycle 24,000')
    await expect(hero(page).locator('[data-renderer]')).toHaveCount(0)
    // Most of the core is someone's by cycle 24,000: its pixels are lit.
    const lit = await still.evaluate((canvas) => {
      const context = (canvas as HTMLCanvasElement).getContext('2d')
      const data = context?.getImageData(0, 0, 256, 256).data ?? new Uint8ClampedArray(0)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0) count++
      }
      return count
    })
    expect(lit).toBeGreaterThan(20_000)
    expect(errors).toEqual([])
  })
})
