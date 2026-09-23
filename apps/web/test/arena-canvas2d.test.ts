/**
 * The 2D fallback (`render/canvas2d.ts`): `CorePainter`'s pixels are the colors `ARENA_FRAG`
 * gives a cell (DESIGN_SYSTEM §5), it repaints only what changed, and the renderer puts back only
 * that box. Also the post effects per theme (`render/post.ts`).
 */
import { describe, expect, it } from 'bun:test'
import { parseHex } from '@asmbots/ui'
import { BOT_HUES } from '@asmbots/ui/themes'
import { Camera } from '../src/features/arena/render/camera'
import { Canvas2dRenderer, CorePainter, ringReach } from '../src/features/arena/render/canvas2d'
import { hasPost, postOf, SCANLINES, VIGNETTE } from '../src/features/arena/render/post'
import {
  ArenaScene,
  BOT_FADE,
  BOT_FADE_MS,
  EXEC_FADE_MS,
  GLOW_MS,
  OWNED,
  OWNED_ZERO,
} from '../src/features/arena/render/scene'
import type { FrameMessage } from '../src/features/arena/worker/protocol'

const ALL_ON = { bloom: true, scanlines: true, vignette: true }

function frame(parts: Partial<FrameMessage> = {}): FrameMessage {
  return {
    type: 'frame',
    cycle: 0,
    alive: 2,
    over: false,
    writes: new Uint16Array(0),
    execs: new Uint16Array(0),
    ips: new Uint16Array(0),
    spawns: new Uint32Array(0),
    deaths: new Uint32Array(0),
    botDeaths: new Uint32Array(0),
    stats: new Float32Array(0),
    ownerDirty: null,
    bytesDirty: null,
    ...parts,
  }
}

/** Bot 0 owns 0x0100 (non-zero) and 0x0101 (zero); bot 1 owns 0x0200 (zero). */
function scene(): ArenaScene {
  const s = new ArenaScene()
  const ownerDirty = new Uint8Array(0x10000)
  const bytesDirty = new Uint8Array(0x10000)
  ownerDirty.set([1, 1], 0x100)
  ownerDirty[0x200] = 2
  bytesDirty[0x100] = 0x90
  s.apply(frame({ ownerDirty, bytesDirty }))
  s.advance(0)
  return s
}

function rgb(painter: CorePainter, a: number): number[] {
  return Array.from(painter.pixels.subarray(a * 4, a * 4 + 4))
}

/** `mix(a, b, t)` per channel, rounded as a canvas stores it. */
function mix(a: readonly number[], b: readonly number[], t: number): number[] {
  return [...a.map((x, i) => Math.round(x + ((b[i] as number) - x) * t)), 255]
}

const HUE0 = parseHex(BOT_HUES.sentinel[0] as string)
const HUE1 = parseHex(BOT_HUES.sentinel[1] as string)

describe('CorePainter', () => {
  it('paints owned bytes in their hue at 0.55 non-zero and 0.22 zero, over black', () => {
    const s = scene()
    const painter = new CorePainter()
    painter.paint(s)
    expect(rgb(painter, 0x100)).toEqual([140, 51, 51, 255])
    expect(rgb(painter, 0x100)).toEqual(mix([0, 0, 0], HUE0, OWNED))
    expect(rgb(painter, 0x101)).toEqual(mix([0, 0, 0], HUE0, OWNED_ZERO))
    expect(rgb(painter, 0x200)).toEqual([56, 35, 15, 255])
    expect(rgb(painter, 0x200)).toEqual(mix([0, 0, 0], HUE1, OWNED_ZERO))
    expect(rgb(painter, 0x300)).toEqual([0, 0, 0, 255])
    expect(painter.dirty).toEqual({ left: 0, top: 0, right: 256, bottom: 256 })
  })

  it('flashes a write white and trails a run yellow, fading with age', () => {
    const s = scene()
    const painter = new CorePainter()
    painter.paint(s)
    s.apply(frame({ writes: Uint16Array.of(0x0304, 0x01ff), execs: Uint16Array.of(0x100, 0) }))
    s.advance(100)
    painter.paint(s)
    expect(rgb(painter, 0x0304)).toEqual([255, 255, 255, 255])
    expect(rgb(painter, 0x100)).toEqual([255, 235, 59, 255])
    s.advance(100 + EXEC_FADE_MS)
    painter.paint(s)
    const owned = [HUE0[0] * OWNED, HUE0[1] * OWNED, HUE0[2] * OWNED]
    expect(rgb(painter, 0x100)).toEqual(mix(owned, [255, 235, 59], Math.exp(-1)))
  })

  it('repaints only the box of what changed, until the glows are out', () => {
    const s = scene()
    const painter = new CorePainter()
    painter.paint(s)
    s.apply(frame({ writes: Uint16Array.of(0x0102, 0x0101, 0x0304, 0x0101) }))
    s.advance(10)
    painter.paint(s)
    expect(painter.dirty).toEqual({ left: 2, top: 1, right: 5, bottom: 4 })
    s.advance(20)
    painter.paint(s)
    expect(painter.dirty).toEqual({ left: 2, top: 1, right: 5, bottom: 4 })
    // The glows go out: painted once more without them, then left alone.
    s.advance(10 + GLOW_MS + 1)
    painter.paint(s)
    expect(painter.dirty).toEqual({ left: 2, top: 1, right: 5, bottom: 4 })
    expect(rgb(painter, 0x0102)).toEqual(mix([0, 0, 0], HUE0, OWNED))
    s.advance(10 + GLOW_MS + 20)
    painter.paint(s)
    expect(painter.dirty.right).toBeLessThanOrEqual(painter.dirty.left)
  })

  it('paints everything again for a new theme, a full frame, or a fading bot', () => {
    const s = scene()
    const painter = new CorePainter()
    painter.paint(s)
    s.advance(1)
    painter.paint(s)
    expect(painter.dirty.right).toBe(0)
    painter.setTheme('amber')
    painter.paint(s)
    expect(painter.dirty).toEqual({ left: 0, top: 0, right: 256, bottom: 256 })

    s.apply(frame({ botDeaths: Uint32Array.of(0, 0) }))
    s.advance(10)
    s.advance(10 + BOT_FADE_MS)
    painter.paint(s)
    expect(painter.dirty.right).toBe(256)
    const [r, g, b] = HUE0.map((c) => c / 255) as [number, number, number]
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const faded = [r, g, b].map((c) => (c + (gray - c) * BOT_FADE) * 255)
    expect(rgb(painter, 0x100)).toEqual(mix([0, 0, 0], faded, OWNED))
  })
})

