/**
 * The arena's camera (DESIGN_SYSTEM §5): which part of the core shows, and how large. At zoom 1
 * the whole core fits the view, centered; zoom goes to 16x. The view is the canvas less the row
 * ruler's margin on the left. Sizes are CSS px: a renderer multiplies them by the device pixel
 * ratio.
 */
import { SIDE } from './scene'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 16
/** The row ruler's margin at the left of the canvas, CSS px (DESIGN_SYSTEM §5). */
export const RULER_MARGIN = 44
/** From this zoom on, the lattice and the column ruler show. */
export const LATTICE_ZOOM = 4
/** The column ruler's band over the top of the view from `LATTICE_ZOOM` on, CSS px. */
export const COLUMN_RULER = 14

/** The minimap's side: this share of the view's shorter side, held to 72..160 CSS px. */
const MINIMAP_SHARE = 0.22
const MINIMAP_MIN = 72
const MINIMAP_MAX = 160
/** The minimap's distance from the canvas's bottom-right corner, CSS px. */
const MINIMAP_INSET = 8

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A part of the core in cells: columns `left..right` and rows `top..bottom`, ends excluded. */
export interface CellRange {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * Zoom and pan over the core. It keeps the core over the view: centered on an axis where the core
 * fits, else with no gap at either end. Listeners hear each change.
 */
export class Camera {
  /** Bumped on each change: whatever draws the camera's view draws again when it moves. */
  version = 0
  private level = MIN_ZOOM
  /** The core point at the view's center, in cells. */
  private cx = SIDE / 2
  private cy = SIDE / 2
  private w = 0
  private h = 0
  private readonly listeners = new Set<() => void>()

  get zoom(): number {
    return this.level
  }

  /** The canvas's width, CSS px. */
  get width(): number {
    return this.w
  }

  /** The canvas's height, CSS px. */
  get height(): number {
    return this.h
  }

  /** The grid's box: the canvas less the ruler margin. */
  get view(): Rect {
    return {
      x: RULER_MARGIN,
      y: 0,
      width: Math.max(0, this.w - RULER_MARGIN),
      height: Math.max(0, this.h),
    }
  }

  /** CSS px per cell at zoom 1, where the whole core fits the view. */
  get fit(): number {
    const { width, height } = this.view
    return Math.min(width, height) / SIDE
  }

  /** CSS px per cell. */
  get cell(): number {
    return this.fit * this.level
  }

  /** Cell (0, 0)'s top-left corner, CSS px from the canvas's left. */
  get originX(): number {
    const view = this.view
    return view.x + view.width / 2 - this.cx * this.cell
  }

  /** Cell (0, 0)'s top-left corner, CSS px from the canvas's top. */
  get originY(): number {
    const view = this.view
    return view.y + view.height / 2 - this.cy * this.cell
  }

  /** Whether the lattice and the column ruler show. */
  get lattice(): boolean {
    return this.level >= LATTICE_ZOOM
  }

  /** The canvas's size, CSS px. */
  resize(width: number, height: number): void {
    if (width === this.w && height === this.h) return
    this.w = width
    this.h = height
    this.changed()
  }

  /** Zooms to `zoom`, held to 1..16, keeping the core point under (`x`, `y`) where it is. */
  zoomAt(zoom: number, x: number, y: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
    if (next === this.level) return
    const before = this.cell
    if (before <= 0) {
      this.level = next
      this.changed()
      return
    }
    const u = (x - this.originX) / before
    const v = (y - this.originY) / before
    this.level = next
    const after = this.cell
    const view = this.view
    this.cx = u - (x - view.x - view.width / 2) / after
    this.cy = v - (y - view.y - view.height / 2) / after
    this.changed()
  }

  /** Zooms by `factor` around (`x`, `y`): the view's center unless given. */
  zoomBy(factor: number, x?: number, y?: number): void {
    const view = this.view
    this.zoomAt(this.level * factor, x ?? view.x + view.width / 2, y ?? view.y + view.height / 2)
  }

