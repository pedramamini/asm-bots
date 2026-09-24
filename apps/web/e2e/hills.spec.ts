/**
 * A hill submission end to end against the Worker (`wrangler dev` with `DEV_FAKE_AUTH`, the launch
 * seed, and a `Runner` that waits between its matches; see playwright.config.ts): sign in from the
 * hill page, keep a dwarf in the account, submit it to `tiny`, watch the progress panel fight the
 * hill's entries one by one, and find the dwarf on the board, in the feed, and in the result card.
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

test('submits a dwarf to tiny, watches it fight the hill, and finds it on the board', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = watch(page)
  const run = Date.now().toString(36)
  const login = `e2e-${run}-h`
  await page.route('**/api/auth/github?*', (route) =>
    route.continue({ url: `${route.request().url()}&as=${login}` }),
  )

  await page.goto('/hills/tiny')
  const standings = page.getByRole('table', { name: 'standings' })
  await expect(standings.getByRole('row')).toHaveCount(15)
  await page.getByRole('button', { name: 'sign in to submit' }).click()
  await expect(page).toHaveURL(`${WORKER}/hills/tiny`)
  const pick = page.getByRole('dialog', { name: 'pick a handle' })
  await pick.getByRole('button', { name: 'continue' }).click()
  await expect(pick).toBeHidden()

  // The roster's dwarf is on tiny already, and the hill refuses the same bytes twice: this one
  // loads a register first, a harmless 3 bytes the run's clock makes its own.
  const name = `dwarf-${run}`
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

  await page.getByRole('button', { name: 'submit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'submit to tiny' })
  await expect(dialog.getByRole('combobox', { name: 'bot' })).toHaveValue(/.+/)
  await expect(dialog).toContainText('the server fights it against 14 entries')
  await dialog.getByRole('button', { name: 'submit', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/hills\/tiny\?submission=[0-9a-f-]{36}$/)

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
