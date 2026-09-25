/**
 * The editor's layout in a real browser (PRODUCT_SPEC §3): a panel dragged by its grip lands
 * beside another, the source keeps its text as it moves, a divider drag sizes two panels, and the
 * layout is the same after a reload. Escape drops a drag; the layout menu puts the default back.
 */
import { expect, type Page, test } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 950 } })

/** The page's errors and console errors, as they come. */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

const slot = (page: Page, id: string) => page.locator(`[data-panel="${id}"]`)

async function box(page: Page, id: string) {
  const found = await slot(page, id).boundingBox()
  if (found === null) throw new Error(`no box for ${id}`)
  return found
}

/**
 * Drags panel `id` by the grip in its title row (a narrow tile's title may truncate away) to
 * `x, y`; `drop: false` lets go after Escape.
 */
async function drag(page: Page, id: string, x: number, y: number, drop = true) {
  const grip = await slot(page, id).locator('[data-panel-grip]').first().boundingBox()
  if (grip === null) throw new Error(`no grip for ${id}`)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x - 30, grip.y + 30, { steps: 4 })
  await page.mouse.move(x, y, { steps: 10 })
  if (!drop) await page.keyboard.press('Escape')
  await page.mouse.up()
}

test('drags the memory beside the source, sizes the library, and keeps it all on a reload', async ({
  page,
}) => {
  const errors = watch(page)
  await page.addInitScript(() =>
    localStorage.setItem(
      'asmbots:settings',
      JSON.stringify({ state: { coachMarksSeen: ['editor'] }, version: 1 }),
    ),
  )
  await page.goto('/editor?b=roster:gate,roster:imp&seed=1')
  await expect(page.locator('.cm-editor')).toBeVisible()
  await expect(page.getByRole('region', { name: 'memory' })).toBeVisible()
  const text = await page.locator('.cm-content').textContent()

  // Escape drops a drag: nothing moves.
  const source = await box(page, 'source')
  const before = await box(page, 'memory')
  await drag(page, 'memory', source.x + 12, source.y + source.height / 2, false)
  expect(await box(page, 'memory')).toEqual(before)

  // Near the source's left edge: the memory lands left of it, and the two share its space.
  await drag(page, 'memory', source.x + 12, source.y + source.height / 2)
  await expect
    .poll(async () => (await box(page, 'memory')).x)
    .toBeLessThan((await box(page, 'source')).x)
  const [memory, moved] = [await box(page, 'memory'), await box(page, 'source')]
  expect(Math.abs(memory.y - moved.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(memory.width - moved.width)).toBeLessThanOrEqual(2)
  await expect(page.locator('.cm-content')).toHaveText(text ?? '')

  // The library's divider, dragged 120 px right: the library is that much wider.
  const library = await box(page, 'library')
  const divider = page.getByRole('separator', { name: 'library width' })
  const grip = await divider.boundingBox()
  if (grip === null) throw new Error('no divider')
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2, { steps: 6 })
  await page.mouse.up()
  const wider = await box(page, 'library')
  expect(Math.abs(wider.width - (library.width + 120))).toBeLessThanOrEqual(3)

  // A reload keeps the layout.
  await page.reload()
  await expect(page.locator('.cm-editor')).toBeVisible()
  expect((await box(page, 'memory')).x).toBeLessThan((await box(page, 'source')).x)
  expect(Math.abs((await box(page, 'library')).width - wider.width)).toBeLessThanOrEqual(2)

  // The default layout puts it all back.
  await page.getByRole('button', { name: 'layout ▾' }).click()
  await page.getByRole('menuitem', { name: 'default layout' }).click()
  await expect
    .poll(async () => (await box(page, 'memory')).x)
    .toBeGreaterThan((await box(page, 'source')).x)
  expect(errors).toEqual([])
})
