/**
 * Server tournaments end to end against the Worker (`wrangler dev` with `DEV_FAKE_AUTH`, the launch
 * seed, and a `Runner` that waits between its matches; see playwright.config.ts): a user makes a
 * bracket of five roster bots and starts it, and its page follows it live to its champion, whose
 * rounds replay from the server's replays; a player enters an open tournament from its page; two
 * players enter an open melee, and the second's browser follows it live to its end; the home page
 * and the list name the weekly championship the seed made.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'

test.use({ baseURL: WORKER })

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** Signs in as a new user `login` through the fake sign-in, back at `path`. */
async function signIn(page: Page, login: string, path: string): Promise<void> {
  // An address of its own, past the Worker's 10 sign-ins a minute an address (a11y.spec.ts).
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': address(login) })
  await page.goto(`/api/auth/github?as=${login}&returnTo=${encodeURIComponent(path)}`)
  await expect(page).toHaveURL(`${WORKER}${path}`)
  const pick = page.getByRole('dialog', { name: 'pick a handle' })
  await pick.getByRole('button', { name: 'continue' }).click()
  await expect(pick).toBeHidden()
}

/** A private IPv4 address for `login`: the same login, the same address. */
function address(login: string): string {
  let hash = 0
  for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `10.13.${(hash >>> 8) & 255}.${hash & 255}`
}

