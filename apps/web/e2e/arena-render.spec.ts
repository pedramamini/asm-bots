/**
 * The arena renderer in Chromium (DESIGN_SYSTEM §5): the pixels WebGL2 draws for known frames,
 * the post effects, the camera, the 2D fallback, and a live battle in every theme. The page is
 * `e2e/harness/arena.html`, which only the dev server serves: DEV_URL says where it listens
 * (default: Vite's http://localhost:5173).
 */
import { expect, type Page, test } from '@playwright/test'
import type { MountOptions } from './harness/arena'
import { rosterBots } from './roster'

test.use({ baseURL: process.env.DEV_URL ?? 'http://localhost:5173' })

type Rgba = number[]
type Effects = { bloom: boolean; scanlines: boolean; vignette: boolean }

const NO_POST: Effects = { bloom: false, scanlines: false, vignette: false }
const THEMES = ['sentinel', 'amber', 'pedurple', 'ice', 'paper'] as const

/** Sentinel's first two bot hues, the arena's exec yellow, lattice, and ruler. */
const HUE0 = [0xff, 0x5c, 0x5c]
const HUE1 = [0xff, 0x9f, 0x43]
const EXEC = [0xff, 0xeb, 0x3b]
const LATTICE = [0x0e, 0x16, 0x0e]
const RULER = [0x3a, 0x5a, 0x3a]

interface Open {
  theme?: (typeof THEMES)[number]
  effects?: Effects
  mount?: MountOptions
  /** Takes WebGL2 away before the page loads. */
  noWebgl2?: boolean
}

/** The harness with the arena mounted and laid out. Returns the page's errors as they come. */
async function open(
  page: Page,
  { theme = 'sentinel', effects = NO_POST, mount = {}, noWebgl2 = false }: Open = {},
) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(
    ({ theme, noWebgl2 }) => {
      localStorage.setItem('theme', theme)
      if (!noWebgl2) return
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        return type === 'webgl2' ? null : getContext.call(this, type, ...(rest as []))
      } as typeof getContext
    },
    { theme, noWebgl2 },
  )
  await page.goto('/e2e/harness/arena.html')
  await page.waitForFunction(() => window.harness !== undefined)
  await page.evaluate(
    ({ effects, mount }) => {
      const settings = window.harness.settings.getState()
      for (const [effect, on] of Object.entries(effects)) settings.setEffect(effect as 'bloom', on)
      window.harness.mount(mount)
    },
    { effects, mount },
  )
  await page.waitForFunction(() => {
    try {
      window.harness.arena()
      return true
    } catch {
      return false
    }
  })
  return errors
}

/** Whether two colors match within `tolerance` per channel (GPU rounding). */
function near(got: Rgba | undefined, want: readonly number[], tolerance = 2): boolean {
  return got !== undefined && want.every((c, i) => Math.abs((got[i] as number) - c) <= tolerance)
}

function expectNear(got: Rgba | undefined, want: readonly number[], tolerance = 2): void {
  expect(near(got, want, tolerance), `${JSON.stringify(got)} ≈ ${JSON.stringify(want)}`).toBe(true)
}

const scale = (color: readonly number[], share: number) => color.map((c) => c * share)

