/**
 * The arena setup in Chromium, against the production build: `.asm` files dropped the way a
 * browser drops them, the fight button's words, the URL round trip (a reload, and a link opened
 * cold), a share link that carries local bots into a browser without them, the diagnostics of a
 * file that does not assemble, and the fight, which starts the Worker of the build.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'

const ROSTER = fileURLToPath(new URL('../../../packages/bots/roster/', import.meta.url))
/** A roster bot's source file, read as text: the runner cannot import `.asm` (`e2e/roster.ts`). */
const source = (slug: string) => readFileSync(`${ROSTER}${slug}.asm`, 'utf8')

const BROKEN = '%name "Broken"\n        jmp nowhere\n'

/** Drops `files` on the setup as the browser does: dragenter, dragover, and drop, with files. */
async function dropFiles(page: Page, files: { name: string; text: string }[]) {
  const dataTransfer = await page.evaluateHandle((list) => {
    const transfer = new DataTransfer()
    for (const { name, text } of list) transfer.items.add(new File([text], name))
    return transfer
  }, files)
  const zone = page.getByText('drop .asm files anywhere here')
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await zone.dispatchEvent(type, { dataTransfer })
  }
}

const fightButton = (page: Page) => page.locator('button[name="fight"]')
const picked = (page: Page) => page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('two dropped files make fight · 2 bots · 1 round, and survive a reload', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/arena')
  await expect(fightButton(page)).toHaveText('add 2 bots')
  await expect(fightButton(page)).toBeDisabled()
  await dropFiles(page, [
    { name: 'dwarf.asm', text: source('dwarf') },
    { name: 'imp.asm', text: source('imp') },
  ])
  await expect(fightButton(page)).toHaveText('fight · 2 bots · 1 round')
  await expect(fightButton(page)).toBeEnabled()
  await expect(picked(page)).toHaveText([/Dwarf.*local.*23 B/, /Imp.*local.*15 B/])
  await expect(page.getByText('added 2 bots.')).toBeVisible()
  // The URL names them by their ids in this browser's store, and a reload finds them there.
  await expect(page).toHaveURL(/\?b=local:[\w-]+,local:[\w-]+&cycles=100000&rounds=1&/)
  await page.reload()
  await expect(picked(page)).toHaveText([/Dwarf/, /Imp/])
  await expect(fightButton(page)).toHaveText('fight · 2 bots · 1 round')
  expect(errors).toEqual([])
})

test('a link restores the setup, and a change reaches the URL', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/arena?b=roster:dwarf,roster:paper&seed=42&cycles=100000&rounds=3&procs=64')
  await expect(picked(page)).toHaveText([/Dwarf.*roster/, /Paper.*roster/])
  await expect(page.getByLabel('seed')).toHaveValue('42')
  await expect(page.getByRole('slider', { name: 'rounds' })).toHaveAttribute('aria-valuetext', '3')
  await expect(fightButton(page)).toHaveText('fight · 2 bots · 3 rounds')
  await page.getByRole('radio', { name: 'hill rules' }).click()
  await page.getByRole('button', { name: 'add Imp', exact: true }).click()
  await expect(page).toHaveURL(
    /\?b=roster:dwarf,roster:paper,roster:imp&seed=42&cycles=80000&rounds=10&procs=64&spacing=1024$/,
  )
  await page.reload()
  await expect(picked(page)).toHaveText([/Dwarf/, /Paper/, /Imp/])
  await expect(page.getByRole('radio', { name: 'hill rules' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(fightButton(page)).toHaveText('fight · 3 bots · 10 rounds')
  expect(errors).toEqual([])
})

test('a share link carries local bots into a browser without them', async ({ browser }) => {
  const sharer = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await sharer.newPage()
  await page.goto('/arena?b=roster:dwarf&seed=7')
  await dropFiles(page, [{ name: 'my-imp.asm', text: source('imp') }])
  await expect(fightButton(page)).toHaveText('fight · 2 bots · 1 round')
  await page.getByRole('button', { name: 'copy a share link' }).click()
  await expect(page.getByText('link copied with 1 local bot inside.')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/\/arena\?b=roster:dwarf,local:[\w-]+&seed=7&.*#src=[\w-]+$/)
  await sharer.close()

  // A fresh context: its store is empty, so the fragment is where the bot comes from.
  const friend = await browser.newContext()
  const other = await friend.newPage()
  const errors = watch(other)
  await other.goto(link)
  await expect(picked(other)).toHaveText([/Dwarf.*roster/, /Imp.*shared/])
  await expect(fightButton(other)).toHaveText('fight · 2 bots · 1 round')
  await other.getByRole('button', { name: 'save Imp to my bots' }).click()
  await expect(picked(other).nth(1)).toContainText('local')
  expect(errors).toEqual([])
  await friend.close()
})

test('a file that does not assemble shows its diagnostics', async ({ page }) => {
  await page.goto('/arena')
  await dropFiles(page, [
    { name: 'broken.asm', text: BROKEN },
    { name: 'notes.txt', text: 'hello' },
  ])
  const dialog = page.getByRole('dialog', { name: '2 files did not assemble' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('2:13 error')
  await expect(dialog.locator('pre')).toContainText('jmp nowhere')
  await expect(dialog.locator('pre')).toContainText('^^^^^^^')
  await expect(dialog).toContainText('not an .asm file')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(fightButton(page)).toHaveText('add 2 bots')
})

test('fight runs the battle in the Worker, and setup comes back', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/arena?b=roster:dwarf,roster:paper,roster:stone,roster:imp&seed=7')
  await fightButton(page).click()
  const arena = page.getByRole('region', { name: 'arena' })
  await expect(arena.getByRole('application', { name: 'arena' })).toBeVisible()
  // The Worker plays: the cycle count climbs.
  await expect(arena).toContainText(/cycle [1-9][\d,]* \/ 100,000/)
  await expect(page.getByRole('table', { name: 'bots' })).toContainText('Stone')
  await arena.getByRole('button', { name: 'setup' }).click()
  await expect(picked(page)).toHaveCount(4)
  expect(errors).toEqual([])
})
