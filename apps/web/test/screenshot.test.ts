/**
 * The arena screenshot's footer stamp (EXEC 4.1): what it says, and where it lands on the PNG,
 * drawn on a 2D context that records its calls (jsdom has no canvas).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useDom, window } from '../../../packages/ui/test/dom'
import type { ArenaCanvasHandle } from '../src/features/arena/ArenaCanvas'
import {
  captureArena,
  FOOTER,
  footerStamp,
  type ScreenshotText,
} from '../src/features/arena/battle/screenshot'

useDom()

describe('footerStamp', () => {
  it('names the bots, the seed, and the cycle, and the bots by count', () => {
    expect(footerStamp(['Dwarf', 'Imp'], 1, 3527)).toEqual({
      full: 'Dwarf vs Imp · seed 1 · cycle 3,527',
      short: '2 bots · seed 1 · cycle 3,527',
    })
    expect(footerStamp(['Imp'], 7, 0).short).toBe('1 bot · seed 7 · cycle 0')
  })
})

/** A call the shot's context took: its name, its arguments, and the fill style it drew in. */
interface Call {
  name: string
  args: unknown[]
  fill: unknown
}

describe('captureArena', () => {
  let calls: Call[] = []
  let shot: HTMLCanvasElement | null = null
  const proto = window.HTMLCanvasElement.prototype
  const { getContext, toBlob } = proto

  beforeEach(() => {
    calls = []
    shot = null
    proto.getContext = function (this: HTMLCanvasElement) {
      shot = this
      const state: Record<string | symbol, unknown> = {}
      return new Proxy(state, {
        get(target, key) {
          if (key in target) return target[key]
          if (key === 'measureText') return (text: string) => ({ width: text.length * 6 })
          return (...args: unknown[]) => {
            calls.push({ name: String(key), args, fill: target.fillStyle })
          }
        },
        set(target, key, value) {
          target[key] = value
          return true
        },
      })
    } as typeof proto.getContext
    proto.toBlob = (done: BlobCallback) => {
      done(new window.Blob(['png'], { type: 'image/png' }))
    }
  })
  afterEach(() => {
    proto.getContext = getContext
    proto.toBlob = toBlob
  })

  /** The arena at `width` x 600 CSS px on a display of pixel ratio 2. */
  const handle = (width: number) =>
    ({
      canvas: { width: width * 2, height: 1200, clientWidth: width },
      overlay: null,
      renderer: { render: () => {} },
    }) as unknown as ArenaCanvasHandle

  const text = (bots: string[]): ScreenshotText => ({
    chips: ['cycle 3,527 / 100,000', '100/f'],
    title: 'asm bots · seed 1',
    bots,
    stamp: footerStamp(bots, 1, 3527),
    site: 'asmbots.io',
  })

  const drawn = (words: string) => calls.find((c) => c.name === 'fillText' && c.args[0] === words)

  it('adds a footer band under the legend, the stamp on its left, the site on its right', async () => {
    expect(await captureArena(handle(800), text(['Dwarf', 'Imp']))).not.toBeNull()
    // The arena, one legend row (chip 18 + gap 4, and an inset of 8), then the footer.
    expect(shot?.height).toBe(1200 + (18 + 4 + 8 + FOOTER) * 2)
    const top = 600 + 18 + 4 + 8
    const band = calls.find((c) => c.name === 'fillRect' && c.args[1] === top)
    expect(band?.args).toEqual([0, top, 800, FOOTER])
    const stamp = drawn('DWARF VS IMP · SEED 1 · CYCLE 3,527')
    expect(stamp?.args).toEqual(['DWARF VS IMP · SEED 1 · CYCLE 3,527', 56, top + FOOTER / 2 + 0.5])
    const site = drawn('asmbots.io')
    // Right-aligned, 8 px in: 10 characters at 6 px each.
    expect(site?.args).toEqual(['asmbots.io', 800 - 8 - 60, top + FOOTER / 2 + 0.5])
    // The site in the accent, the stamp muted: the theme's tokens, or sentinel's without them.
    expect([site?.fill, stamp?.fill]).toEqual(['#00FF88', '#7D9B7D'])
  })

  it('names the bots by count when their names would run into the site', async () => {
    const bots = Array.from({ length: 16 }, (_, i) => `painter-spiral-${i}`)
    await captureArena(handle(800), text(bots))
    expect(drawn('16 BOTS · SEED 1 · CYCLE 3,527')).toBeDefined()
    expect(calls.some((c) => c.name === 'fillText' && String(c.args[0]).includes(' VS '))).toBe(
      false,
    )
  })
})