test.describe('the WebGL2 renderer', () => {
  test('draws territory, flashes, and trails in the theme colors', async ({ page }) => {
    const errors = await open(page)
    const got = await page.evaluate(() => {
      const h = window.harness
      h.apply({
        owner: [
          [0x1000, 1],
          [0x1001, 2],
          [0x4000, 1],
        ],
        bytes: [[0x1000, 0x90]],
      })
      const territory = h.pixels([0x1000, 0x1001, 0x3000].map(h.cellCenter))
      h.apply({ writes: [[0x4000, 0x0141]], execs: [[0x5000, 0]] })
      const glows = h.pixels([0x4000, 0x5000].map(h.cellCenter))
      return { kind: h.arena().renderer?.kind, territory, glows }
    })
    expect(got.kind).toBe('webgl2')
    const [owned, ownedZero, empty] = got.territory
    expectNear(owned, [140, 51, 51])
    expectNear(owned, scale(HUE0, 0.55), 1)
    expectNear(ownedZero, scale(HUE1, 0.22), 1)
    expectNear(empty, [0, 0, 0], 0)
    expectNear(got.glows[0], [255, 255, 255])
    expectNear(got.glows[1], EXEC)
    expect(errors).toEqual([])
  })

  test("outlines each process's cell, the front of its queue brighter", async ({ page }) => {
    await open(page)
    const [front, behind, inside] = await page.evaluate(() => {
      const h = window.harness
      const { camera, canvas } = h.arena()
      camera.zoomBy(8)
      camera.centerOn(0x80, 0x80)
      h.apply({
        owner: [[0x8080, 1]],
        ips: [
          [0x8080, 0x100],
          [0x8090, 0],
        ],
      })
      const ratio = (canvas as HTMLCanvasElement).width / camera.width
      // The device pixel whose center is just left of the cell: the outline's.
      const outline = (address: number): [number, number] => {
        const left = (camera.originX + (address & 0xff) * camera.cell) * ratio
        const [, y] = h.cellCenter(address)
        return [(Math.floor(left - 0.5) + 0.5) / ratio, y]
      }
      return h.pixels([outline(0x8080), outline(0x8090), h.cellCenter(0x8080)])
    })
    expectNear(front, [255, 255, 255])
    expectNear(behind, scale([255, 255, 255], 0.55))
    expectNear(inside, scale(HUE0, 0.22))
  })

  test('draws the lattice from zoom 4, between the cells', async ({ page }) => {
    await open(page)
    const [below, edge, interior] = await page.evaluate(() => {
      const h = window.harness
      const { camera, canvas } = h.arena()
      const ratio = (canvas as HTMLCanvasElement).width / camera.width
      // The first device pixel inside cell 0x8081, at its left edge.
      const edge = (): [number, number] => {
        const left = (camera.originX + 0x81 * camera.cell) * ratio
        return [(Math.ceil(left - 0.5) + 0.5) / ratio, h.cellCenter(0x8081)[1]]
      }
      camera.zoomBy(3.9)
      const at3 = h.pixels([edge()])
      camera.zoomBy(4 / 3.9)
      camera.centerOn(0x81, 0x80)
      return [...at3, ...h.pixels([edge(), h.cellCenter(0x8081)])]
    })
    expectNear(below, [0, 0, 0], 0)
    expectNear(edge, LATTICE, 1)
    expectNear(interior, [0, 0, 0], 0)
  })

  test("fades a dead bot's territory 40% over 800 ms", async ({ page }) => {
    await open(page)
    const before = await page.evaluate(() => {
      const h = window.harness
      h.apply({ owner: [[0x1000, 1]], bytes: [[0x1000, 1]] })
      h.pixels([])
      h.apply({ botDeaths: [0] })
      return h.pixels([h.cellCenter(0x1000)])[0]
    })
    await page.waitForTimeout(900)
    const after = await page.evaluate(
      () => window.harness.pixels([window.harness.cellCenter(0x1000)])[0],
    )
    expectNear(before, scale(HUE0, 0.55), 1)
    const [r, g, b] = HUE0.map((c) => c / 255) as [number, number, number]
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
    expectNear(
      after,
      [r, g, b].map((c) => (c + (gray - c) * 0.4) * 255 * 0.55),
      1,
    )
  })

  test('draws again after the GPU takes its context away and gives it back', async ({ page }) => {
    const errors = await open(page)
    const lose = await page.evaluate(() => {
      const h = window.harness
      h.apply({ owner: [[0x1000, 1]], bytes: [[0x1000, 1]] })
      h.pixels([])
      const gl = (h.arena().canvas as HTMLCanvasElement).getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_lose_context')
      if (!gl || !ext) return false
      ;(window as unknown as { lose: WEBGL_lose_context }).lose = ext
      ext.loseContext()
      return gl.isContextLost()
    })
    expect(lose).toBe(true)
    const restored = await page.evaluate(
      () =>
        new Promise<number[] | undefined>((resolve) => {
          const h = window.harness
          const canvas = h.arena().canvas as HTMLCanvasElement
          canvas.addEventListener(
            'webglcontextrestored',
            // The renderer rebuilds in its own listener; read on the next frame.
            () => requestAnimationFrame(() => resolve(h.pixels([h.cellCenter(0x1000)])[0])),
            { once: true },
          )
          ;(window as unknown as { lose: WEBGL_lose_context }).lose.restoreContext()
        }),
    )
    expectNear(restored, scale(HUE0, 0.55), 1)
    expect(errors).toEqual([])
  })

  test('shows the minimap when zoomed in: the core, framed, in the corner', async ({ page }) => {
    await open(page)
    const got = await page.evaluate(() => {
      const h = window.harness
      const { camera } = h.arena()
      // Bot 0 owns every byte, non-zero.
      const all = Array.from({ length: 0x10000 }, (_, a): [number, number] => [a, 1])
      h.apply({ owner: all, bytes: all })
      const inside = (): [number, number] => {
        const box = camera.minimap()
        return box === null ? [0, 0] : [box.x + box.width * 0.25, box.y + box.height * 0.75]
      }
      camera.zoomBy(2)
      const box = camera.minimap()
      if (box === null) throw new Error('no minimap at zoom 2')
      const [frame, core] = h.pixels([[box.x - 0.5, box.y + box.height / 2], inside()])
      const point = inside()
      camera.reset()
      return { frame, core, atZoom1: h.pixels([point])[0], none: camera.minimap() }
    })
    expectNear(got.frame, RULER, 1)
    expectNear(got.core, scale(HUE0, 0.55), 1)
    expect(got.none).toBeNull()
    expectNear(got.atZoom1, scale(HUE0, 0.55), 1)
  })
})

