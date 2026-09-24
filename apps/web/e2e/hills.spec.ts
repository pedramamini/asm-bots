/**
 * Hill submissions end to end against the Worker (`wrangler dev` with `DEV_FAKE_AUTH`, the launch
 * seed, and a `Runner` that waits between its matches; see playwright.config.ts): sign in from the
 * hill page, keep a dwarf in the account, submit it to `tiny`, watch the progress panel fight the
 * hill's entries one by one, and find the dwarf on the board, in the feed, and in the result card.
 * And live: two browsers in `main`'s room both hear a submission's match start, and the second
 * runs it and checks it against the server's result.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { WORKER } from '../playwright.config'

test.use({ baseURL: WORKER })

/** The roster's dwarf: the bot the editor's `dwarf` template starts from. */
const DWARF = readFileSync(
  fileURLToPath(new URL('../../../packages/bots/roster/dwarf.asm', import.meta.url)),
  'utf8',
)

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** Signs in as a new user `login` from hill `slug`'s page, keeping the handle offered. */
async function signIn(page: Page, slug: string, login: string): Promise<void> {
  await page.route('**/api/auth/github?*', (route) =>
    route.continue({ url: `${route.request().url()}&as=${login}` }),
  )
  await page.getByRole('button', { name: 'sign in to submit' }).click()
  await expect(page).toHaveURL(`${WORKER}/hills/${slug}`)
  const pick = page.getByRole('dialog', { name: 'pick a handle' })
  await pick.getByRole('button', { name: 'continue' }).click()
  await expect(pick).toBeHidden()
}

/**
 * Keeps a dwarf named `name` in the signed-in account. The roster's dwarf is on the hills already,
 * and a hill refuses the same bytes twice: this one loads a register first, a harmless 3 bytes the
 * run's clock makes its own.
 */
async function keepDwarf(page: Page, name: string): Promise<void> {
  const source = DWARF.replace(
    /^start:(\s+)call/m,
    `start:$1mov     ax, ${Date.now() % 0xffff}\n        call`,
  )
  const made = await page.evaluate(
    async (bot) => {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bot),
      })
      return res.status
    },
    { name, source },
  )
  expect(made).toBe(201)
}

/** Submits the account's bot to hill `slug` from its page; the submission's id. */
async function submitTo(page: Page, slug: string, entries: number | RegExp): Promise<string> {
  await page.getByRole('button', { name: 'submit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `submit to ${slug}` })
  await expect(dialog.getByRole('combobox', { name: 'bot' })).toHaveValue(/.+/)
  await expect(dialog).toContainText(
    typeof entries === 'number' ? `the server fights it against ${entries} entries` : entries,
  )
  await dialog.getByRole('button', { name: 'submit', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/hills/${slug}\\?submission=[0-9a-f-]{36}$`))
  return new URL(page.url()).searchParams.get('submission') ?? ''
}

test('submits a dwarf to tiny, watches it fight the hill, and finds it on the board', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = watch(page)
  const run = Date.now().toString(36)

  await page.goto('/hills/tiny')
  const standings = page.getByRole('table', { name: 'standings' })
  await expect(standings.getByRole('row')).toHaveCount(15)
  await signIn(page, 'tiny', `e2e-${run}-h`)
  const name = `dwarf-${run}`
  await keepDwarf(page, name)
  await submitTo(page, 'tiny', 14)

  // The progress panel: one match at a time, each landing as a row.
  const panel = page.getByRole('region', { name: 'submission', exact: true })
  await expect(panel).toContainText(/fighting \d+ of 14/)
  const matches = panel.getByRole('table', { name: 'submission matches' })
  await expect(
    matches
      .getByRole('row')
      .filter({ hasText: /won|lost|tie/ })
      .first(),
  ).toBeVisible()
  await expect(panel.getByRole('progressbar', { name: 'matches fought' })).toBeVisible()

  // Then the result card, and the dwarf on the board.
  const result = panel.getByRole('region', { name: 'result' })
  await expect(result).toContainText(/#\d+/, { timeout: 90_000 })
  await expect(panel).toContainText('finished')
  await expect(matches.getByRole('row').filter({ hasText: /won|lost|tie/ })).toHaveCount(14)
  await expect(standings.getByRole('row')).toHaveCount(16)
  await expect(standings.getByRole('link', { name, exact: true })).toBeVisible()
  const feed = page.getByRole('list', { name: 'recent submissions' })
  await expect(feed.getByRole('listitem').first()).toContainText(`${name} entered at #`)
  expect(errors).toEqual([])
})

test("two spectators hear a submission's match start, and the second checks it", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const run = Date.now().toString(36)
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: WORKER })))
  const [submitter, spectator] = await Promise.all(contexts.map((c) => c.newPage()))
  if (submitter === undefined || spectator === undefined) throw new Error('no pages')
  const errors = [watch(submitter), watch(spectator)]
  const live = (page: Page) => page.getByRole('region', { name: 'live' })

  // Both join main's room before anything runs there.
  for (const page of [spectator, submitter]) {
    await page.goto('/hills/main')
    await expect(live(page).locator('[data-status="live"]')).toBeVisible()
  }
  await expect(live(spectator).locator('[data-spectators]')).toHaveAttribute(
    'data-spectators',
    /^([2-9]|\d{2,})$/,
  )

  await signIn(submitter, 'main', `e2e-${run}-l`)
  await keepDwarf(submitter, `dwarf-${run}-live`)
  const id = await submitTo(submitter, 'main', /the server fights it against \d+ entries/)

  // The room tells both of the submission's matches as they start, and each runs one.
  for (const page of [submitter, spectator]) {
    await expect(live(page).locator('[data-live="true"]')).toBeVisible()
    await expect(live(page).locator(`[data-live-match^="${id}-"]`)).toBeVisible()
  }
  // The spectator's own run of a match, checked against the server's result hashes.
  await expect(live(spectator).locator('[data-check="verified"]')).toBeVisible({ timeout: 60_000 })
  await expect(live(spectator).locator('[data-check="mismatch"]')).toHaveCount(0)
  expect(errors).toEqual([[], []])
  await Promise.all(contexts.map((c) => c.close()))
})
