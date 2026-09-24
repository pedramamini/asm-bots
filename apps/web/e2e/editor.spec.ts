/**
 * The editor in Chromium, against the production build (its assembler and arena Workers
 * included): the dwarf typed in assembles clean with its size in the toolbar; `mov [bx], 0` shows
 * the size error at its column (squiggle, gutter mark, problems panel); `format` is idempotent;
 * `test vs imp` runs ten rounds in the arena Worker and shows the record, and `watch` opens the
 * arena set up as tested. A first visit shows the templates over the new bot and the coach mark
 * under the debugger's run button.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'

const ROSTER = fileURLToPath(new URL('../../../packages/bots/roster/', import.meta.url))
/** A roster bot's source file, read as text: the runner cannot import `.asm` (`e2e/roster.ts`). */
const source = (slug: string) => readFileSync(`${ROSTER}${slug}.asm`, 'utf8')
const DWARF = source('dwarf')

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

const content = (page: Page) => page.locator('.cm-content')
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'editor' })
const sizeChip = (page: Page) => toolbar(page).getByLabel(/^size /)
const problems = (page: Page) => page.getByRole('region', { name: 'problems' })

/** The editor's text, as CodeMirror holds it. */
function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-content .cm-line')]
    return lines.map((line) => line.textContent ?? '').join('\n')
  })
}

/** Opens a new bot, empties it, and types `text` into the editor. */
async function typeBot(page: Page, text: string) {
  await page.goto('/editor')
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
  // A line of the blank bot: the templates cover the middle of the editor.
  await content(page).locator('.cm-line').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await expect(sizeChip(page)).toHaveText('— / 512 B')
  // As one input, so auto-indent and bracket closing leave the text as written.
  await page.keyboard.insertText(text)
}

test('the dwarf typed in assembles clean, and its size shows', async ({ page }) => {
  const errors = watch(page)
  await typeBot(page, DWARF)
  await expect(sizeChip(page)).toHaveText('23 / 512 B')
  await expect(toolbar(page).getByTitle("the bot's %name")).toHaveText('Dwarf')
  await expect(problems(page)).toContainText('no problems: the bot assembles clean.')
  await expect(page.locator('.cm-lint-marker')).toHaveCount(0)
  // The listing gutter: each line with bytes, its address and bytes.
  await expect(page.locator('.cm-listing-gutter')).toContainText('0x000F  C7 05 00 00')
  expect(errors).toEqual([])
})

test('mov [bx], 0 shows the size error at its column', async ({ page }) => {
  const errors = watch(page)
  await typeBot(page, DWARF)
  await expect(sizeChip(page)).toHaveText('23 / 512 B')
  await page.locator('.cm-line', { hasText: 'mov     word [di], 0' }).click()
  await page.keyboard.press('End')
  // Enter keeps the line's indentation: the new line starts in column 9.
  await page.keyboard.press('Enter')
  await page.keyboard.type('mov     [bx], 0')
  const lineNo = DWARF.split('\n').findIndex((line) => line.includes('word [di], 0')) + 2
  const row = problems(page).getByRole('button')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(`error${lineNo}:17operation size not specified`)
  await expect(row).toContainText('size-not-specified')
  await expect(page.locator('.cm-lintRange-error')).toHaveText('[bx]')
  await expect(page.locator('.cm-gutter-lint .cm-lint-marker-error')).toHaveCount(1)
  await expect(sizeChip(page)).toHaveText('— / 512 B')
  // A click on the problem puts the cursor on it.
  await page.locator('.cm-line').first().click()
  await row.click()
  const caret = await page.evaluate(() => {
    const selection = document.getSelection()
    const line = selection?.anchorNode?.parentElement?.closest('.cm-line')
    return line?.textContent ?? ''
  })
  expect(caret.trim()).toBe('mov     [bx], 0')
  expect(errors).toEqual([])
})

