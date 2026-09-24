/**
 * The debugger in Chromium, against the production build: dwarf vs imp at seed 1 (the arena's
 * `open in debugger` link), a breakpoint pressed into the gutter on the dwarf's bomb line, a run to
 * it (the IP line in the editor, the row and its address in the memory panel, the registers), and
 * step back twice, which puts the registers back. Then the keys: F9 on the cursor's line, F5, F11.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'

const APP = fileURLToPath(new URL('..', import.meta.url))

/**
 * The dwarf's base in dwarf vs imp at seed 1, as the engine places it: Bun runs the engine, since
 * the runner cannot import the roster (`e2e/roster.ts`). The arena's duel is the engine's defaults.
 */
const BASE = Number(
  execFileSync(
    'bun',
    [
      '--eval',
      `import { fighter } from '@asmbots/bots'
       import { Battle } from '@asmbots/engine'
       // A string: the runner's FORCE_COLOR would color a number.
       console.log(String(new Battle([fighter('dwarf'), fighter('imp')], { seed: 1 }).bots[0].base))`,
    ],
    { cwd: APP, encoding: 'utf8' },
  ).trim(),
)
/** `mov word [di], 0`, the dwarf's bomb, 15 bytes into it. */
const BOMB = BASE + 0x0f

const hex = (v: number) => v.toString(16).toUpperCase().padStart(4, '0')

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

const register = (page: Page, name: string) => page.getByLabel(name, { exact: true })
const bombLine = (page: Page) => page.locator('.cm-line', { hasText: 'mov     word [di], 0' })
const memoryRow = (page: Page) =>
  page.getByRole('list', { name: 'memory' }).locator('[aria-current="true"]')

/** Opens dwarf vs imp at seed 1, and waits until the debugger has loaded it. */
async function dwarfVsImp(page: Page) {
  await page.goto('/editor?b=roster:dwarf,roster:imp&seed=1')
  await expect(page).toHaveTitle(/^ASM BOTS \/\/ EDITOR/)
  await expect(register(page, 'ip')).toHaveValue(hex(BASE))
}

test('a breakpoint on the bomb line, run to it, and step back twice', async ({ page }) => {
  const errors = watch(page)
  await dwarfVsImp(page)
  // A press on the breakpoint gutter, level with the bomb line, in view first.
  await bombLine(page).scrollIntoViewIfNeeded()
  const line = await bombLine(page).boundingBox()
  const gutter = await page.locator('.cm-debug-gutter').boundingBox()
  if (line === null || gutter === null) throw new Error('the editor is not laid out')
  await page.mouse.click(gutter.x + gutter.width / 2, line.y + line.height / 2)
  await expect(page.locator('.cm-debug-mark[data-breakpoint="on"]')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'breakpoints' })).toContainText(`0x${hex(BOMB)}`)

  await page.getByRole('button', { name: 'run', exact: true }).click()
  await expect(page.locator('.cm-debug-ip')).toContainText('mov     word [di], 0')
  await expect(memoryRow(page)).toContainText(`0x${hex(BOMB)}`)
  await expect(memoryRow(page)).toContainText('mov word [di], 0')
  await expect(register(page, 'ip')).toHaveValue(hex(BOMB))
  await expect(register(page, 'di')).toHaveValue(hex(BASE - 4))
  await expect(page.getByRole('list', { name: 'breakpoints' })).toContainText('1 hit')

  // A run steps back a cycle at a time: to `sub di, 4`, then to `mov cx, LAP` before it.
  const back = page.getByRole('button', { name: 'step back' })
  await back.click()
  await expect(register(page, 'ip')).toHaveValue(hex(BASE + 0x0c))
  await expect(register(page, 'di')).toHaveValue(hex(BASE))
  await back.click()
  await expect(register(page, 'ip')).toHaveValue(hex(BASE + 0x09))
  await expect(register(page, 'di')).toHaveValue(hex(BASE))
  await expect(page.locator('.cm-debug-ip')).toContainText('mov     cx, LAP')
  await expect(memoryRow(page)).toContainText(`0x${hex(BASE + 0x09)}`)
  expect(errors).toEqual([])
})

test('F9 marks the cursor line, F5 runs to it, F11 steps on', async ({ page }) => {
  const errors = watch(page)
  await dwarfVsImp(page)
  await bombLine(page).click()
  await page.keyboard.press('F9')
  await expect(page.locator('.cm-debug-mark[data-breakpoint="on"]')).toHaveCount(1)
  // F5 runs, and the page does not reload.
  await page.keyboard.press('F5')
  await expect(register(page, 'ip')).toHaveValue(hex(BOMB))
  await page.keyboard.press('F11')
  await expect(register(page, 'ip')).toHaveValue(hex(BASE + 0x13))
  await expect(page.locator('.cm-debug-ip')).toContainText('loop    .bomb')
  // The arena strip draws the battle.
  await expect(page.getByRole('application', { name: 'debug arena' })).toHaveAttribute(
    'data-renderer',
    /webgl2|2d/,
  )
  expect(errors).toEqual([])
})
