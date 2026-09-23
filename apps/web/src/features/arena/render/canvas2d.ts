/**
 * The arena's 2D fallback (DESIGN_SYSTEM §5), for a browser without WebGL2: the arena `gl.ts`
 * draws, less the post effects. `CorePainter` paints the core as a 256 x 256 image on the CPU.
 * Each image it repaints only the bytes a frame touched and those whose glow still fades, and the
 * renderer puts back only the box around them (the dirty rect). The image is then drawn scaled
 * through the camera, with the lattice, the rings, the IP markers, and the minimap over it.
 */
import { getPaletteFloat32, PALETTE_INDEX, type Theme } from '@asmbots/ui/themes'
import { IP_FRONT } from '../worker/protocol'
import type { Camera, Rect } from './camera'
import {
  type ArenaScene,
  EFFECT_FIELDS,
  EXEC_FADE_MS,
  GLOW_MS,
  isNonZero,
  OWNED,
  OWNED_ZERO,
  PULSE,
  PULSE_MS,
  RIPPLE_MS,
  SIDE,
  WRITE_FADE_MS,
} from './scene'
import type { ArenaRenderer } from './types'

const CELLS = SIDE * SIDE
const HUES = PALETTE_INDEX.bg - PALETTE_INDEX.bot

/** `exp(-age / fade)` for each age below `GLOW_MS`. */
function glowTable(fade: number): Float32Array {
  const table = new Float32Array(GLOW_MS)
  for (let age = 0; age < GLOW_MS; age++) table[age] = Math.exp(-age / fade)
  return table
}

const WRITE_GLOW = glowTable(WRITE_FADE_MS)
const EXEC_GLOW = glowTable(EXEC_FADE_MS)

/** A box of the core image, in cells: `left..right` and `top..bottom`, ends excluded. */
export interface DirtyRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Paints the core, one RGBA pixel per byte, as `ARENA_FRAG` colors a cell: the bot's hue at
 * `OWNED` or `OWNED_ZERO` over the background, desaturated by its fade, then the exec trail and
 * the write flash mixed over it by their glow.
 */
export class CorePainter {
  /** RGBA, row by row: pixel `a` is byte `a` of the core. */
  readonly pixels: Uint8ClampedArray
  /** The box the last `paint` changed; empty when `right <= left`. */
  readonly dirty: DirtyRect = { left: 0, top: 0, right: 0, bottom: 0 }
  private palette: Float32Array
  private paletteVersion = 0
  /** Per owner tag, non-zero then zero: the color of the byte with no glow, 0..255 RGB. */
  private readonly tones = new Float32Array(256 * 2 * 3)
  private tonesFor = { palette: -1, fade: -1 }
  private paintedFull = -1
  /** The bytes whose glow may still show: `active[0..activeCount)`, each once. */
  private readonly active = new Uint16Array(CELLS)
  private activeCount = 0
  private readonly isActive = new Uint8Array(CELLS)

  constructor(
    pixels: Uint8ClampedArray = new Uint8ClampedArray(CELLS * 4),
    theme: Theme = 'sentinel',
  ) {
    this.pixels = pixels
    this.palette = getPaletteFloat32(theme)
  }

  setTheme(theme: Theme): void {
    this.palette = getPaletteFloat32(theme)
    this.paletteVersion++
  }

  /**
   * Paints what `scene` changed since the last call: everything after a full frame, a new theme,
   * or a fade; else the bytes the last `advance` touched and those still glowing. Sets `dirty`.
   */
  paint(scene: ArenaScene): void {
    const toned =
      this.tonesFor.palette !== this.paletteVersion || this.tonesFor.fade !== scene.fadeVersion
    if (toned) this.tone(scene)
    if (toned || this.paintedFull !== scene.fullVersion) {
      this.paintedFull = scene.fullVersion
      this.paintAll(scene)
      return
    }
    const { active, isActive } = this
    const changed = scene.changed
    for (let i = 0; i < scene.changedCount; i++) {
      const a = changed[i] as number
      if (isActive[a] === 0) {
        isActive[a] = 1
        active[this.activeCount++] = a
      }
    }
    const dirty = this.dirty
    let left = SIDE
    let top = SIDE
    let right = 0
    let bottom = 0
    const { writeAge, execAge } = scene
    for (let i = 0; i < this.activeCount; ) {
      const a = active[i] as number
      this.paintCell(scene, a)
      const col = a & 0xff
      const row = a >> 8
      if (col < left) left = col
      if (col >= right) right = col + 1
      if (row < top) top = row
      if (row >= bottom) bottom = row + 1
      if ((writeAge[a] as number) >= GLOW_MS && (execAge[a] as number) >= GLOW_MS) {
        // Its glow is out and painted out: it leaves the set.
        isActive[a] = 0
        active[i] = active[--this.activeCount] as number
      } else {
        i++
      }
    }
    dirty.left = left
    dirty.top = top
    dirty.right = right
    dirty.bottom = bottom
  }

