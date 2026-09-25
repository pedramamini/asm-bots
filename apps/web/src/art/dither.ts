/**
 * The dither plates (DESIGN_SYSTEM §10): 1-bit scenes in the accent, drawn by ordered (Bayer)
 * dithering on a grid of square cells. A scene gives each cell a tone from 0 (off) to 1 (on), or
 * `BRIGHT`; a cell lights when its tone beats its place in the Bayer matrix, so a tone of 0.5
 * lights every other cell in a fixed checker, and the picture is the same on every render.
 */

/** A scene's tone for a cell drawn in `--text-bright` instead of the accent: a flag, a gleam. */
export const BRIGHT = 2

/** What a cell is: off, the accent, or bright. */
export const OFF = 0
export const ON = 1
export const LIT = 2

/** The grid a scene is drawn on, in cells. */
export interface Grid {
  readonly cols: number
  readonly rows: number
}

/**
 * A picture as a tone at each point: `x` 0..1 left to right, `y` 0..1 top to bottom, at a cell's
 * center. Scenes measure in heights (`(x - 0.5) * aspect(grid)`), so a circle stays round on a
 * wide plate.
 */
export type Scene = (x: number, y: number, grid: Grid) => number

/** The 4 × 4 Bayer matrix: each cell's threshold, in sixteenths. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const

/** The grid's width over its height. */
export function aspect(grid: Grid): number {
  return grid.cols / grid.rows
}

/** The cells of `scene` on `grid`, row by row: `OFF`, `ON`, or `LIT`. */
export function ditherCells(scene: Scene, grid: Grid): Uint8Array {
  const { cols, rows } = grid
  const cells = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) / rows
    for (let col = 0; col < cols; col++) {
      const tone = scene((col + 0.5) / cols, y, grid)
      const threshold = BAYER[(row % 4) * 4 + (col % 4)] ?? 0
      cells[row * cols + col] = tone >= BRIGHT ? LIT : tone * 16 > threshold ? ON : OFF
    }
  }
  return cells
}

/** `value` held to 0..1. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** 0 below `edge0`, 1 above `edge1`, and a smooth ramp between. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** A fixed pseudo-random 0..1 for a point: the same point gives the same number. */
export function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}
