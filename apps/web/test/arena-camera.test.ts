/**
 * The arena's camera (`render/camera.ts`) and the rulers it places (`render/overlay.ts`):
 * pure geometry, in CSS px.
 */
import { describe, expect, it } from 'bun:test'
import {
  Camera,
  COLUMN_RULER,
  LATTICE_ZOOM,
  MAX_ZOOM,
  RULER_MARGIN,
} from '../src/features/arena/render/camera'
import { columnLabels, rowLabels } from '../src/features/arena/render/overlay'

/** A 1000 x 720 canvas: the view is 956 x 720, so the core fits by height, 2.8125 px a cell. */
function camera(): Camera {
  const c = new Camera()
  c.resize(1000, 720)
  return c
}

describe('Camera', () => {
  it('fits the whole core at zoom 1, centered in the view right of the ruler', () => {
    const c = camera()
    expect(c.view).toEqual({ x: RULER_MARGIN, y: 0, width: 956, height: 720 })
    expect(c.cell).toBe(720 / 256)
    expect(c.originX).toBe(RULER_MARGIN + (956 - 720) / 2)
    expect(c.originY).toBe(0)
    expect(c.visible()).toEqual({ left: 0, top: 0, right: 256, bottom: 256 })
    expect(c.lattice).toBe(false)
    expect(c.minimap()).toBeNull()
  })

  it('names the byte under a point, and none in the ruler margin or off the core', () => {
    const c = camera()
    const x = c.originX + 0x34 * c.cell + 1
    const y = c.originY + 0x12 * c.cell + 1
    expect(c.addressAt(x, y)).toBe(0x1234)
    expect(c.addressAt(10, 300)).toBeNull()
    expect(c.addressAt(c.originX - 1, 300)).toBeNull()
    expect(c.addressAt(999, 300)).toBeNull()
  })

  it('zooms at a point and keeps the byte under it, held to 1..16', () => {
    const c = camera()
    const [x, y] = [400, 500]
    const before = c.addressAt(x, y)
    const u = (x - c.originX) / c.cell
    c.zoomAt(3, x, y)
    expect(c.zoom).toBe(3)
    expect(c.addressAt(x, y)).toBe(before)
    expect((x - c.originX) / c.cell).toBeCloseTo(u, 9)
    c.zoomBy(100, x, y)
    expect(c.zoom).toBe(MAX_ZOOM)
    c.zoomBy(0.001)
    expect(c.zoom).toBe(1)
    expect(c.originY).toBe(0)
  })

  it('pans with a drag, and stops where the core would leave a gap', () => {
    const c = camera()
    c.zoomAt(4, 522, 360)
    const x = c.originX
    const y = c.originY
    c.panBy(30, -20)
    expect(c.originX).toBeCloseTo(x + 30, 9)
    expect(c.originY).toBeCloseTo(y - 20, 9)
    c.panBy(1e6, 1e6)
    expect(c.originX).toBe(RULER_MARGIN)
    // From zoom 4 the column ruler's band stays clear above the core's first row.
    expect(c.originY).toBe(COLUMN_RULER)
    c.panBy(-1e6, -1e6)
    expect(c.originX + 256 * c.cell).toBeCloseTo(1000, 9)
    expect(c.originY + 256 * c.cell).toBeCloseTo(720, 9)
  })

  it('does not pan at zoom 1, and resets to zoom 1 centered', () => {
    const c = camera()
    c.panBy(50, 50)
    expect([c.originX, c.originY]).toEqual([RULER_MARGIN + 118, 0])
    c.zoomAt(8, 100, 100)
    c.reset()
    expect([c.zoom, c.originX, c.originY]).toEqual([1, RULER_MARGIN + 118, 0])
  })

  it('centers on a core point, as near as the edges allow', () => {
    const c = camera()
    c.zoomAt(4, 522, 360)
    c.centerOn(128, 128)
    expect(c.addressAt(RULER_MARGIN + 478, 360)).toBe(0x8080)
    c.centerOn(0, 0)
    expect(c.originX).toBe(RULER_MARGIN)
  })

  it('shows the minimap when zoomed in: bottom right, the whole core, and a press maps into it', () => {
    const c = camera()
    c.zoomBy(2)
    const box = c.minimap()
    expect(box).toEqual({ x: 1000 - 158 - 8, y: 720 - 158 - 8, width: 158, height: 158 })
    const b = box as NonNullable<typeof box>
    expect(c.minimapCell(b.x + b.width / 2, b.y + b.height / 4)).toEqual([128, 64])
    expect(c.minimapCell(b.x - 5, b.y)).toBeNull()
    expect(c.minimapCell(b.x - 5, b.y - 5, true)).toEqual([0, 0])
    const seen = c.visible()
    expect(seen.right - seen.left).toBeCloseTo(956 / c.cell, 9)
  })

  it('tells listeners of each change, and bumps its version', () => {
    const c = camera()
    const heard: number[] = []
    const off = c.subscribe(() => heard.push(c.zoom))
    const v = c.version
    c.zoomBy(2)
    c.resize(1000, 720)
    c.resize(800, 600)
    off()
    c.reset()
    expect(heard).toEqual([2, 2])
    expect(c.version).toBe(v + 3)
  })
})

describe('the rulers', () => {
  it('label a row every 0x800 at zoom 1, bold every 0x1000, against the grid', () => {
    const c = camera()
    const labels = rowLabels(c)
    expect(labels).toHaveLength(32)
    expect(labels.slice(0, 3)).toEqual([
      { text: '0x0000', x: c.originX - 4, y: 0, bold: true },
      { text: '0x0800', x: c.originX - 4, y: 8 * c.cell, bold: false },
      { text: '0x1000', x: c.originX - 4, y: 16 * c.cell, bold: true },
    ])
    expect(columnLabels(c)).toEqual([])
  })

  it('label rows closer together as they spread, against the margin once the grid scrolls', () => {
    const c = camera()
    c.zoomAt(8, 600, 360)
    const labels = rowLabels(c)
    const addresses = labels.map((l) => Number.parseInt(l.text, 16))
    expect(addresses[1] as number).toBe((addresses[0] as number) + 0x100)
    expect(labels.every((l) => l.x === RULER_MARGIN - 4)).toBe(true)
    expect(labels.every((l) => l.y >= -12 && l.y <= 720)).toBe(true)
  })

  it(`label columns from zoom ${LATTICE_ZOOM}: every 0x10, then closer, bold at 0x10`, () => {
    const c = camera()
    c.zoomAt(LATTICE_ZOOM, RULER_MARGIN, 0)
    const at4 = columnLabels(c).map((l) => l.text)
    expect(at4.slice(0, 3)).toEqual(['00', '10', '20'])
    expect(columnLabels(c).every((l) => !l.bold)).toBe(true)
    c.zoomAt(16, RULER_MARGIN, 0)
    const at16 = columnLabels(c)
    expect(at16.map((l) => l.text).slice(0, 5)).toEqual(['00', '04', '08', '0C', '10'])
    expect(at16.filter((l) => l.bold).map((l) => l.text)).toEqual(['00', '10'])
  })
})