/** `POST /api/<path>` from the page, as its user: the status and the body. */
function post(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ([to, json]) => {
      const res = await fetch(`/api${to}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })
      const body = (await res.json()) as { tournament?: { id: string }; version?: { id: string } }
      return { status: res.status, body }
    },
    [path, body] as const,
  )
}

/** Two bots to enter: a dwarf (roster source) and a two-line loop. */
const DWARF = readFileSync(
  fileURLToPath(new URL('../../../packages/bots/roster/dwarf.asm', import.meta.url)),
  'utf8',
)
const LOOP = '%name "Loop"\nstart: nop\n        jmp start\n'

/** Short duels: a match takes a moment, so the page sees the bracket fill. */
const CONFIG = {
  rounds: 3,
  seed: 5,
  battle: {
    coreSize: 65_536,
    maxCycles: 20_000,
    maxProcesses: 64,
    minSpacing: 1024,
    maxBotBytes: 512,
  },
  thirdPlace: true,
}

test('a bracket of five made on the server runs to its champion while its page watches', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = watch(page)
  const run = Date.now().toString(36)
  const name = `server cup ${run}`
  await signIn(page, `e2e-${run}-t`, '/tournaments')
  const made = await post(page, '/tournaments', {
    name,
    kind: 'bracket',
    entrants: {
      entry: 'invite',
      botVersionIds: ['imp', 'dwarf', 'stone', 'paper', 'scanner'].map((s) => `roster-${s}-v1`),
    },
    config: CONFIG,
  })
  expect(made.status).toBe(201)
  const id = made.body.tournament?.id ?? ''

  // Its card, with the server chip, on the list.
  await page.goto('/tournaments')
  const card = page.getByRole('listitem', { name })
  await expect(card).toContainText('server')
  await expect(card).toContainText('scheduled')
  await card.getByRole('link').click()
  await expect(page).toHaveURL(`${WORKER}/tournaments/${id}`)

  const header = page.getByRole('region', { name })
  await expect(header.getByRole('list', { name: 'entrants' }).getByRole('listitem')).toHaveCount(5)
  const live = page.getByRole('region', { name: 'live' })
  await expect(live.locator('[data-status="live"]')).toBeVisible()
  await header.getByRole('button', { name: 'start' }).click()
  await expect(page.getByText(`${name} is running on the server.`)).toBeVisible()
  await expect(header).toContainText(/running · \d \/ 5/)

  // The bracket fills as the matches land, to its champion.
  const bracket = page.getByRole('region', { name: 'bracket' }).last()
  await expect(bracket.locator('[data-match-id]')).toHaveCount(8)
  await expect(header).toContainText('finished', { timeout: 90_000 })
  await expect(bracket.locator('[data-champion]')).toHaveCount(1)
  await expect(header.getByTitle('champion')).toBeVisible()

  // A round of the final plays from the server's replay, and checks out.
  await bracket.getByRole('button', { name: /^final, match 7/ }).click()
  const match = page.getByRole('region', { name: 'match' })
  await match.getByRole('button', { name: 'watch round 1', exact: true }).click()
  const watching = page.getByRole('dialog')
  await expect(watching.getByRole('application', { name: /^arena: / })).toBeVisible()
  await expect(watching.getByText('verified')).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('Escape')
  await expect(watching).toBeHidden()

  // The whole final, run here from the server's inputs, round by round against its row.
  await match.getByRole('button', { name: /^verify final · match 7/ }).click()
  await expect(match.locator('[data-check]')).toHaveAttribute('data-check', 'verified', {
    timeout: 60_000,
  })
  expect(errors).toEqual([])
})

test('a player enters an open tournament from its page', async ({ page, browser }) => {
  const errors = watch(page)
  const run = Date.now().toString(36)
  const name = `open cup ${run}`
  await signIn(page, `e2e-${run}-h`, '/tournaments')
  const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const made = await post(page, '/tournaments', {
    name,
    kind: 'melee',
    entrants: { entry: 'open', closesAt },
    config: CONFIG,
  })
  expect(made.status).toBe(201)
  const path = `/tournaments/${made.body.tournament?.id}`

  // Another player, signed out at first: the page asks them to sign in.
  const other = await browser.newContext()
  const player = await other.newPage()
  const playerErrors = watch(player)
  await player.goto(path)
  const header = player.getByRole('region', { name })
  await expect(header).toContainText('open entry until')
  await expect(header.getByRole('button', { name: 'sign in to enter' })).toBeVisible()
  await signIn(player, `e2e-${run}-p`, path)
  const saved = await post(player, '/bots', {
    name: `loop-${run}`,
    source: '%name "Loop"\nstart: nop\n        jmp start\n',
  })
  expect(saved.status).toBe(201)
  await player.reload()
  await header.getByRole('button', { name: 'enter', exact: true }).click()
  const dialog = player.getByRole('dialog', { name: `enter ${name}` })
  await expect(dialog.getByRole('combobox', { name: 'bot' })).toHaveValue(/.+/)
  await dialog.getByRole('button', { name: 'enter', exact: true }).click()
  await expect(player.getByText(`entered loop-${run} v1 in ${name}.`)).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(header.getByRole('list', { name: 'entrants' })).toContainText(`loop-${run}`)
  await expect(header.getByRole('button', { name: 'enter again' })).toBeVisible()
  await other.close()
  expect(playerErrors).toEqual([])
  expect(errors).toEqual([])
})

test('two players enter an open melee, and the second watches it live from another browser', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const errors = watch(page)
  const run = Date.now().toString(36)
  const name = `live melee ${run}`
  await signIn(page, `e2e-${run}-o`, '/tournaments')
  // Entry closes soon after both are in: the owner can start it only then.
  const closesAt = Date.now() + 20_000
  const made = await post(page, '/tournaments', {
    name,
    kind: 'melee',
    entrants: { entry: 'open', closesAt: new Date(closesAt).toISOString() },
    config: { ...CONFIG, thirdPlace: false },
  })
  expect(made.status).toBe(201)
  const path = `/tournaments/${made.body.tournament?.id}`
  const mine = await post(page, '/bots', { name: `dwarf-${run}`, source: DWARF })
  expect(mine.status).toBe(201)
  const entered = await post(page, `${path}/enter`, {
    botVersionId: mine.body.version?.id,
  })
  expect(entered.status).toBe(201)

  // The player, in a browser of their own, enters from the page and stays on it.
  const other = await browser.newContext({ baseURL: WORKER })
  const player = await other.newPage()
  const playerErrors = watch(player)
  await signIn(player, `e2e-${run}-w`, path)
  const saved = await post(player, '/bots', { name: `loop-${run}`, source: LOOP })
  expect(saved.status).toBe(201)
  await player.reload()
  const header = player.getByRole('region', { name })
  await header.getByRole('button', { name: 'enter', exact: true }).click()
  const dialog = player.getByRole('dialog', { name: `enter ${name}` })
  await dialog.getByRole('button', { name: 'enter', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(header.getByRole('list', { name: 'entrants' }).getByRole('listitem')).toHaveCount(2)
  const live = player.getByRole('region', { name: 'live' })
  await expect(live.locator('[data-status="live"]')).toBeVisible()

  // Entry closes; the owner starts it from their page, and the player's page follows, unreloaded.
  await page.waitForTimeout(Math.max(0, closesAt - Date.now() + 500))
  await page.goto(path)
  await page.getByRole('region', { name }).getByRole('button', { name: 'start' }).click()
  await expect(page.getByText(`${name} is running on the server.`)).toBeVisible()
  await expect(header).toContainText('finished', { timeout: 90_000 })
  await expect(header.getByTitle('champion')).toBeVisible()
  const standings = player.getByRole('table', { name: 'standings' })
  await expect(standings).toContainText(`dwarf-${run}`)
  await expect(standings).toContainText(`loop-${run}`)
  await other.close()
  expect(playerErrors).toEqual([])
  expect(errors).toEqual([])
})

test('the home page and the list name the next weekly championship', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/')
  const cup = page.getByRole('region', { name: 'championship' })
  const next = cup.getByRole('link', { name: /^weekly \d{4}-\d{2}-\d{2}$/ })
  await expect(next).toBeVisible()
  const href = (await next.getAttribute('href')) ?? ''
  expect(href).toMatch(/^\/tournaments\/weekly-\d{4}-\d{2}-\d{2}$/)
  const title = (await next.textContent()) ?? ''
  await page.goto('/tournaments')
  const card = page.getByRole('listitem', { name: title })
  await expect(card).toContainText('championship')
  await expect(card).toContainText('scheduled')
  expect(errors).toEqual([])
})