  /** Paints byte `a` into `pixels`. */
  paintCell(scene: ArenaScene, a: number): void {
    const tag = scene.owner[a] as number
    const p = this.palette
    let r: number
    let g: number
    let b: number
    if (tag === 0) {
      const o = PALETTE_INDEX.bg * 4
      r = (p[o] as number) * 255
      g = (p[o + 1] as number) * 255
      b = (p[o + 2] as number) * 255
    } else {
      const o = (tag * 2 + (isNonZero(scene.nonZero, a) ? 0 : 1)) * 3
      r = this.tones[o] as number
      g = this.tones[o + 1] as number
      b = this.tones[o + 2] as number
    }
    const execAge = scene.execAge[a] as number
    if (execAge < GLOW_MS) {
      const e = EXEC_GLOW[execAge] as number
      const o = PALETTE_INDEX.exec * 4
      r += ((p[o] as number) * 255 - r) * e
      g += ((p[o + 1] as number) * 255 - g) * e
      b += ((p[o + 2] as number) * 255 - b) * e
    }
    const writeAge = scene.writeAge[a] as number
    if (writeAge < GLOW_MS) {
      const w = WRITE_GLOW[writeAge] as number
      const o = PALETTE_INDEX.write * 4
      r += ((p[o] as number) * 255 - r) * w
      g += ((p[o + 1] as number) * 255 - g) * w
      b += ((p[o + 2] as number) * 255 - b) * w
    }
    const px = a * 4
    this.pixels[px] = r
    this.pixels[px + 1] = g
    this.pixels[px + 2] = b
    this.pixels[px + 3] = 255
  }

  private paintAll(scene: ArenaScene): void {
    this.activeCount = 0
    this.isActive.fill(0)
    const { writeAge, execAge } = scene
    for (let a = 0; a < CELLS; a++) {
      this.paintCell(scene, a)
      if ((writeAge[a] as number) < GLOW_MS || (execAge[a] as number) < GLOW_MS) {
        this.isActive[a] = 1
        this.active[this.activeCount++] = a
      }
    }
    Object.assign(this.dirty, { left: 0, top: 0, right: SIDE, bottom: SIDE })
  }

  /** Each tag's color with no glow, for the palette and the fades as they are. */
  private tone(scene: ArenaScene): void {
    this.tonesFor = { palette: this.paletteVersion, fade: scene.fadeVersion }
    const p = this.palette
    const bg = PALETTE_INDEX.bg * 4
    for (let tag = 1; tag < 256; tag++) {
      const h = (PALETTE_INDEX.bot + ((tag - 1) % HUES)) * 4
      let r = p[h] as number
      let g = p[h + 1] as number
      let b = p[h + 2] as number
      const fade = scene.fade[tag] as number
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r += (gray - r) * fade
      g += (gray - g) * fade
      b += (gray - b) * fade
      for (const [k, alpha] of [
        [0, OWNED],
        [1, OWNED_ZERO],
      ] as const) {
        const o = (tag * 2 + k) * 3
        this.tones[o] = ((p[bg] as number) + (r - (p[bg] as number)) * alpha) * 255
        this.tones[o + 1] = ((p[bg + 1] as number) + (g - (p[bg + 1] as number)) * alpha) * 255
        this.tones[o + 2] = ((p[bg + 2] as number) + (b - (p[bg + 2] as number)) * alpha) * 255
      }
    }
  }
}

export interface Canvas2dRendererOptions {
  readonly scene: ArenaScene
  readonly camera: Camera
  readonly theme: Theme
}

