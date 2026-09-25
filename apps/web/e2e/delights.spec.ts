/**
 * The details that come with age (EXEC 4.1), against the production build and the e2e Worker: the
 * version stamp's release name and the changelog it opens (CHANGELOG.md); the 404 page's live imp;
 * an arena screenshot's footer stamp; and from the Worker, `/api/health`'s uptime, a bot's fights
 * and first sighting, and the king's reign.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'
import { decodePng, type Pixels } from './png'

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('the version stamp names its release, and opens the changelog: CHANGELOG.md', async ({
  page,
}) => {
  const errors = watch(page)
  await page.goto('/docs')
  const stamp = page.getByRole('contentinfo').getByRole('link', { name: /: the changelog$/ })
  await stamp.hover()
  // A build ahead of every release: the name of the release in the making.
  await expect(page.getByRole('tooltip')).toHaveText(
    /^\d{4}\.\d{2}\.\d{2}[a-z] · "imp gate" · unreleased$/,
  )
  await stamp.click()
  await expect(page).toHaveURL(/\/docs\/changelog$/)
  const article = page.getByRole('region', { name: 'changelog' })
  await expect(
    article.getByRole('heading', { level: 2, name: 'Unreleased · "imp gate"' }),
  ).toBeVisible()
  // CHANGELOG.md links the canonical site, so it reads on GitHub too; the app keeps it in the app.
  await article.getByRole('link', { name: 'ISA versions', exact: true }).click()
  await expect(page).toHaveURL(/\/docs\/isa-versions$/)
  expect(errors).toEqual([])
})

test('the 404 page runs a live imp, placed at 0x0404, in the arena renderer', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/no/such/address')
  const panel = page.getByRole('region', { name: '0x404 · nothing at this address' })
  await expect(panel).toContainText('no route lives here. an imp moved in at 0x0404.')
  const imp = panel.getByRole('img', { name: /^a live imp: it moved in at 0x0404/ })
  await expect(imp).toBeVisible()
  await expect(imp).toHaveAttribute('data-renderer', 'webgl2')
  // It walks: two looks a moment apart differ.
  const before = await imp.screenshot()
  await page.waitForTimeout(500)
  expect((await imp.screenshot()).equals(before)).toBe(false)
  expect(errors).toEqual([])
})

/** The pixel at (`x`, `y`) of `image`, RGB. */
function pixel(image: Pixels, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4
  return [...image.data.subarray(at, at + 3)]
}

/** Whether some pixel of rows `top..bottom` and columns `left..right` is near `rgb`. */
function has(image: Pixels, box: [number, number, number, number], rgb: number[]): boolean {
  const [left, top, right, bottom] = box
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (pixel(image, x, y).every((v, k) => Math.abs(v - (rgb[k] as number)) <= 24)) return true
    }
  }
  return false
}

test('an arena screenshot is stamped: the bots, the seed, the cycle, and the site', async ({
  page,
}) => {
  const errors = watch(page)
  await page.goto('/arena?b=roster:dwarf,roster:imp&seed=1')
  await page.locator('button[name="fight"]').click()
  const arena = page.getByRole('application', { name: 'arena' })
  await expect(arena).toBeVisible()
  await page.getByRole('button', { name: 'pause' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('s')])
  expect(download.suggestedFilename()).toMatch(/^asmbots-dwarf-imp-1-\d+\.png$/)
  const bytes = new Uint8Array(await readFile(await download.path()))
  // DELIGHTS_SHOT=<file.png> keeps the screenshot, to look at one that fails.
  if (process.env.DELIGHTS_SHOT) await writeFile(process.env.DELIGHTS_SHOT, bytes)
  const shot = decodePng(bytes)
  const [width, height] = await arena
    .locator('canvas')
    .first()
    .evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])
  // DPR 1: the arena, one legend row (chip 18, gap 4, inset 8), and the footer's 22.
  expect([shot.width, shot.height]).toEqual([width, (height as number) + 18 + 4 + 8 + 22])
  const top = shot.height - 22
  // The theme's tokens: the page's, paper here (a light color scheme picks it on a first visit).
  const [panel, border, muted, accent] = await page.evaluate(() =>
    ['--panel', '--border', '--text-muted', '--accent-fg'].map((name) => {
      const probe = document.createElement('i')
      probe.style.color = `var(${name})`
      document.body.append(probe)
      const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
      probe.remove()
      return rgb
    }),
  )
  // --panel under the footer, --border as the hairline on top of it.
  expect(pixel(shot, 4, top + 11)).toEqual(panel)
  expect(pixel(shot, 4, top)).toEqual(border)
  // The stamp in --text-muted from the legend's left; the site in --accent-fg at the right.
  expect(has(shot, [56, top, 400, shot.height], muted as number[])).toBe(true)
  const right = shot.width as number
  expect(has(shot, [right - 80, top, right - 8, shot.height], accent as number[])).toBe(true)
  expect(has(shot, [56, top, 400, shot.height], accent as number[])).toBe(false)
  expect(errors).toEqual([])
})

test.describe('from the Worker', () => {
  test.use({ baseURL: WORKER })

  test('/api/health says how long this version has been up, and the ISA', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { uptime: number; since: string; isa: string }
    expect(body).toMatchObject({ ok: true, isa: 'x16c-v1' })
    // Up since `wrangler dev` started, which made the version metadata.
    const since = Date.parse(body.since)
    expect(since).toBeLessThanOrEqual(Date.now())
    expect(Number.isInteger(body.uptime)).toBe(true)
    expect(Math.abs(body.uptime - (Date.now() - since) / 1000)).toBeLessThan(5)
  })

  test("a bot's page counts its fights and says when it was first seen; a king its reign", async ({
    page,
  }) => {
    const errors = watch(page)
    await page.goto('/bots/roster-dwarf')
    const card = page.getByRole('region', { name: 'bot' })
    const fights = card.getByText('fights', { exact: true }).locator('xpath=..')
    // A duel with each of 13 bots on main and on tiny, and the melee hill's melee; other specs'
    // submissions may add some.
    await expect(fights).toContainText(/fights\d/)
    const count = Number(((await fights.textContent()) ?? '').replace(/\D/g, ''))
    expect(count).toBeGreaterThanOrEqual(27)
    await expect(card.getByText('first seen', { exact: true }).locator('xpath=..')).toContainText(
      /first seen\d{4}-\d{2}-\d{2}today/,
    )
    await page.goto('/hills/main')
    const king = page.getByRole('region', { name: 'king' })
    await expect(king).toContainText(/reign \d+/)
    await expect(king).toContainText(
      /king through \d+ submissions?, on the hill through \d+ challenges?\./,
    )
    expect(errors).toEqual([])
  })
})
