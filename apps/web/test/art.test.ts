import { describe, expect, it } from 'bun:test'
import { hasFooter } from '../src/app/Frame'
import { arenaFloor, bracket, disk, manual, summit, terminal } from '../src/art/banners'
import { BRIGHT, ditherCells, LIT, OFF, ON, type Scene } from '../src/art/dither'
import { litCells } from '../src/art/HexBand'
import { tracePoints } from '../src/art/ScopeTrace'
import {
  chip,
  climbRange,
  FOOTER_HILLS,
  FOOTER_PEAKS,
  footerRange,
  ridgeHeight,
  trophy,
} from '../src/art/scenes'

/** The share of a plate's cells that are not off. */
function coverage(scene: Scene, cols: number, rows: number): number {
  const cells = ditherCells(scene, { cols, rows })
  return cells.filter((cell) => cell !== OFF).length / cells.length
}

describe('ditherCells', () => {
  it('lights a flat tone in the share the tone asks for', () => {
    for (const tone of [0, 0.25, 0.5, 0.75, 1]) {
      expect(coverage(() => tone, 16, 16)).toBeCloseTo(tone, 1)
    }
  })

  it('draws a bright tone as lit, and nothing else as lit', () => {
    const cells = ditherCells((x) => (x < 0.5 ? BRIGHT : 1), { cols: 8, rows: 2 })
    expect([...cells.slice(0, 4)]).toEqual([LIT, LIT, LIT, LIT])
    expect([...cells.slice(4, 8)]).toEqual([ON, ON, ON, ON])
  })

  it('gives the same cells on every call', () => {
    const grid = { cols: 120, rows: 40 }
    expect(ditherCells(footerRange, grid)).toEqual(ditherCells(footerRange, grid))
  })
})

describe('the scenes', () => {
  it('draw something and leave room: no plate is empty or solid', () => {
    for (const [scene, cols, rows] of [
      [footerRange, 480, 42],
      [climbRange, 160, 100],
      [trophy, 100, 100],
      [chip, 160, 100],
      // The intro banners, 320 × 80 px in 2 px cells, and the profile's and the docs' plates.
      [summit, 160, 40],
      [bracket, 160, 40],
      [disk, 160, 40],
      [arenaFloor, 160, 40],
      [manual, 112, 72],
      [terminal, 180, 80],
    ] as const) {
      const share = coverage(scene, cols, rows)
      expect(share).toBeGreaterThan(0.08)
      expect(share).toBeLessThan(0.7)
    }
  })

  it('stand each footer flag on its peak, one flag a seeded hill, clear of the top', () => {
    const flags = FOOTER_PEAKS.filter((peak) => peak.flag)
    expect(flags).toHaveLength(FOOTER_HILLS.length)
    for (const peak of flags) {
      expect(ridgeHeight(FOOTER_PEAKS, peak.x)).toBeCloseTo(peak.height, 5)
      // The pole is 0.24 of the plate: the flag's top stays inside it.
      expect(peak.height + 0.24).toBeLessThan(0.95)
    }
    const cells = ditherCells(footerRange, { cols: 480, rows: 42 })
    expect(cells.includes(LIT)).toBe(true)
  })
})

describe('the banners', () => {
  it('keep their subject at the right end, clear of the intro text', () => {
    for (const scene of [summit, bracket, disk, arenaFloor]) {
      const cells = ditherCells(scene, { cols: 160, rows: 40 })
      let left = 0
      let right = 0
      cells.forEach((cell, i) => {
        if (cell === OFF) return
        if (i % 160 < 48) left++
        else if (i % 160 >= 112) right++
      })
      expect(right).toBeGreaterThan(left)
    }
  })

  it("light the champion's path to the cup in the bracket", () => {
    const cells = ditherCells(bracket, { cols: 160, rows: 40 })
    expect(cells.filter((cell) => cell === LIT).length).toBeGreaterThan(40)
  })
})

describe('litCells', () => {
  it('spells the word 5 × 7 a letter, centered, a column between letters', () => {
    const rows = litCells('T', 7)
    // T's bar across the top of the glyph (row 2 after the 2 rows of padding), its stem down the middle.
    expect(rows[2]).toEqual([false, true, true, true, true, true, false])
    expect(rows[5]).toEqual([false, false, false, true, false, false, false])
    expect(rows[0]?.some(Boolean)).toBe(false)
  })

  it('lights nothing for a letter it has no glyph for', () => {
    expect(litCells('?', 8).flat().some(Boolean)).toBe(false)
  })
})

describe('tracePoints', () => {
  it('walks the same way each time, inside the scope', () => {
    const trace = { hue: 1, start: 0.3, death: 0.5, seed: 7 }
    const points = tracePoints(trace)
    expect(points).toBe(tracePoints(trace))
    for (const point of points.split(' ')) {
      const [x, y] = point.split(',').map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(480)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(200)
    }
  })

  it('falls to the floor once the bot dies', () => {
    const last = tracePoints({ hue: 1, start: 0.5, death: 0.2, seed: 3 }).split(' ').at(-1)
    expect(Number(last?.split(',')[1])).toBeGreaterThan(190)
  })
})

describe('hasFooter', () => {
  it('ends a page in the footer, but not the arena, the editor, or an embed', () => {
    for (const path of ['/', '/hills', '/hills/main', '/docs/start-here', '/arenas']) {
      expect(hasFooter(path)).toBe(true)
    }
    for (const path of ['/arena', '/arena/abc', '/editor', '/editor/bot-1', '/embed/arena/x']) {
      expect(hasFooter(path)).toBe(false)
    }
  })
})