  /** Moves the core by (`dx`, `dy`) CSS px, as a drag does. */
  panBy(dx: number, dy: number): void {
    const cell = this.cell
    if (cell <= 0 || (dx === 0 && dy === 0)) return
    this.cx -= dx / cell
    this.cy -= dy / cell
    this.changed()
  }

  /** Puts the core point (`col`, `row`), in cells, at the view's center, as near as it can. */
  centerOn(col: number, row: number): void {
    this.cx = col
    this.cy = row
    this.changed()
  }

  /** Zoom 1, the whole core in view: the `0` key. */
  reset(): void {
    this.level = MIN_ZOOM
    this.cx = SIDE / 2
    this.cy = SIDE / 2
    this.changed()
  }

  /** The address of the byte under (`x`, `y`) CSS px, or null off the core or out of the view. */
  addressAt(x: number, y: number): number | null {
    const view = this.view
    const cell = this.cell
    if (
      cell <= 0 ||
      x < view.x ||
      y < view.y ||
      x >= view.x + view.width ||
      y >= view.y + view.height
    ) {
      return null
    }
    const col = Math.floor((x - this.originX) / cell)
    const row = Math.floor((y - this.originY) / cell)
    if (col < 0 || row < 0 || col >= SIDE || row >= SIDE) return null
    return row * SIDE + col
  }

  /** The part of the core in view, in cells (fractions at the edges). */
  visible(): CellRange {
    const view = this.view
    const cell = this.cell
    if (cell <= 0) return { left: 0, top: 0, right: 0, bottom: 0 }
    const x = this.originX
    const y = this.originY
    return {
      left: Math.max(0, (view.x - x) / cell),
      top: Math.max(0, (view.y - y) / cell),
      right: Math.min(SIDE, (view.x + view.width - x) / cell),
      bottom: Math.min(SIDE, (view.y + view.height - y) / cell),
    }
  }

  /** The minimap's box at the view's bottom right, CSS px: only when zoomed in, and when it fits. */
  minimap(): Rect | null {
    if (this.level <= MIN_ZOOM) return null
    const view = this.view
    const short = Math.min(view.width, view.height)
    const side = Math.round(Math.min(MINIMAP_MAX, Math.max(MINIMAP_MIN, short * MINIMAP_SHARE)))
    if (side > short / 2) return null
    return {
      x: view.x + view.width - side - MINIMAP_INSET,
      y: view.y + view.height - side - MINIMAP_INSET,
      width: side,
      height: side,
    }
  }

  /**
   * The core point under (`x`, `y`) of the minimap, in cells, or null when it is not there.
   * `clamp` takes a point outside it to the nearest edge: a drag that started on it.
   */
  minimapCell(x: number, y: number, clamp = false): readonly [col: number, row: number] | null {
    const box = this.minimap()
    if (box === null) return null
    let u = (x - box.x) / box.width
    let v = (y - box.y) / box.height
    if (clamp) {
      u = Math.min(1, Math.max(0, u))
      v = Math.min(1, Math.max(0, v))
    } else if (u < 0 || v < 0 || u >= 1 || v >= 1) {
      return null
    }
    return [u * SIDE, v * SIDE]
  }

  /** Calls `listener` after each change. Returns what stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private changed(): void {
    this.clamp()
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** Keeps the core over the view; the column ruler's band stays clear from `LATTICE_ZOOM` on. */
  private clamp(): void {
    const cell = this.cell
    const view = this.view
    if (cell <= 0) {
      this.cx = SIDE / 2
      this.cy = SIDE / 2
      return
    }
    this.cx = clampAxis(this.cx, view.width, 0, cell)
    this.cy = clampAxis(this.cy, view.height, this.lattice ? COLUMN_RULER : 0, cell)
  }
}

/**
 * The center, in cells, that keeps the core over a view `span` px long on one axis, with `band`
 * px at its start kept clear: the core centered in what is left when it fits, else no gap at
 * either end.
 */
function clampAxis(center: number, span: number, band: number, cell: number): number {
  const size = SIDE * cell
  const room = span - band
  // Where the core's start lands, px from the view's start.
  const start =
    size <= room
      ? band + (room - size) / 2
      : Math.min(band, Math.max(span - size, span / 2 - center * cell))
  return (span / 2 - start) / cell
}
