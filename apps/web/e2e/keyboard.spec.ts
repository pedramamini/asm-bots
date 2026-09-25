/**
 * The keyboard alone (DESIGN_SYSTEM §8): each of the four things a visitor comes to do, done with
 * Tab, Enter, Space, the arrows, and the app's keys, no pointer. Every control a flow uses is
 * reached by Tab (`tabTo`), which proves it is a Tab stop in a sensible place. Against the Worker,
 * for the hill: sign-in there skips GitHub (`DEV_FAKE_AUTH`).
 *
 * - Load two bots and fight, with the arena's live region saying where the battle stands.
 * - Write a bot and debug it: F11 steps, F9 breaks, F5 runs to the break.
 * - Create a tournament and watch it finish.
 * - Sign in, save a bot to the account from the editor, and submit it to a hill.
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
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

/** The tours seen already: this is about the keys, and the tours have their own spec. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('asmbots:settings') === null) {
      localStorage.setItem(
        'asmbots:settings',
        JSON.stringify({ state: { coachMarksSeen: ['arena', 'editor'] }, version: 1 }),
      )
    }
  })
})

/** Tabs until `target` has the focus, at most `max` times, and says how many it took. */
async function tabTo(page: Page, target: Locator, max = 120): Promise<number> {
  await expect(target).toBeVisible()
  for (let tabs = 0; tabs <= max; tabs++) {
    if (await target.evaluate((el) => el === document.activeElement)) return tabs
    // The source takes Tab for itself; Escape hands the next one back to the page.
    if (await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))) {
      await page.keyboard.press('Escape')
    }
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${target} in ${max} presses`)
}

/** Goes to `path` and waits for the app to draw it: `goto` returns before React renders. */
async function open(page: Page, path: string, title: RegExp | string): Promise<void> {
  await page.goto(path)
  await expect(page).toHaveTitle(title)
}

test('load two bots and fight, and hear where the battle stands', async ({ page }) => {
  const errors = watch(page)
  // Seed 1: the dwarf kills the imp at cycle 16,141, past the region's first word at 2 s.
  await open(page, '/arena?seed=1', 'ASM BOTS // ARENA')
  const cards = page.getByRole('list', { name: 'bots to add' }).getByRole('listitem')
  await expect(cards.first()).toBeVisible()
  // The first Tab stop skips the chrome: the next one is the page's own.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  await tabTo(page, cards.getByRole('button', { name: 'add Dwarf', exact: true }))
  await page.keyboard.press('Enter')
  await tabTo(page, cards.getByRole('button', { name: 'add Imp', exact: true }))
  await page.keyboard.press('Space')
  const picked = page.getByRole('list', { name: 'bots picked' }).getByRole('listitem')
  await expect(picked).toHaveCount(2)
  await tabTo(page, page.locator('button[name="fight"]'))
  await page.keyboard.press('Enter')
  const arena = page.getByRole('region', { name: 'arena' })
  await expect(arena.getByRole('button', { name: 'pause' })).toBeVisible()
  // Every 2 s while it plays, the live region says the cycle, the bots alive, and the leader.
  await expect(
    page.getByRole('status').filter({ hasText: /^cycle [\d,]+; 2 bots alive/ }),
  ).toHaveCount(1, { timeout: 5_000 })
  // Space pauses, whatever holds the focus that is not a control of its own.
  await page.keyboard.press('Space')
  await expect(arena.getByRole('button', { name: 'play' })).toBeVisible()
  // The arena itself is a Tab stop, and its keys move the view.
  const map = arena.getByRole('application')
  await tabTo(page, map)
  await page.keyboard.press('+')
  await expect(arena.getByText(/^zoom 2x$/)).toBeVisible()
  expect(errors).toEqual([])
})

/** A bot of its own: `mov ax, n` makes its bytes new, since a hill refuses the same bytes twice. */
function uniqueBot(name: string, n: number): string {
  return `%name "${name}"\n\nstart:  mov     ax, ${n}\n        mov     bx, ax\n        jmp     start\n`
}

/** Tabs to the source, empties it, and types `source` as one input. */
async function typeSource(page: Page, source: string): Promise<void> {
  await tabTo(page, page.getByRole('textbox', { name: 'bot source' }))
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(source)
}

test('write a bot and debug it', async ({ page }) => {
  const errors = watch(page)
  await open(page, '/editor', 'ASM BOTS // EDITOR')
  await typeSource(page, uniqueBot('stepper', 7))
  const toolbar = page.getByRole('toolbar', { name: 'editor' })
  await expect(toolbar.getByLabel(/^size /)).toHaveText('7 / 512 B')
  const ip = page.getByLabel('ip', { exact: true })
  const ax = page.getByLabel('ax', { exact: true })
  await expect(ip).toHaveValue(/^[0-9A-F]{4}$/)
  const base = Number.parseInt(await ip.inputValue(), 16)
  const hex = (v: number) => v.toString(16).toUpperCase().padStart(4, '0')
  // F11 steps one instruction: `mov ax, 7` then `mov bx, ax`.
  await page.keyboard.press('F11')
  await expect(ip).toHaveValue(hex(base + 3))
  await expect(ax).toHaveValue('0007')
  // F9 breaks on the cursor's line: the source's last line, `jmp start`.
  await tabTo(page, page.getByRole('textbox', { name: 'bot source' }))
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('F9')
  await expect(page.locator('.cm-debug-mark[data-breakpoint="on"]')).toHaveCount(1)
  // F5 runs to it.
  await page.keyboard.press('F5')
  await expect(ip).toHaveValue(hex(base + 5))
  await expect(page.locator('.cm-debug-ip')).toContainText('jmp     start')
  expect(errors).toEqual([])
})

test('create a tournament and watch it finish', async ({ page }) => {
  const errors = watch(page)
  // This browser's tournaments only: the server's championship has its own spec.
  await page.route('**/api/tournaments', (route) => route.fulfill({ json: { tournaments: [] } }))
  await open(page, '/tournaments', 'ASM BOTS // TOURNAMENTS')
  await tabTo(page, page.getByRole('button', { name: 'new tournament' }).first())
  await page.keyboard.press('Enter')
  const form = page.getByRole('dialog', { name: 'new tournament' })
  await expect(form).toBeVisible()
  await tabTo(page, form.getByRole('textbox', { name: 'name' }))
  await page.keyboard.type('keys cup')
  // The kind is a radio group: the arrows pick.
  await tabTo(page, form.getByRole('radio', { checked: true }).first())
  while (!(await form.getByRole('radio', { name: 'round robin' }).isChecked())) {
    await page.keyboard.press('ArrowRight')
  }
  for (const name of ['Imp', 'Dwarf', 'Stone']) {
    await tabTo(page, form.getByRole('checkbox', { name, exact: true }))
    await page.keyboard.press('Space')
  }
  await expect(form.getByRole('list', { name: 'entrants' }).getByRole('listitem')).toHaveCount(3)
  await tabTo(page, form.locator('button[name="create"]'))
  await page.keyboard.press('Enter')
  await expect(form).toBeHidden()
  await tabTo(page, page.getByRole('listitem', { name: 'keys cup' }).getByRole('link'))
  await page.keyboard.press('Enter')
  const matrix = page.getByRole('table', { name: 'results matrix' })
  await expect(matrix.locator('[data-played]')).toHaveCount(6, { timeout: 60_000 })
  expect(errors).toEqual([])
})

test('sign in, save a bot to the account, and submit it to a hill', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = watch(page)
  const login = `keys-${Date.now().toString(36)}`
  // An address of its own, past the Worker's 10 sign-ins a minute an address (a11y.spec.ts).
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': '10.12.0.1' })
  await page.route('**/api/auth/github?*', (route) =>
    route.continue({ url: `${route.request().url()}&as=${login}` }),
  )
  // The main hill: hills.spec.ts counts the rows of tiny, which a submission there would change.
  await open(page, '/hills/main', 'ASM BOTS // HILLS · main')
  await tabTo(page, page.getByRole('button', { name: 'sign in to submit', exact: true }))
  await page.keyboard.press('Enter')
  const pick = page.getByRole('dialog', { name: 'pick a handle' })
  await expect(pick).toBeVisible()
  await tabTo(page, pick.getByRole('button', { name: 'continue' }))
  await page.keyboard.press('Enter')
  await expect(pick).toBeHidden()

  // To the editor by its key chord, a bot of its own, and mod+s keeps it in the account.
  await page.keyboard.press('g')
  await page.keyboard.press('e')
  await expect(page).toHaveTitle('ASM BOTS // EDITOR')
  await typeSource(page, uniqueBot('keyboard', Date.now() % 0xffff))
  await expect(page.getByRole('toolbar', { name: 'editor' }).getByLabel(/^size /)).toHaveText(
    '7 / 512 B',
  )
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText(/^saved keyboard: v1 in your account\.$/)).toBeVisible()

  // Back to the hill by the chord and the hills table, and submit.
  await page.keyboard.press('Escape')
  await page.keyboard.press('g')
  await page.keyboard.press('h')
  await expect(page).toHaveTitle('ASM BOTS // HILLS')
  await tabTo(page, page.getByRole('link', { name: 'main', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveTitle('ASM BOTS // HILLS · main')
  await tabTo(page, page.getByRole('button', { name: 'submit', exact: true }))
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'submit to main' })
  await expect(dialog).toContainText('keyboard')
  await tabTo(page, dialog.getByRole('button', { name: 'submit', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page.getByText(/^submitted keyboard v1 to the main hill\.$/)).toBeVisible()
  await expect(page).toHaveURL(/[?&]submission=/)
  expect(errors).toEqual([])
})
