/**
 * Share cards and the embed (PRODUCT_SPEC §10) in Chromium: `/embed/arena` draws the arena alone
 * (no header, ticker, or status bar) and plays it to its end; `copy embed` at a battle's end copies
 * an `<iframe>` that another page loads, framed, and plays; and the Worker (`wrangler dev` on the
 * production build) writes each page's head for link previews and draws the share cards as PNGs
 * with the wasm renderer it ships.
 */
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'
import { pickShare } from './share'

const DUEL = 'b=roster:dwarf,roster:imp&seed=1'

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** A PNG's size from its header, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test('the embed draws the arena alone, plays it to its end, and links the arena', async ({
  page,
}) => {
  const errors = watch(page)
  await page.goto(`/embed/arena?${DUEL}`)
  const main = page.getByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
  await expect(main).toBeVisible()
  await expect(page).toHaveTitle('ASM BOTS // EMBED')
  // No frame: no header, no ticker, no status bar.
  await expect(page.locator('header')).toHaveCount(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByText('made with maestro')).toHaveCount(0)
  await expect(main.getByRole('link', { name: 'watch on asmbots' })).toHaveAttribute(
    'href',
    `http://localhost:4173/arena?${DUEL}`,
  )
  // It plays as it loads: Dwarf beats Imp at seed 1 in cycle 16,140.
  await expect(main.getByText(/cycle [1-9]/)).toBeVisible()
  await expect(main.getByText('winner · Dwarf')).toBeVisible({ timeout: 30_000 })
  expect(errors).toEqual([])
})

test('copy embed gives an <iframe> another site loads, and its battle plays there', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/arena?${DUEL}`)
  await page.locator('button[name="fight"]').click()
  await page.getByRole('button', { name: 'max speed' }).click()
  const victory = page.locator('section[data-result-hash]')
  await expect(victory).toBeVisible({ timeout: 30_000 })
  await pickShare(page, victory, 'copy embed')
  await expect(page.getByText('embed copied: paste it into any page.')).toBeVisible()
  const snippet = await page.evaluate(() => navigator.clipboard.readText())
  expect(snippet).toMatch(
    /^<iframe src="http:\/\/localhost:4173\/embed\/arena\?b=roster:dwarf,roster:imp&amp;seed=1&amp;[^"]+" title="ASM BOTS: Dwarf vs Imp" width="800" height="450" /,
  )

  // Another site's page, with the snippet pasted in.
  const host = await context.newPage()
  const errors = watch(host)
  await host.setContent(`<!doctype html><title>a blog</title><p>my bot:</p>${snippet}`)
  const frame = host.frameLocator('iframe')
  await expect(frame.getByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })).toBeVisible()
  await expect(frame.getByText('winner · Dwarf')).toBeVisible({ timeout: 30_000 })
  expect(errors).toEqual([])
})

test('the Worker writes each page’s head, and draws its card', async ({ request }) => {
  // A docs page: the build's words, and its card.
  const docs = await (await request.get(`${WORKER}/docs/machine/memory`)).text()
  expect(docs).toContain('<title>ASM BOTS // DOCS · memory</title>')
  const image = /<meta property="og:image" content="([^"]+)"/.exec(docs)?.[1] ?? ''
  expect(image).toBe('https://asmbots.io/api/pages/og.png?path=%2Fdocs%2Fmachine%2Fmemory')
  const pageCard = await request.get(`${WORKER}${new URL(image).pathname}${new URL(image).search}`)
  expect(pageCard.headers()['content-type']).toBe('image/png')
  expect(pngSize(await pageCard.body())).toEqual({ width: 1200, height: 630 })

  // A stored replay of the seed's main hill: who won, and the core's owner map as a PNG.
  const { matches } = (await (
    await request.get(`${WORKER}/api/hills/main/matches?limit=5`)
  ).json()) as { matches: { match: { replayKey: string | null } }[] }
  const key = matches.find((m) => m.match.replayKey !== null)?.match.replayKey ?? ''
  expect(key).toMatch(/^[0-9a-f]{64}$/)
  const replay = await (await request.get(`${WORKER}/arena/${key}`)).text()
  expect(replay).toContain(`<meta property="og:image" content="https://asmbots.io/api/replays/${key}/og.png" />`)
  expect(replay).toMatch(/<meta property="og:title" content="(a draw|no winner|[^"]+ wins|[^"]+ tie): /)
  const replayCard = await request.get(`${WORKER}/api/replays/${key}/og.png`)
  expect(pngSize(await replayCard.body())).toEqual({ width: 1200, height: 630 })

  // Who may frame what, and what crawlers are told.
  const embed = await request.get(`${WORKER}/embed/arena?${DUEL}`)
  expect(embed.headers()['content-security-policy']).toBe('frame-ancestors *')
  expect(await embed.text()).toContain('<meta name="robots" content="noindex" />')
  const arena = await request.get(`${WORKER}/arena`)
  expect(arena.headers()['content-security-policy']).toBe("frame-ancestors 'self'")
  const sitemap = await (await request.get(`${WORKER}/sitemap.xml`)).text()
  expect(sitemap).toContain('<loc>https://asmbots.io/docs/machine/memory</loc>')
  expect(sitemap).toContain('<loc>https://asmbots.io/hills/main</loc>')
  expect(await (await request.get(`${WORKER}/robots.txt`)).text()).toContain(
    'Sitemap: https://asmbots.io/sitemap.xml',
  )
})
