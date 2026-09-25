/**
 * Replay links against the production build (PRODUCT_SPEC §2): a duel's `replay link` plays in
 * another page to the same result hash and `verified`, and `share` there copies the same link; a
 * link whose recorded result was changed ends in `mismatch`; a link with no replay says so.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { pickShare } from './share'

/** The victory overlay: it carries the result hash (ISA §5.6). */
const victory = (page: Page) => page.locator('section[data-result-hash]')
/** The replay's check in the arena's header. */
const check = (page: Page) =>
  page.getByRole('region', { name: 'arena' }).locator('header [data-check]')

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** The UTF-8 text of base64url `text`. */
function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** `text` as UTF-8 in base64url, unpadded. */
function toBase64Url(text: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Dwarf vs Imp at seed 1, fought at max: its `replay link` and its result hash. */
async function duelReplay(context: BrowserContext): Promise<{ link: string; hash: string }> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  await page.goto('/arena?b=roster:dwarf,roster:imp&seed=1')
  await page.locator('button[name="fight"]').click()
  await page.getByRole('button', { name: 'max speed' }).click()
  await expect(victory(page)).toBeVisible({ timeout: 30_000 })
  const hash = (await victory(page).getAttribute('data-result-hash')) ?? ''
  await victory(page).getByRole('button', { name: 'replay link' }).click()
  await expect(page.getByText('replay link copied.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  await page.close()
  return { link, hash }
}

/** Plays the replay at `link` at max speed to its end. */
async function playToTheEnd(page: Page, link: string): Promise<void> {
  await page.goto(link)
  await expect(page.getByRole('application', { name: 'arena' })).toBeVisible()
  await page.getByRole('button', { name: 'max speed' }).click()
  await expect(victory(page)).toBeVisible({ timeout: 30_000 })
}

test('a replay link plays the duel again to the same result, verified', async ({ context }) => {
  const { link, hash } = await duelReplay(context)
  expect(hash).toMatch(/^[0-9a-f]{16}$/)
  expect(link).toMatch(/^http:\/\/localhost:4173\/arena\/[0-9a-f]{16}#r=[A-Za-z0-9_-]+$/)
  const page = await context.newPage()
  const errors = watch(page)
  await page.goto(link)
  await expect(page).toHaveTitle(/^ASM BOTS \/\/ ARENA · replay [0-9a-f]{16}$/)
  await expect(check(page)).toHaveText('verifying')
  await page.getByRole('button', { name: 'max speed' }).click()
  await expect(victory(page)).toBeVisible({ timeout: 30_000 })
  await expect(check(page)).toHaveText('verified')
  await expect(check(page)).toHaveAttribute('data-check', 'verified')
  await expect(victory(page).getByRole('heading')).toHaveText(/^winner · dwarf$/i)
  expect(await victory(page).getAttribute('data-result-hash')).toBe(hash)
  await expect(victory(page).locator('[data-check="verified"]')).toBeVisible()

  // `share` on a replay copies the replay's own link.
  await pickShare(page, victory(page), 'copy link')
  await expect(page.getByText('replay link copied.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  expect(errors).toEqual([])
})

test('a link whose recorded result was changed plays, and ends in mismatch', async ({
  context,
}) => {
  const { link, hash } = await duelReplay(context)
  const url = new URL(link)
  const replay = JSON.parse(fromBase64Url(url.hash.slice('#r='.length)))
  replay.result.rounds[0].resultHash = 'ffffffffffffffff'
  url.hash = `r=${toBase64Url(JSON.stringify(replay))}`
  const page = await context.newPage()
  const errors = watch(page)
  await playToTheEnd(page, url.href)
  await expect(check(page)).toHaveText('mismatch')
  await expect(check(page)).toHaveAttribute('title', `result ${hash}, recorded ffffffffffffffff`)
  await expect(victory(page)).toContainText(`result ${hash}, recorded ffffffffffffffff`)
  expect(errors).toEqual([])
})

test('a link with no replay says so, and leads to the arena', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/arena/0123456789abcdef')
  await expect(page.getByRole('region', { name: 'replay' })).toContainText(
    'this link carries no replay.',
  )
  await page.getByRole('link', { name: /open the arena/ }).click()
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
  await page.goto('/arena/0123456789abcdef#r=eyJmb3Jt')
  await expect(page.getByRole('region', { name: 'replay' })).toContainText(
    'this replay link is broken: it does not decode, so the link may be cut short.',
  )
  expect(errors).toEqual([])
})