/** The 2D renderer on `canvas`, or null where the canvas gives no 2D context. */
export function createCanvas2dRenderer(
  canvas: HTMLCanvasElement,
  options: Canvas2dRendererOptions,
): Canvas2dRenderer | null {
  const context = canvas.getContext('2d', { alpha: false })
  const core = canvas.ownerDocument.createElement('canvas')
  core.width = SIDE
  core.height = SIDE
  const coreContext = core.getContext('2d')
  if (context === null || coreContext === null) return null
  return new Canvas2dRenderer(canvas, context, core, coreContext, options)
}

export class Canvas2dRenderer implements ArenaRenderer {
  readonly kind = '2d'
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly core: HTMLCanvasElement
  private readonly coreContext: CanvasRenderingContext2D
  private readonly image: ImageData
  private readonly painter: CorePainter
  private readonly scene: ArenaScene
  private readonly camera: Camera
  private colors: Colors
  private minimapOn = true
  private ratio = 1
  private dirty = true
  private drawnCamera = -1
  private disposed = false

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    core: HTMLCanvasElement,
    coreContext: CanvasRenderingContext2D,
    options: Canvas2dRendererOptions,
  ) {
    this.canvas = canvas
    this.context = context
    this.core = core
    this.coreContext = coreContext
    this.scene = options.scene
    this.camera = options.camera
    this.image = coreContext.createImageData(SIDE, SIDE)
    this.painter = new CorePainter(this.image.data, options.theme)
    this.colors = colorsOf(options.theme)
  }

  resize(width: number, height: number, ratio: number): void {
    const w = Math.max(1, Math.round(width * ratio))
    const h = Math.max(1, Math.round(height * ratio))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.ratio = ratio
    this.dirty = true
  }

  setTheme(theme: Theme): void {
    this.painter.setTheme(theme)
    this.colors = colorsOf(theme)
    this.dirty = true
  }

  /** No post effects in 2D. */
  setEffects(): void {}

  setMinimap(on: boolean): void {
    if (on === this.minimapOn) return
    this.minimapOn = on
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  render(now: number, force = false): boolean {
    if (this.disposed) return false
    const moved = this.scene.advance(now)
    const viewMoved = this.camera.version !== this.drawnCamera
    if (!force && !moved && !viewMoved && !this.dirty) return false
    this.dirty = false
    this.drawnCamera = this.camera.version
    this.painter.paint(this.scene)
    const d = this.painter.dirty
    if (d.right > d.left && d.bottom > d.top) {
      this.coreContext.putImageData(
        this.image,
        0,
        0,
        d.left,
        d.top,
        d.right - d.left,
        d.bottom - d.top,
      )
    }
    this.draw(now)
    return true
  }

  dispose(): void {
    this.disposed = true
  }

  private draw(now: number): void {
    const { context: ctx, camera, colors, ratio: r } = this
    const width = this.canvas.width
    const height = this.canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, width, height)

    const view = camera.view
    const cell = camera.cell * r
    const x0 = camera.originX * r
    const y0 = camera.originY * r
    const left = Math.round(view.x * r)
    ctx.save()
    ctx.beginPath()
    ctx.rect(left, 0, width - left, height)
    ctx.clip()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.core, 0, 0, SIDE, SIDE, x0, y0, SIDE * cell, SIDE * cell)

    if (camera.lattice) {
      const v = camera.visible()
      ctx.fillStyle = colors.lattice
      const line = Math.max(1, Math.round(r))
      for (let col = Math.max(1, Math.floor(v.left)); col < Math.ceil(v.right); col++) {
        ctx.fillRect(Math.floor(x0 + col * cell), y0, line, SIDE * cell)
      }
      for (let row = Math.max(1, Math.floor(v.top)); row < Math.ceil(v.bottom); row++) {
        ctx.fillRect(x0, Math.floor(y0 + row * cell), SIDE * cell, line)
      }
    }

    this.drawRings(now, x0, y0, cell)
    this.drawMarkers(x0, y0, cell)
    ctx.restore()

    const box = this.minimapOn ? camera.minimap() : null
    if (box !== null) this.drawMinimap(box)
  }

  private drawRings(now: number, x0: number, y0: number, cell: number): void {
    const { context: ctx, scene, ratio: r } = this
    const t = scene.time(now)
    const effects = scene.effects
    for (let i = 0; i < scene.effectCount; i++) {
      const o = i * EFFECT_FIELDS
      const code = effects[o + 3] as number
      const pulse = code >> 8 === PULSE
      const life = (t - (effects[o + 2] as number)) / (pulse ? PULSE_MS : RIPPLE_MS)
      if (life < 0 || life >= 1) continue
      const reach = ringReach(pulse, cell, r)
      const eased = 1 - (1 - life) * (1 - life)
      const radius = 0.5 * cell + (reach - 0.5 * cell) * eased
      const hue = this.colors.hues[(code & 0xff) % HUES] as string
      ctx.globalAlpha = 1 - life
      ctx.strokeStyle = pulse ? (this.colors.pulses[(code & 0xff) % HUES] as string) : hue
      ctx.lineWidth = (pulse ? 1 : 1.5) * r
      ctx.beginPath()
      ctx.arc(
        x0 + ((effects[o] as number) + 0.5) * cell,
        y0 + ((effects[o + 1] as number) + 0.5) * cell,
        radius,
        0,
        Math.PI * 2,
      )
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  /** A 1 px outline and a soft 2 px glow per process; the front of each queue brighter. */
  private drawMarkers(x0: number, y0: number, cell: number): void {
    const { context: ctx, scene, ratio: r } = this
    const ips = scene.ips
    if (ips.length === 0) return
    ctx.strokeStyle = this.colors.ip
    for (const front of [false, true]) {
      const alpha = front ? 1 : 0.55
      for (const [pad, width, share] of [
        [2, 2, 0.3],
        [0.5, 1, 1],
      ] as const) {
        ctx.beginPath()
        for (let i = 0; i < ips.length; i += 2) {
          if ((((ips[i + 1] as number) & IP_FRONT) !== 0) !== front) continue
          const a = ips[i] as number
          const x = x0 + (a & 0xff) * cell
          const y = y0 + (a >> 8) * cell
          ctx.rect(x - pad * r, y - pad * r, cell + 2 * pad * r, cell + 2 * pad * r)
        }
        ctx.globalAlpha = alpha * share
        ctx.lineWidth = width * r
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawMinimap(box: Rect): void {
    const { context: ctx, camera, colors, ratio: r } = this
    const x = Math.round(box.x * r)
    const y = Math.round(box.y * r)
    const side = Math.round(box.width * r)
    const line = Math.max(1, Math.round(r))
    ctx.fillStyle = colors.ruler
    ctx.fillRect(x - line, y - line, side + 2 * line, side + 2 * line)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.core, 0, 0, SIDE, SIDE, x, y, side, side)
    const v = camera.visible()
    const k = side / SIDE
    ctx.strokeStyle = colors.ip
    ctx.lineWidth = line
    ctx.strokeRect(
      x + v.left * k + line / 2,
      y + v.top * k + line / 2,
      Math.max(line, (v.right - v.left) * k - line),
      Math.max(line, (v.bottom - v.top) * k - line),
    )
  }
}

/** A theme's arena colors as CSS. */
interface Colors {
  readonly bg: string
  readonly lattice: string
  readonly ruler: string
  readonly ip: string
  readonly hues: readonly string[]
  /** The spawn pulse's color per hue: half way to white. */
  readonly pulses: readonly string[]
}

function colorsOf(theme: Theme): Colors {
  const p = getPaletteFloat32(theme)
  const css = (row: number, white = 0) => {
    const c = [0, 1, 2].map((k) => {
      const v = p[row * 4 + k] as number
      return Math.round((v + (1 - v) * white) * 255)
    })
    return `rgb(${c.join(' ')})`
  }
  const hues = Array.from({ length: HUES }, (_, bot) => PALETTE_INDEX.bot + bot)
  return {
    bg: css(PALETTE_INDEX.bg),
    lattice: css(PALETTE_INDEX.lattice),
    ruler: css(PALETTE_INDEX.ruler),
    ip: css(PALETTE_INDEX.ip),
    hues: hues.map((row) => css(row)),
    pulses: hues.map((row) => css(row, 0.5)),
  }
}

/**
 * How far a ring spreads, device px, for `cell` device px per cell at `ratio`: a few cells out at
 * zoom 1, near two cells when zoomed far in. `RING_VERT` spreads its rings the same.
 */
export function ringReach(pulse: boolean, cell: number, ratio: number): number {
  return pulse
    ? Math.max(7 * ratio, Math.min(2.5 * cell, cell + 12 * ratio))
    : Math.max(12 * ratio, Math.min(4 * cell, 1.5 * cell + 24 * ratio))
}
