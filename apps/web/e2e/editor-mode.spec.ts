/**
 * The x16c editor mode in Chromium (src/features/editor/cm): each token class in its theme color
 * in all nine themes, one editor recolored in place by a theme switch, the hover card, and the
 * completion popup with its card. The page is `e2e/harness/editor.html`, which only the dev server
 * serves: DEV_URL says where it listens (default: Vite's http://localhost:5173).
 */
import { expect, type Page, test } from '@playwright/test'
// For its `window.editorHarness` type.
import type {} from './harness/editor'

test.use({ baseURL: process.env.DEV_URL ?? 'http://localhost:5173' })

const THEMES = ['sentinel', 'amber', 'pedurple', 'ice', 'paper'] as const

/** A token of the dwarf, the text of its span, and the kit token its color must be. */
const COLORED: [what: string, text: string, token: string][] = [
  ['mnemonic', 'call', '--accent-fg'],
  ['register', 'bx', '--text-bright'],
  ['number', '4', '--info'],
  ['string', '"Dwarf"', '--info'],
  ['label', 'lap', '--warn'],
  ['directive', '%name', '--accent-2'],
  ['size', 'word', '--text-muted'],
  ['comment', '; bytes between bombs', '--text-muted'],
]

/** The harness with its editor mounted. Returns the page's errors as they come. */
async function open(page: Page, theme: (typeof THEMES)[number] = 'sentinel') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript((theme) => localStorage.setItem('theme', theme), theme)
  await page.goto('/e2e/harness/editor.html')
  await page.waitForFunction(() => window.editorHarness !== undefined)
  return errors
}

/** Each token's color and the color its kit token resolves to, in the page's current theme. */
function colors(page: Page) {
  return page.evaluate((colored) => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const resolve = (token: string) => {
      probe.style.color = `var(${token})`
      return getComputedStyle(probe).color
    }
    const spans = [...document.querySelectorAll('.cm-line span')]
    const out = colored.map(([what, text, token]) => {
      const span = spans.find((s) => s.textContent === text)
      return [what, span === undefined ? 'no span' : getComputedStyle(span).color, resolve(token)]
    })
    const editor = document.querySelector('.cm-editor') as HTMLElement
    out.push(['background', getComputedStyle(editor).backgroundColor, resolve('--panel-2')])
    probe.remove()
    return out
  }, COLORED)
}

test('colors each token class from the theme, and recolors the same editor on a switch', async ({
  page,
}, testInfo) => {
  const errors = await open(page)
  await page.evaluate(() => {
    ;(document.querySelector('.cm-editor') as HTMLElement).dataset.probe = 'first'
  })
  for (const theme of THEMES) {
    await page.evaluate((theme) => window.editorHarness.setTheme(theme), theme)
    for (const [what, got, want] of await colors(page)) {
      expect([theme, what, got]).toEqual([theme, what, want])
    }
    await testInfo.attach(`editor-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }
  // The same editor all along: nothing was created again.
  const probe = await page.evaluate(
    () => (document.querySelector('.cm-editor') as HTMLElement).dataset.probe,
  )
  expect(probe).toBe('first')
  expect(await page.locator('.cm-editor').count()).toBe(1)
  expect(errors).toEqual([])
})

test('shows the reference card of a mnemonic on hover', async ({ page }, testInfo) => {
  const errors = await open(page)
  await page
    .locator('.cm-line span', { hasText: /^call$/ })
    .first()
    .hover()
  const card = page.locator('.cm-tooltip-hover .cm-x16c-card')
  await expect(card).toBeVisible()
  await expect(card.locator('.cm-x16c-card-name')).toHaveText('call')
  await expect(card.locator('.cm-x16c-card-code').first()).toHaveText('call rel16')
  await expect(card.locator('.cm-x16c-card-bytes').first()).toHaveText('E8 cw')
  await testInfo.attach('hover', { body: await page.screenshot(), contentType: 'image/png' })
  // Off the word, the card goes.
  await page.mouse.move(700, 580)
  await expect(card).toBeHidden()
  expect(errors).toEqual([])
})

test('offers movsw after mov, with the card of the one picked', async ({ page }, testInfo) => {
  const errors = await open(page, 'paper')
  await page.evaluate(() => {
    const { view } = window.editorHarness
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('        mov')
  const popup = page.locator('.cm-tooltip-autocomplete')
  await expect(popup).toBeVisible()
  await expect(popup.locator('li').first()).toContainText('mov')
  await expect(popup.locator('li', { hasText: 'movsw' })).toBeVisible()
  await expect(page.locator('.cm-completionInfo .cm-x16c-card-name')).toHaveText('mov')
  // The popup ignores keys for CodeMirror's `interactionDelay` (75 ms) after it opens: press on
  // until the selection is on movsw.
  const selected = popup.locator('li[aria-selected]')
  await expect(async () => {
    if (!(await selected.textContent())?.startsWith('movsw')) await page.keyboard.press('ArrowDown')
    await expect(selected).toContainText('movsw', { timeout: 100 })
  }).toPass()
  await expect(page.locator('.cm-completionInfo .cm-x16c-card-name')).toHaveText('movsw')
  await testInfo.attach('completion', { body: await page.screenshot(), contentType: 'image/png' })
  await page.keyboard.press('Enter')
  const last = await page.evaluate(() => {
    const { doc } = window.editorHarness.view.state
    return doc.line(doc.lines).text
  })
  expect(last).toBe('        movsw')
  expect(errors).toEqual([])
})
