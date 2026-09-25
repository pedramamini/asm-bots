/**
 * Focus (DESIGN_SYSTEM §8): the kit's focus ring shows on `--panel` in every theme, at 3:1 or more
 * against the panel it is drawn on (the contrast script checks the color; this checks the pixels
 * the browser draws), and every Tab stop of every route draws a visible focus indicator. Both
 * compare two shots of the same clip, focused and not (WCAG 2.4.13 measures an indicator that way).
 */
import { type ElementHandle, expect, type Page, test } from '@playwright/test'
import { THEMES } from '../../../packages/ui/src/themes'
import { WORKER } from '../playwright.config'
import { changedPixels, decodePng, type Pixels } from './png'

test.use({ baseURL: WORKER, deviceScaleFactor: 1 })

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** `box` grown by `by` px on each side and cut to the viewport. */
function around(page: Page, box: Box, by: number): Box {
  const view = page.viewportSize() ?? { width: 1280, height: 720 }
  const x = Math.max(0, Math.floor(box.x - by))
  const y = Math.max(0, Math.floor(box.y - by))
  const right = Math.min(view.width, Math.ceil(box.x + box.width + by))
  const bottom = Math.min(view.height, Math.ceil(box.y + box.height + by))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

/** A shot of `clip`: its PNG, and its pixels. */
async function shot(page: Page, clip: Box): Promise<{ png: Uint8Array; pixels: Pixels }> {
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  return { png, pixels: decodePng(png) }
}

/**
 * How many pixels around the focused element change by 3:1 or more when it loses focus, and the
 * perimeter of its box: a ring all the way round changes about that many.
 */
async function indicator(
  page: Page,
  target: ElementHandle<Node>,
): Promise<{ changed: number; ring: number }> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('the focused element has no box')
  const clip = around(page, box, 4)
  const focused = await shot(page, clip)
  await target.evaluate((el) => (el as HTMLElement).blur())
  const blurred = await shot(page, clip)
  // FOCUS_DEBUG=<dir> keeps both shots of every stop, to look at one that fails.
  const dir = process.env.FOCUS_DEBUG
  if (dir) {
    const { writeFileSync } = await import('node:fs')
    const tag = `${Math.round(box.x)}-${Math.round(box.y)}`
    writeFileSync(`${dir}/${tag}-focused.png`, focused.png)
    writeFileSync(`${dir}/${tag}-blurred.png`, blurred.png)
  }
  // Back where it was, still from the keyboard: the next Tab goes on from here.
  await target.evaluate((el) => (el as HTMLElement).focus())
  return {
    changed: changedPixels(focused.pixels, blurred.pixels),
    ring: 2 * (box.width + box.height),
  }
}

/** The focused element, held as it is: a `:focus` locator loses it on blur. */
async function focused(page: Page): Promise<ElementHandle<Node> | null> {
  const handle = await page.evaluateHandle(() => document.activeElement)
  const element = handle.asElement()
  if (element === null) return null
  const isBody = await element.evaluate((el) => el === document.body)
  return isBody ? null : element
}

/** A new page in `theme`, the tours already seen: a coach mark would stand over the controls. */
async function setUp(page: Page, theme: string): Promise<void> {
  await page.addInitScript((name) => {
    localStorage.setItem('theme', name)
    localStorage.setItem(
      'asmbots:settings',
      JSON.stringify({ state: { coachMarksSeen: ['arena', 'editor'] }, version: 1 }),
    )
  }, theme)
}