test('format lays the source out once, and again changes nothing', async ({ page }) => {
  const errors = watch(page)
  const messy = [
    '%NAME "Messy"',
    '%strategy "Bomb every 4th byte"',
    'START:CALL .HERE',
    '.HERE: POP BX',
    '  SUB BX,.HERE',
    '  lea di,[ BX + BOMB ]',
    '.LOOP:ADD DI,4',
    '  MOV WORD[DI],0',
    '  JMP .LOOP',
    'BOMB: dat',
    '',
  ].join('\n')
  await typeBot(page, messy)
  await expect(sizeChip(page)).toHaveText('21 / 512 B')
  await toolbar(page).getByRole('button', { name: 'format' }).click()
  await expect.poll(() => editorText(page)).toContain('START:  call    .HERE')
  const once = await editorText(page)
  expect(once).toContain('        mov     word [di], 0')
  expect(once).not.toBe(messy.replace(/\n$/, ''))
  await expect(sizeChip(page)).toHaveText('21 / 512 B')
  await toolbar(page).getByRole('button', { name: 'format' }).click()
  await expect(page.getByText('already formatted.')).toBeVisible()
  expect(await editorText(page)).toBe(once)
  expect(errors).toEqual([])
})

test('test vs imp shows the record, and watch opens the arena as tested', async ({ page }) => {
  const errors = watch(page)
  await typeBot(page, DWARF)
  await expect(sizeChip(page)).toHaveText('23 / 512 B')
  await toolbar(page).getByRole('button', { name: 'test vs ▾' }).click()
  await page.getByRole('menuitem', { name: 'imp', exact: true }).click()
  const record = toolbar(page).getByRole('status', { name: /vs Imp/ })
  await expect(record).toHaveText(/^W \d+ · T \d+ · L \d+ vs imp$/)
  const counts = (await record.textContent())?.match(/\d+/g)?.map(Number) ?? []
  expect(counts.reduce((sum, n) => sum + n, 0)).toBe(10)
  const link = toolbar(page).getByRole('link', { name: 'watch' })
  await expect(link).toHaveAttribute(
    'href',
    /^\/arena\?b=local:draft-[0-9a-f]{12},roster:imp&seed=\d+/,
  )
  await link.click()
  await expect(page).toHaveTitle('ASM BOTS // ARENA')
  const picked = page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')
  await expect(picked).toHaveCount(2)
  await expect(picked.first()).toHaveAttribute('aria-label', 'Dwarf')
  await expect(page.locator('button[name="fight"]')).toHaveText('fight · 2 bots · 10 rounds')
  expect(errors).toEqual([])
})

/** An element's box, laid out. */
async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('not laid out')
  return found
}

test('a first visit: the templates over the new bot, the coach mark under run', async ({
  page,
}) => {
  const errors = watch(page)
  await page.goto('/editor')
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
  const panel = page.getByRole('region', { name: 'new bot' })
  await expect(panel).toBeVisible()
  const tip = page.getByRole('note', { name: 'tip' })
  await expect(tip).toContainText('assemble runs as you type; press F5 to debug.')
  // The panel sits under the blank bot's five lines; the tip hangs under the run button.
  const last = await box(page.locator('.cm-line', { hasText: 'start:  jmp     start' }))
  expect((await box(panel)).y).toBeGreaterThan(last.y + last.height)
  const run = await box(page.getByRole('button', { name: 'run', exact: true }))
  const hint = await box(tip)
  expect(hint.y).toBeGreaterThan(run.y + run.height)
  expect(Math.abs(hint.x - run.x)).toBeLessThanOrEqual(1)
  // Each template's line shows whole.
  const cut = await panel
    .getByRole('listitem')
    .locator('span')
    .evaluateAll((spans) => spans.filter((span) => span.scrollWidth > span.clientWidth).length)
  expect(cut).toBe(0)
  // A press beside the panel reaches the editor (its box: the content runs on past it).
  const editor = await box(page.locator('.cm-editor'))
  const beside = await box(panel)
  expect(editor.x + editor.width - (beside.x + beside.width)).toBeGreaterThanOrEqual(16)
  await page.mouse.click(editor.x + editor.width - 8, beside.y + beside.height / 2)
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/)
  // A template starts the bot, and the panel goes.
  await panel.getByRole('button', { name: 'dwarf' }).click()
  await expect(sizeChip(page)).toHaveText('23 / 512 B')
  await expect(panel).toBeHidden()
  // got it: the tip never shows again.
  await tip.getByRole('button', { name: 'got it' }).click()
  await expect(tip).toBeHidden()
  await page.reload()
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
  await expect(page.getByRole('button', { name: 'run', exact: true })).toBeVisible()
  await expect(tip).toBeHidden()
  expect(errors).toEqual([])
})