test.describe('the post effects', () => {
  test('bloom spreads a flash past its cell', async ({ page }) => {
    await open(page, { effects: { bloom: true, scanlines: false, vignette: false } })
    const [lit, dark] = await page.evaluate(() => {
      const h = window.harness
      const { camera, renderer } = h.arena()
      camera.zoomBy(8)
      camera.centerOn(0x80, 0x80)
      h.apply({ owner: [], bytes: [] })
      h.apply({ writes: [[0x8080, 0x0101]] })
      const [x, y] = h.cellCenter(0x8080)
      const beside: [number, number] = [x + camera.cell / 2 + 4, y]
      const lit = h.pixels([beside])[0]
      window.harness.settings.getState().setEffect('bloom', false)
      renderer?.setEffects(window.harness.settings.getState().effects)
      return [lit, h.pixels([beside])[0]]
    })
    expect((lit?.[0] as number) + (lit?.[1] as number)).toBeGreaterThan(40)
    expectNear(dark, [0, 0, 0], 0)
  })

  test('the vignette darkens the corners, scanlines the rows, and paper has neither', async ({
    page,
  }) => {
    await open(page, { effects: { bloom: false, scanlines: false, vignette: true } })
    /** Red at the core's center, its corner, and the two rows under the center, with `effects`. */
    const probe = (effects: Partial<Effects>) =>
      page.evaluate((effects) => {
        const h = window.harness
        const settings = h.settings.getState()
        for (const [effect, on] of Object.entries(effects))
          settings.setEffect(effect as 'bloom', on)
        h.arena().renderer?.setEffects(h.settings.getState().effects)
        const all = Array.from({ length: 0x10000 }, (_, a): [number, number] => [a, 1])
        h.apply({ owner: all, bytes: all })
        const [x, y] = h.cellCenter(0x8080)
        const corner = h.cellCenter(0x0000)
        const px = h.pixels([[x, y], corner, [x, y + 1], [x, y + 2]])
        return px.map((p) => p[0] as number)
      }, effects)
    const [center, corner] = await probe({})
    expect(center).toBe(140)
    expect(corner).toBeLessThan(120)

    const [top, , ...below] = await probe({ scanlines: true, vignette: false })
    const rows = [top as number, ...below]
    expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThanOrEqual(8)

    await page.evaluate(() => window.harness.settings.getState().setTheme('paper'))
    await page.waitForTimeout(50)
    const paper = await probe({ scanlines: true, vignette: true })
    expect(new Set(paper)).toEqual(new Set([140]))
  })
})

