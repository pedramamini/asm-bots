/**
 * The arena in battle, against the production build (PRODUCT_SPEC §2): a duel played at max speed
 * to its victory overlay, a share link that plays the same battle to the same result hash in
 * another page, and the keys and the rail that isolate bots.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

const fightButton = (page: Page) => page.locator('button[name="fight"]')
/** The victory overlay: it carries the result hash (ISA §5.6). */
const victory = (page: Page) => page.locator('section[data-result-hash]')
const arena = (page: Page) => page.getByRole('application', { name: 'arena' })

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** Fights the setup at `url` at max speed to its end: the victory overlay's result hash. */
async function fightToTheEnd(page: Page, url: string): Promise<string> {
  await page.goto(url)
  await fightButton(page).click()
  await expect(arena(page)).toBeVisible()
  await page.getByRole('button', { name: 'max speed' }).click()
  await expect(victory(page)).toBeVisible({ timeout: 30_000 })
  return (await victory(page).getAttribute('data-result-hash')) ?? ''
}

async function sharer(context: BrowserContext): Promise<Page> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  return context.newPage()
}

test('dwarf vs imp at seed 1 plays at max to a winner, and share replays the same result', async ({
  context,
}) => {
  const page = await sharer(context)
  const errors = watch(page)
  const hash = await fightToTheEnd(page, '/arena?b=roster:dwarf,roster:imp&seed=1')
  expect(hash).toMatch(/^[0-9a-f]{16}$/)
  await expect(victory(page).getByRole('heading')).toHaveText(/^winner · dwarf$/i)
  await expect(victory(page)).toContainText('last bot standing · cycle')
  await expect(victory(page).getByRole('table', { name: 'the bots at the end' })).toContainText(
    'Imp',
  )
  await expect(page.getByRole('table', { name: 'events' })).toContainText(
    'first blood · Dwarf → Imp',
  )

  await victory(page).getByRole('button', { name: 'share' }).click()
  await expect(page.getByText('link copied.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(
    /\/arena\?b=roster:dwarf,roster:imp&seed=1&cycles=100000&rounds=1&procs=64&spacing=1024$/,
  )
  // The link, opened in another page, fights the same battle to the same end.
  const other = await context.newPage()
  const otherErrors = watch(other)
  expect(await fightToTheEnd(other, link)).toBe(hash)
  expect(errors).toEqual([])
  expect(otherErrors).toEqual([])
})

test('a battle with a random seed shares the seed it drew', async ({ context }) => {
  const page = await sharer(context)
  const hash = await fightToTheEnd(page, '/arena?b=roster:dwarf,roster:imp')
  await victory(page).getByRole('button', { name: 'share' }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const seed = new URL(link).searchParams.get('seed')
  expect(seed).toMatch(/^\d+$/)
  await expect(page.getByRole('region', { name: 'arena' })).toContainText(`seed ${seed}`)
  const other = await context.newPage()
  expect(await fightToTheEnd(other, link)).toBe(hash)
})

test('1 isolates bot 1, a row click another, a shift-click adds one', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/arena?b=roster:dwarf,roster:imp,roster:stone&seed=4')
  await fightButton(page).click()
  await expect(arena(page)).toBeVisible()
  const bots = page.getByRole('table', { name: 'bots' })
  await expect(bots).toContainText('Stone')
  await expect(arena(page)).not.toHaveAttribute('data-isolated')

  await page.keyboard.press('1')
  await expect(arena(page)).toHaveAttribute('data-isolated', '0')
  await expect(bots.getByRole('button', { name: 'isolate Dwarf' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await bots.getByRole('row', { name: /Stone/ }).click()
  await expect(arena(page)).toHaveAttribute('data-isolated', '2')
  await bots.getByRole('row', { name: /Imp/ }).click({ modifiers: ['Shift'] })
  await expect(arena(page)).toHaveAttribute('data-isolated', '1,2')
  await page.keyboard.press('3')
  await expect(arena(page)).toHaveAttribute('data-isolated', '2')
  await page.keyboard.press('3')
  await expect(arena(page)).not.toHaveAttribute('data-isolated')
  expect(errors).toEqual([])
})
