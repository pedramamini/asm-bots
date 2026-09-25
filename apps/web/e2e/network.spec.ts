/**
 * The network budgets (web README "Budgets"), end to end through the Worker as production has it:
 * the e2e Worker (`wrangler dev` on WORKER) serves the build and the API on one origin. The hashed
 * files are kept a year and the pictures a day (`public/_headers`); a replay for good; the hills
 * and their standings 30 s; a page that shows a GitHub avatar opens that origin first; and the
 * arena fights the roster, prebuilt, with no assembler loaded.
 */
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'

test.use({ baseURL: WORKER })

const AVATARS = 'https://avatars.githubusercontent.com'

/** The page's preconnect hints to the avatars' origin. */
const avatarHints = (page: Page) => page.locator(`link[rel="preconnect"][href="${AVATARS}"]`)

test('keeps the hashed files a year and the pictures a day', async ({ request }) => {
  const html = await (await request.get('/')).text()
  const script = /<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
  expect(script).toBeDefined()
  const asset = await request.get(script as string)
  expect(asset.status()).toBe(200)
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  const font = /href="(\/assets\/jetbrains-mono-latin-400-[^"]+\.woff2)"/.exec(html)?.[1]
  expect((await request.get(font as string)).headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  )
  const favicon = await request.get('/favicon.svg')
  expect(favicon.headers()['cache-control']).toBe('public, max-age=86400')
  // The build's manifest is no file of the site.
  expect((await request.get('/.vite/manifest.json')).headers()['content-type']).toContain(
    'text/html',
  )
})

test('keeps a replay for good, and the hills and their standings 30 s', async ({ request }) => {
  for (const path of ['/api/hills', '/api/hills/main']) {
    const first = await request.get(path)
    expect(first.headers()['cache-control'], path).toBe('public, max-age=30')
    const again = await request.get(path)
    expect(Number(again.headers().age), path).toBeGreaterThanOrEqual(0)
    const fresh = await request.get(path, { headers: { 'Cache-Control': 'no-cache' } })
    expect(fresh.headers().age, path).toBeUndefined()
  }
  const { matches } = (await (await request.get('/api/hills/main/matches?limit=1')).json()) as {
    matches: { match: { replayKey: string | null } }[]
  }
  const key = matches[0]?.match.replayKey
  expect(key).toMatch(/^[0-9a-f]{64}$/)
  const replay = await request.get(`/api/replays/${key}`)
  expect(replay.status()).toBe(200)
  expect(replay.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
})

test('opens the avatars’ origin on a profile, and in the header of a visit signed in', async ({
  browser,
}) => {
  const visitor = await browser.newPage({ baseURL: WORKER })
  await visitor.goto('/u/system')
  await expect(visitor.getByRole('heading', { level: 1, name: 'system' })).toBeVisible()
  await expect(avatarHints(visitor)).toHaveCount(1)
  // No one signed in: the header shows no avatar, and asks for no connection.
  await visitor.goto('/tournaments')
  await expect(visitor.getByRole('button', { name: 'sign in with github' })).toBeVisible()
  await expect(avatarHints(visitor)).toHaveCount(0)
  await visitor.close()

  const context = await browser.newContext({ baseURL: WORKER })
  // The API's hint that a session may be there: the header opens the connection as `me` loads.
  await context.addCookies([{ name: 'signed_in', value: '1', url: WORKER }])
  const member = await context.newPage()
  await member.goto('/tournaments')
  await expect(avatarHints(member)).toHaveCount(1)
  await context.close()
})

test('fights the roster with no assembler, and loads it for my bots', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.endsWith('.js')) scripts.push(path)
  })
  const assembler = () => scripts.filter((path) => /\/assets\/assembly-[\w-]+\.js$/.test(path))
  await page.addInitScript(() => {
    localStorage.setItem(
      'asmbots:settings',
      JSON.stringify({ state: { coachMarksSeen: ['arena'] }, version: 1 }),
    )
  })
  await page.goto('/arena?b=roster:dwarf,roster:paper&seed=1')
  await page.locator('button[name="fight"]').click()
  await expect(page.getByRole('application', { name: 'arena' })).toBeVisible()
  expect(assembler()).toEqual([])
  await page.getByRole('button', { name: 'setup' }).click()
  await page.getByRole('radio', { name: 'my bots' }).click()
  await expect.poll(() => assembler().length).toBe(1)
})
