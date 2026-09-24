/**
 * The arena's rulers (DESIGN_SYSTEM §5), drawn on a 2D canvas over the renderer's: hex row
 * addresses in the left margin, every 0x800 at zoom 1 and closer together as the rows spread,
 * bold every 0x1000; and from zoom 4 the column offsets along the top, every 0x10 and closer when
 * zoomed far in, on a band that keeps them legible over the arena.
 */
import { hexAddress, hexByte } from '@asmbots/ui'
import { ARENA_COLORS, type Theme } from '@asmbots/ui/themes'
import { type Camera, COLUMN_RULER, RULER_MARGIN } from './camera'
import { SIDE } from './scene'

/** Rows between two row labels, from the closest: 0x100 to 0x1000 bytes. */
const ROW_STEPS = [1, 2, 4, 8, 16] as const
/** The row labels' least gap, CSS px: the 10 px type and a little air. */
const ROW_GAP = 12
/** Columns between two column labels, from the closest… */
const COLUMN_STEPS = [1, 2, 4, 8, 16] as const
/** …and their least gap, CSS px: 0x10 apart at zoom 4 to 8, closer from there. */
const COLUMN_GAP = 96
/** A label's distance from the ruler's edge, CSS px. */
const LABEL_PAD = 4
/** The column ruler's band, as the arena's black at this opacity. */
const BAND_ALPHA = 0.85
/** The hover crosshair's lines: the ruler's color at this opacity. The cell's outline is whole. */
const CROSSHAIR_ALPHA = 0.45

export interface RulerLabel {
  readonly text: string
  /** The row label's right edge, or the column label's left edge, CSS px. */
  readonly x: number
  /** The label's top, CSS px. */
  readonly y: number
  readonly bold: boolean
}

/** The row ruler's labels in view: right-aligned against the grid, or the margin once it scrolls. */
export function rowLabels(camera: Camera): RulerLabel[] {
  const cell = camera.cell
  if (cell <= 0) return []
  const step = ROW_STEPS.find((rows) => rows * cell >= ROW_GAP) ?? 16
  const right = Math.max(RULER_MARGIN, camera.originX) - LABEL_PAD
  const labels: RulerLabel[] = []
  // From the view's top: a HUD's band over it keeps the rows under it unlabeled.
  const top = camera.view.y
  const first = Math.max(0, Math.floor((top - camera.originY) / cell / step) * step)
  for (let row = first; row < SIDE; row += step) {
    const y = camera.originY + row * cell
    if (y > camera.height) break
    if (y + ROW_GAP < top) continue
    const address = row * SIDE
    labels.push({ text: hexAddress(address), x: right, y, bold: address % 0x1000 === 0 })
  }
  return labels
}

/** The column ruler's labels in view, from `LATTICE_ZOOM` on: none below it. */
export function columnLabels(camera: Camera): RulerLabel[] {
  const cell = camera.cell
  if (!camera.lattice || cell <= 0) return []
  const step = COLUMN_STEPS.find((cols) => cols * cell >= COLUMN_GAP) ?? 16
  const view = camera.view
  const labels: RulerLabel[] = []
  for (let col = 0; col < SIDE; col += step) {
    const x = camera.originX + col * cell + LABEL_PAD / 2
    if (x < view.x || x > view.x + view.width - 16) continue
    labels.push({ text: hexByte(col), x, y: view.y + 2, bold: step < 16 && col % 16 === 0 })
  }
  return labels
}

/**
 * Draws the rulers on their own canvas when the camera, the size, or the theme changes, and the
 * hover crosshair (DESIGN_SYSTEM §5) through the byte under the pointer.
 */
export class RulerOverlay {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D | null
  private readonly camera: Camera
  private theme: Theme
  private ratio = 1
  private drawnCamera = -1
  private dirty = true
  private hover: number | null = null

  constructor(canvas: HTMLCanvasElement, camera: Camera, theme: Theme) {
    this.canvas = canvas
    // None in a DOM without canvas support (a test): the rulers then draw nothing.
    this.context = canvas.getContext('2d')
    this.camera = camera
    this.theme = theme
  }

  resize(width: number, height: number, ratio: number): void {
    this.ratio = ratio
    const w = Math.max(1, Math.round(width * ratio))
    const h = Math.max(1, Math.round(height * ratio))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.dirty = true
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return
    this.theme = theme
    this.dirty = true
  }

  /** Draws again at the next `render`: when the web font arrives. */
  invalidate(): void {
    this.dirty = true
  }

  /** The byte the crosshair goes through, or null for none. */
  setHover(address: number | null): void {
    if (address === this.hover) return
    this.hover = address
    this.dirty = true
  }

  /** Draws the rulers if anything they show changed. Returns whether it drew. */
  render(): boolean {
    const ctx = this.context
    if (ctx === null || (!this.dirty && this.camera.version === this.drawnCamera)) return false
    this.dirty = false
    this.drawnCamera = this.camera.version
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0)
    const colors = ARENA_COLORS[this.theme]
    ctx.textBaseline = 'top'

    const columns = columnLabels(this.camera)
    if (this.camera.lattice) {
      const view = this.camera.view
      ctx.globalAlpha = BAND_ALPHA
      ctx.fillStyle = colors.bg
      ctx.fillRect(view.x, view.y, view.width, COLUMN_RULER)
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = colors.ruler
    ctx.textAlign = 'left'
    for (const label of columns) this.label(ctx, label)
    ctx.textAlign = 'right'
    for (const label of rowLabels(this.camera)) this.label(ctx, label)
    if (this.hover !== null) this.crosshair(ctx, this.hover, colors.ruler)
    return true
  }

  /** A hairline across the view and one down it through byte `a`, and an outline round it. */
  private crosshair(ctx: CanvasRenderingContext2D, a: number, color: string): void {
    const { camera } = this
    const view = camera.view
    const cell = camera.cell
    const x = camera.originX + (a & 0xff) * cell
    const y = camera.originY + (a >> 8) * cell
    const line = 1 / this.ratio
    ctx.save()
    ctx.beginPath()
    ctx.rect(view.x, view.y, view.width, view.height)
    ctx.clip()
    ctx.fillStyle = color
    ctx.globalAlpha = CROSSHAIR_ALPHA
    ctx.fillRect(view.x, y + cell / 2 - line / 2, view.width, line)
    ctx.fillRect(x + cell / 2 - line / 2, view.y, line, view.height)
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = line
    const pad = Math.max(1, cell / 4)
    ctx.strokeRect(x - pad, y - pad, cell + 2 * pad, cell + 2 * pad)
    ctx.restore()
  }

  private label(ctx: CanvasRenderingContext2D, { text, x, y, bold }: RulerLabel): void {
    ctx.font = `${bold ? 700 : 400} 10px "JetBrains Mono", ui-monospace, monospace`
    ctx.fillText(text, x, y + 2)
  }
}