test.describe('the camera', () => {
  test('zooms at the cursor with the wheel, pans with a drag, and resets with 0', async ({
    page,
  }) => {
    await open(page)
    const camera = () =>
      page.evaluate(() => {
        const { camera } = window.harness.arena()
        return {
          zoom: camera.zoom,
          x: camera.originX,
          y: camera.originY,
          under: camera.addressAt(300, 200),
        }
      })
    const start = await camera()
    await page.mouse.move(300, 200)
    await page.mouse.wheel(0, -400)
    await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(2)
    const zoomed = await camera()
    expect(zoomed.under).toBe(start.under)

    await page.mouse.down()
    await page.mouse.move(260, 170, { steps: 4 })
    await page.mouse.up()
    const dragged = await camera()
    expect(dragged.x).toBeCloseTo(zoomed.x - 40, 6)
    expect(dragged.y).toBeCloseTo(zoomed.y - 30, 6)

    await page.keyboard.press('ArrowLeft')
    expect((await camera()).x).toBeGreaterThan(dragged.x)
    await page.keyboard.press('0')
    expect(await camera()).toEqual(start)
  })
})

test.describe('the 2D fallback', () => {
  for (const [name, options] of [
    ['when asked', { mount: { renderer: '2d' } }],
    ['where WebGL2 is missing', { noWebgl2: true }],
  ] as const) {
    test(`draws the same colors ${name}, and shows a 2D chip`, async ({ page }) => {
      const errors = await open(page, options)
      await expect(page.getByText('2D', { exact: true })).toBeVisible()
      await expect(page.getByRole('application', { name: 'arena' })).toHaveAttribute(
        'data-renderer',
        '2d',
      )
      const [owned, ownedZero, empty, write, exec] = await page.evaluate(() => {
        const h = window.harness
        h.apply({
          owner: [
            [0x1000, 1],
            [0x1001, 2],
            [0x4000, 1],
          ],
          bytes: [[0x1000, 0x90]],
        })
        h.pixels([])
        h.apply({ writes: [[0x4000, 0x0141]], execs: [[0x5000, 0]] })
        return h.pixels([0x1000, 0x1001, 0x3000, 0x4000, 0x5000].map(h.cellCenter))
      })
      expectNear(owned, scale(HUE0, 0.55), 1)
      expectNear(ownedZero, scale(HUE1, 0.22), 1)
      expectNear(empty, [0, 0, 0], 0)
      expectNear(write, [255, 255, 255], 1)
      expectNear(exec, EXEC, 1)
      expect(errors).toEqual([])
    })
  }
})

test('plays a battle in every theme without an error', async ({ page }, testInfo) => {
  const errors = await open(page, { effects: { bloom: true, scanlines: true, vignette: true } })
  const bots = rosterBots(['dwarf', 'paper', 'stone', 'silk'])
  await page.evaluate(async (bots) => {
    const h = window.harness
    await h.load(bots, { seed: 3 })
    h.client.speed(200)
    h.client.play()
  }, bots)
  for (const theme of THEMES) {
    await page.evaluate((theme) => window.harness.settings.getState().setTheme(theme), theme)
    await page.waitForTimeout(400)
    await testInfo.attach(`arena-${theme}`, {
      body: await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 600 } }),
      contentType: 'image/png',
    })
  }
  const state = await page.evaluate(() => window.harness.client.store.getState())
  expect(state.cycle).toBeGreaterThan(5_000)
  expect(errors).toEqual([])
})
