/**
 * The UI kit's gallery in every theme, for the visual review (EXEC 2.1): per theme, the whole page
 * with a menu and a tooltip open and each `data-force` state forced, and the modal over a live
 * toast stack. The PNGs land in e2e/__screenshots__/ for review; nothing is compared.
 *
 * The gallery is a development route, so the spec runs against the dev server, not the preview:
 * GALLERY_URL says where it listens (default: Vite's http://localhost:5173).
 */
import { fileURLToPath } from 'node:url'
import { THEMES, type Theme } from '@asmbots/ui/themes'
import { type CDPSession, expect, type Locator, type Page, test } from '@playwright/test'

const SHOTS = fileURLToPath(new URL('./__screenshots__/', import.meta.url))
const WIDTH = 1440
const SCALE = 2
/** Chrome's largest capture, device px a side. */
const MAX_CAPTURE = 16_384

test.use({
  baseURL: process.env.GALLERY_URL ?? 'http://localhost:5173',
  viewport: { width: WIDTH, height: 900 },
  deviceScaleFactor: SCALE,
})

for (const theme of THEMES) {
  test(`gallery · ${theme}`, async ({ page }) => {
    const errors = await open(page, theme)
    // One viewport as tall as the page, so the menu and the tooltip (fixed, in the top layer)
    // sit beside their triggers in the shot.
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(height * SCALE, 'the gallery outgrew one capture').toBeLessThanOrEqual(MAX_CAPTURE)
    await page.setViewportSize({ width: WIDTH, height })
    const session = await forceStates(page)

    await region(page, 'Menu').getByRole('button', { name: 'templates' }).click()
    await placed(page.getByRole('menu'))
    await region(page, 'Tooltip').getByRole('button', { name: 'step back' }).hover()
    await placed(page.locator('[role=tooltip]'))

    await page.screenshot({ path: `${SHOTS}gallery-${theme}.png`, animations: 'disabled' })
    await session.detach()
    expect(errors).toEqual([])
  })

  test(`modal · ${theme}`, async ({ page }) => {
    const errors = await open(page, theme)
    await page.getByRole('button', { name: 'send 3 toasts' }).click()
    await expect(
      page.getByRole('region', { name: 'notifications' }).getByRole('listitem'),
    ).toHaveCount(3)
    await page.getByRole('button', { name: 'open md' }).click()
    await expect(page.getByRole('dialog', { name: 'submit to hill' })).toBeVisible()

    await page.screenshot({ path: `${SHOTS}modal-${theme}.png`, animations: 'disabled' })
    expect(errors).toEqual([])
  })
}

/** Opens the gallery in `theme` once its fonts are in; returns the page's errors as they come. */
async function open(page: Page, theme: Theme): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`/_gallery?theme=${theme}`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect(page.locator('[data-gallery-ready]')).toBeAttached()
  return errors
}

/** Waits for a menu or a tooltip to show where floating-ui put it (it is clear until then). */
async function placed(layer: Locator): Promise<void> {
  await expect(layer).toBeVisible()
  await expect(layer).not.toHaveClass(/opacity-0/)
}

/** A primitive's sheet: the panel region the gallery names after the component. */
function region(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

/**
 * Forces each state the gallery marks: `data-force="hover"` or `"focus focus-visible"` on the
 * element, or on its descendant `data-force-target` names. DevTools holds the pseudo-classes while
 * the returned session lives.
 */
async function forceStates(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const { root } = await session.send('DOM.getDocument', { depth: -1 })
  const { nodeIds } = await session.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: '[data-force]',
  })
  for (const nodeId of nodeIds) {
    const { attributes } = await session.send('DOM.getAttributes', { nodeId })
    const value = (name: string) => {
      // [name, value, name, value, …]
      const at = attributes.findIndex((attribute, i) => i % 2 === 0 && attribute === name)
      return at < 0 ? undefined : attributes[at + 1]
    }
    const target = value('data-force-target')
    const node = target
      ? (await session.send('DOM.querySelector', { nodeId, selector: target })).nodeId
      : nodeId
    await session.send('CSS.forcePseudoState', {
      nodeId: node,
      forcedPseudoClasses: (value('data-force') ?? '').split(' '),
    })
  }
  return session
}