describe('ringReach', () => {
  it('spreads a few cells at zoom 1, and near two cells when zoomed far in', () => {
    expect(ringReach(false, 2.8, 1)).toBe(12)
    expect(ringReach(true, 2.8, 1)).toBe(7)
    expect(ringReach(false, 45, 1)).toBe(1.5 * 45 + 24)
    expect(ringReach(true, 45, 1)).toBe(45 + 12)
    expect(ringReach(false, 90, 2)).toBe(1.5 * 90 + 48)
  })
})

describe('postOf', () => {
  it('gives the dark themes scanlines and a vignette, and paper neither', () => {
    for (const theme of ['sentinel', 'amber', 'pedurple', 'ice'] as const) {
      const post = postOf(theme, ALL_ON)
      expect(post.bloom).toBeGreaterThan(0)
      expect([post.scanlines, post.vignette]).toEqual([SCANLINES, VIGNETTE])
    }
    expect(postOf('paper', ALL_ON)).toMatchObject({ scanlines: 0, vignette: 0 })
    expect(postOf('paper', ALL_ON).bloom).toBeGreaterThan(0)
  })

  it('turns each effect off with its switch', () => {
    expect(postOf('sentinel', { bloom: false, scanlines: true, vignette: false })).toEqual({
      bloom: 0,
      scanlines: SCANLINES,
      vignette: 0,
    })
    expect(hasPost(postOf('sentinel', { bloom: false, scanlines: false, vignette: false }))).toBe(
      false,
    )
    expect(hasPost(postOf('paper', { bloom: false, scanlines: true, vignette: true }))).toBe(false)
  })
})

/** A 2D context that records its calls: what the renderer drew, without a canvas. */
function recorder() {
  const calls: [string, ...unknown[]][] = []
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'createImageData') {
        return (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        })
      }
      return (...args: unknown[]) => {
        calls.push([String(key), ...args])
      }
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { context, calls }
}

describe('Canvas2dRenderer', () => {
  function renderer() {
    const s = scene()
    const camera = new Camera()
    camera.resize(600, 400)
    const main = recorder()
    const core = recorder()
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement
    const r = new Canvas2dRenderer(canvas, main.context, {} as HTMLCanvasElement, core.context, {
      scene: s,
      camera,
      theme: 'sentinel',
    })
    r.resize(600, 400, 2)
    return { r, s, camera, canvas, main, core }
  }

  it('sizes its canvas to the device pixels, and puts back only the dirty box', () => {
    const { r, s, canvas, core } = renderer()
    expect([canvas.width, canvas.height]).toEqual([1200, 800])
    expect(r.render(0)).toBe(true)
    expect(core.calls.filter(([name]) => name === 'putImageData')).toEqual([
      ['putImageData', expect.anything(), 0, 0, 0, 0, 256, 256],
    ])
    core.calls.length = 0
    s.apply(frame({ writes: Uint16Array.of(0x0a0b, 0x0101) }))
    expect(r.render(16)).toBe(true)
    expect(core.calls).toEqual([['putImageData', expect.anything(), 0, 0, 11, 10, 1, 1]])
  })

  it('draws nothing when nothing moved, and draws the minimap once zoomed in', () => {
    const { r, camera, main } = renderer()
    r.render(0)
    expect(r.render(16)).toBe(false)
    main.calls.length = 0
    camera.zoomBy(2)
    expect(r.render(32)).toBe(true)
    const images = main.calls.filter(([name]) => name === 'drawImage')
    expect(images).toHaveLength(2)
    const box = camera.minimap() as NonNullable<ReturnType<Camera['minimap']>>
    expect(images[1]?.slice(2)).toEqual([
      0,
      0,
      256,
      256,
      box.x * 2,
      box.y * 2,
      box.width * 2,
      box.width * 2,
    ])
    r.setMinimap(false)
    main.calls.length = 0
    r.render(48)
    expect(main.calls.filter(([name]) => name === 'drawImage')).toHaveLength(1)
  })
})
