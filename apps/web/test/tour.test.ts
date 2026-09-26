import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CARD_GAP,
  HOLE_PAD,
  holeFor,
  inView,
  placeCard,
  sameBox,
  VIEW_MARGIN,
} from '../src/app/boot/spotlight'
import { TOUR_STEPS } from '../src/app/boot/tour-steps'

const VIEW = { width: 1200, height: 800 }
const CARD = { width: 360, height: 200 }

describe('holeFor', () => {
  it('pads the target, and cuts it to the window', () => {
    expect(holeFor({ x: 100, y: 100, width: 50, height: 20 }, VIEW)).toEqual({
      x: 100 - HOLE_PAD,
      y: 100 - HOLE_PAD,
      width: 50 + 2 * HOLE_PAD,
      height: 20 + 2 * HOLE_PAD,
    })
    // A panel taller than the window: the part in view.
    expect(holeFor({ x: 0, y: -400, width: 1200, height: 2000 }, VIEW)).toEqual({
      x: VIEW_MARGIN,
      y: VIEW_MARGIN,
      width: VIEW.width - 2 * VIEW_MARGIN,
      height: VIEW.height - 2 * VIEW_MARGIN,
    })
  })

  it('has none for a target with no size, or out of view', () => {
    expect(holeFor({ x: 10, y: 10, width: 0, height: 0 }, VIEW)).toBeNull()
    expect(holeFor({ x: 10, y: 900, width: 100, height: 40 }, VIEW)).toBeNull()
  })
})

describe('placeCard', () => {
  it('centers the card with no hole', () => {
    expect(placeCard(null, CARD, VIEW)).toEqual({ x: 420, y: 300, side: 'center' })
  })

  it('goes under the hole, centered on it, when there is room', () => {
    const hole = { x: 400, y: 50, width: 400, height: 40 }
    expect(placeCard(hole, CARD, VIEW)).toEqual({ x: 420, y: 90 + CARD_GAP, side: 'bottom' })
  })

  it('goes over a hole at the bottom, and keeps in the window', () => {
    const hole = { x: 1100, y: 700, width: 90, height: 40 }
    const place = placeCard(hole, CARD, VIEW)
    expect(place.side).toBe('top')
    expect(place.y).toBe(700 - CARD_GAP - CARD.height)
    expect(place.x).toBe(VIEW.width - VIEW_MARGIN - CARD.width)
  })

  it('goes beside a hole as tall as the window, and inside one as big as it', () => {
    const left = { x: 8, y: 8, width: 700, height: 784 }
    expect(placeCard(left, CARD, VIEW).side).toBe('right')
    const right = { x: 480, y: 8, width: 712, height: 784 }
    expect(placeCard(right, CARD, VIEW).side).toBe('left')
    const all = { x: 8, y: 8, width: 1184, height: 784 }
    expect(placeCard(all, CARD, VIEW)).toMatchObject({
      side: 'inside',
      y: VIEW.height - VIEW_MARGIN - CARD.height,
    })
  })
})

describe('inView and sameBox', () => {
  it('reads a box in the window, and holes the same to the pixel', () => {
    expect(inView({ x: 10, y: 10, width: 100, height: 100 }, VIEW)).toBe(true)
    expect(inView({ x: 10, y: 750, width: 100, height: 100 }, VIEW)).toBe(false)
    expect(sameBox(null, null)).toBe(true)
    expect(sameBox({ x: 1.2, y: 2, width: 3, height: 4 }, { x: 1.4, y: 2, width: 3, height: 4 })).toBe(
      true,
    )
    expect(sameBox({ x: 1, y: 2, width: 3, height: 4 }, null)).toBe(false)
  })
})

/** Every `.tsx` under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

describe('the tour steps', () => {
  it('have unique ids, and each lit part of a page is still on it', () => {
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    const tagged = new Set(
      sources(join(import.meta.dir, '../src'))
        // The steps name the parts; the pages must carry them.
        .filter((file) => !file.endsWith('tour-steps.tsx'))
        .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/data-tour="([a-z-]+)"/g)])
        .map((match) => match[1]),
    )
    const wanted = TOUR_STEPS.flatMap((step) =>
      [step.target, step.open].flatMap((selector) =>
        selector == null ? [] : [...selector.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1]),
      ),
    )
    expect(wanted.length).toBeGreaterThan(10)
    for (const name of wanted) expect(tagged).toContain(name)
  })

  it('start and end in the middle of the home page', () => {
    expect(TOUR_STEPS[0]).toMatchObject({ path: '/', target: null })
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]).toMatchObject({ path: '/', target: null })
  })
})