for (const theme of THEMES) {
  test(`${theme}: the focus ring shows at 3:1 on --panel`, async ({ page }) => {
    await setUp(page, theme)
    await page.goto('/settings')
    await expect(page).toHaveTitle('ASM BOTS // SETTINGS')
    // The first key sets the keyboard's modality: from here focus shows its ring.
    await page.keyboard.press('Tab')
    // A toggle, a button, and a radio swatch, each on its panel.
    const targets = [
      page.getByRole('region', { name: 'sound' }).getByRole('button', { name: 'sound' }),
      page.getByRole('region', { name: 'arena effects' }).locator('button:enabled').first(),
      page.getByRole('region', { name: 'theme' }).getByRole('radio', { name: 'ice' }),
    ]
    for (const locator of targets) {
      await locator.focus()
      await expect(locator).toBeFocused()
      const target = await focused(page)
      if (target === null) throw new Error('nothing focused')
      const { changed, ring } = await indicator(page, target)
      const name = await target.evaluate((el) => el.textContent?.trim() || (el as Element).tagName)
      expect(changed, `${theme}: the ring around "${name}"`).toBeGreaterThanOrEqual(ring * 0.9)
    }
  })
}

/** The element as a failure names it: tag, label or text, classes. */
function describe(target: ElementHandle<Node>): Promise<string> {
  return target.evaluate((node) => {
    const el = node as Element
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()} "${label}" .${el.className.toString().slice(0, 80)}`
  })
}

/** The routes the Tab walk covers: every page's own controls, the frame's on the first. */
const WALK = [
  '/',
  '/arena',
  '/arena?b=roster:dwarf,roster:imp&seed=1&fight',
  '/editor',
  '/tournaments',
  '/hills',
  '/hills/main',
  '/bots/roster-dwarf',
  '/u/system',
  '/docs',
  '/docs/start-here',
  '/settings',
  '/no/such/address',
  '/embed/arena?b=roster:dwarf,roster:imp&seed=1',
]

/** Most Tab stops a walk takes: past it, a page has a trap or far too many stops. */
const MAX_STOPS = 400

for (const path of WALK) {
  test(`every Tab stop on ${path} shows its focus`, async ({ page }) => {
    test.setTimeout(120_000)
    await setUp(page, 'sentinel')
    const fight = path.endsWith('&fight')
    await page.goto(fight ? path.slice(0, -'&fight'.length) : path)
    await expect(page).toHaveTitle(/^ASM BOTS/)
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    if (fight) {
      await page.locator('button[name="fight"]').click()
      await page.getByRole('button', { name: 'pause' }).click()
    }
    const unseen: string[] = []
    const seen = new Set<string>()
    // Focus leaves the page for the browser's own chrome once a round: Tab on brings it back.
    let away = 0
    for (let stop = 0; stop < MAX_STOPS; stop++) {
      // The source takes Tab for itself; Escape hands the next one back to the page.
      if (await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))) {
        await page.keyboard.press('Escape')
      }
      await page.keyboard.press('Tab')
      const target = await focused(page)
      if (target === null) {
        if (++away > 2) break
        continue
      }
      const id = await target.evaluate((el) => {
        const path: string[] = []
        for (let n: Element | null = el as Element; n !== null; n = n.parentElement) {
          path.unshift(`${n.tagName}:${[...(n.parentElement?.children ?? [])].indexOf(n)}`)
        }
        return path.join('/')
      })
      // Round again: the walk is over.
      if (seen.has(id)) break
      seen.add(id)
      let box = await target.boundingBox()
      if (box === null || box.width === 0 || box.height === 0) continue
      const view = page.viewportSize() ?? { width: 1280, height: 720 }
      const outside = (b: Box) =>
        b.x + b.width <= 0 || b.y + b.height <= 0 || b.x >= view.width || b.y >= view.height
      if (outside(box)) {
        await target.evaluate((el) => (el as Element).scrollIntoView({ block: 'nearest' }))
        box = await target.boundingBox()
        if (box === null || outside(box)) {
          unseen.push(`${await describe(target)}: focused out of sight`)
          continue
        }
      }
      const { changed, ring } = await indicator(page, target)
      if (changed < Math.min(ring * 0.5, 60)) {
        unseen.push(
          `${await describe(target)}: ${changed} px changed of a ${Math.round(ring)} px ring`,
        )
      }
    }
    test.info().annotations.push({ type: 'stops', description: String(seen.size) })
    expect(seen.size, 'a walk of more than one stop').toBeGreaterThan(1)
    expect(seen.size, 'a walk that ends').toBeLessThan(MAX_STOPS)
    expect(unseen).toEqual([])
  })
}
