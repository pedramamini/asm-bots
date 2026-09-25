/**
 * The dither plates' scenes (DESIGN_SYSTEM §10). Each measures in plate heights from its center
 * line, so it keeps its shape on any width; a scene that needs a width says so on its doc comment.
 */
import { aspect, BRIGHT, clamp01, type Grid, noise, type Scene, smoothstep } from './dither'

/** A peak of a `range`: where it stands, how high, and how wide its foot. */
export interface Peak {
  /** Its apex, 0..1 across the plate. */
  readonly x: number
  /** Its apex's height, 0..1 of the plate's. */
  readonly height: number
  /** Half its foot, 0..1 of the plate's width. */
  readonly spread: number
  /** A flag on the apex: a hill with a king. */
  readonly flag?: boolean | undefined
}

export interface RangeOptions {
  readonly peaks: readonly Peak[]
  /** The sun's center (`x` across, `y` down, 0..1) and radius in heights. None when absent. */
  readonly sun?: { readonly x: number; readonly y: number; readonly r: number } | undefined
  /** How many stars in the upper sky: none at 0, about 1 cell in 200 at 1. */
  readonly stars?: number | undefined
}

/** The height of the near ridge at `x`, 0..1 of the plate's: the highest peak there. */
export function ridgeHeight(peaks: readonly Peak[], x: number): number {
  let height = 0
  for (const peak of peaks) {
    const d = Math.abs(x - peak.x) / peak.spread
    if (d >= 1) continue
    const fall = (1 - d) ** 1.35
    // Rough flanks, a clean apex.
    const rough = 0.018 * Math.sin(x * 97 + peak.x * 13) * d + 0.01 * Math.sin(x * 211) * d
    height = Math.max(height, peak.height * fall + rough)
  }
  return height
}

/** The height of the far ridge at `x`: low rolling hills behind the peaks. */
function farHeight(x: number): number {
  return (
    0.3 + 0.07 * Math.sin(x * 7.3 + 1.1) + 0.04 * Math.sin(x * 23 + 0.4) + 0.015 * Math.sin(x * 71)
  )
}

/**
 * Mountains under a sky: a far ridge, the near peaks lit from the sun's side with a solid rim,
 * a flag on each peak that has one (a hill with a king), a banded sun, and stars. The footer's
 * range and the `climb` plate.
 */
export function range({ peaks, sun, stars = 0 }: RangeOptions): Scene {
  return (x, y, grid) => {
    const cell = 1 / grid.rows
    const wide = aspect(grid)
    // Flags first: they stand over the sky and the sun.
    for (const peak of peaks) {
      if (peak.flag !== true) continue
      const top = 1 - peak.height
      const pole = 0.24
      const dx = (x - peak.x) * wide
      if (Math.abs(dx) < cell * 0.6 && y <= top && y >= top - pole) return BRIGHT
      const cloth = dx >= 0 && dx < 0.13 && y >= top - pole
      const wave = 0.012 * Math.sin(dx * 55)
      if (cloth && y + wave < top - pole + 0.075) return BRIGHT
    }
    const near = 1 - ridgeHeight(peaks, x)
    if (y >= near) {
      const depth = y - near
      if (depth < cell * 1.2) return 1
      const slope = ridgeHeight(peaks, x + 0.002) - ridgeHeight(peaks, x - 0.002)
      const toward = sun === undefined ? 0 : Math.sign(sun.x - x) * Math.sign(slope)
      return 0.5 + 0.08 * toward + 0.32 * smoothstep(0, 0.6, depth)
    }
    if (y >= 1 - farHeight(x)) return 0.26
    if (sun !== undefined) {
      const d = Math.hypot((x - sun.x) * wide, y - sun.y)
      if (d < sun.r) {
        // The lower half's bands, thicker toward the horizon.
        const below = (y - sun.y) / sun.r
        if (below > 0.1 && Math.sin(below * 22) > 1.2 - below) return 0
        return 0.94
      }
      const halo = 1 - (d - sun.r) / (sun.r * 1.4)
      if (halo > 0) return 0.1 + 0.2 * halo * halo
    }
    if (stars > 0 && y < 0.55 && noise(x, y) > 1 - 0.005 * stars) return 1
    return 0.13 * smoothstep(0.25, 1, y)
  }
}

/** The footer's range: the three seeded hills, `main` tallest, each with its king's flag. */
export const FOOTER_PEAKS: readonly Peak[] = [
  { x: 0.08, height: 0.4, spread: 0.12 },
  { x: 0.22, height: 0.54, spread: 0.13, flag: true },
  { x: 0.37, height: 0.36, spread: 0.1 },
  { x: 0.5, height: 0.66, spread: 0.16, flag: true },
  { x: 0.66, height: 0.42, spread: 0.11 },
  { x: 0.8, height: 0.5, spread: 0.12, flag: true },
  { x: 0.94, height: 0.34, spread: 0.1 },
]

/** The hill each footer flag stands for, left to right. */
export const FOOTER_HILLS = ['tiny', 'main', 'melee'] as const

export const footerRange: Scene = range({
  peaks: FOOTER_PEAKS,
  sun: { x: 0.64, y: 0.5, r: 0.3 },
  stars: 1,
})

/** The `climb` plate: one peak and its king, the sun behind it. For a plate about 16:9. */
export const climbRange: Scene = range({
  peaks: [
    { x: 0.52, height: 0.7, spread: 0.42, flag: true },
    { x: 0.14, height: 0.4, spread: 0.2 },
    { x: 0.9, height: 0.46, spread: 0.2 },
  ],
  sun: { x: 0.7, y: 0.36, r: 0.2 },
  stars: 1,
})

/** Whether (dx, y) is on a small four-point sparkle centered at (px, py), in heights. */
function sparkle(dx: number, y: number, px: number, py: number, cell: number): boolean {
  const ax = Math.abs(dx - px)
  const ay = Math.abs(y - py)
  return (ax < cell * 0.6 && ay < cell * 3) || (ay < cell * 0.6 && ax < cell * 3)
}

/**
 * A championship cup on a plinth, rays behind, a gleam down its bowl. Needs a plate at least
 * 0.8 as wide as it is high.
 */
export const trophy: Scene = (x, y, grid: Grid) => {
  const cell = 1 / grid.rows
  const dx = (x - 0.5) * aspect(grid)
  if (
    sparkle(dx, y, -0.3, 0.1, cell) ||
    sparkle(dx, y, 0.32, 0.18, cell) ||
    sparkle(dx, y, 0.25, 0.05, cell)
  ) {
    return BRIGHT
  }
  // The bowl: a quarter ellipse, widest at the rim.
  if (y >= 0.12 && y <= 0.5) {
    const t = (y - 0.12) / 0.38
    const half = 0.19 * Math.sqrt(1 - t * t)
    if (Math.abs(dx) < half) {
      if (y < 0.145) return 1
      const s = dx / half
      if (s > -0.62 && s < -0.46 && t < 0.8) return BRIGHT
      return 0.3 + 0.62 * clamp01(1 - Math.abs(s + 0.35))
    }
  }
  // The handles: the outer half of a ring each side.
  const ring = Math.hypot(Math.abs(dx) - 0.19, y - 0.24)
  if (Math.abs(dx) > 0.17 && ring > 0.055 && ring < 0.085) return 0.75
  if (y >= 0.5 && y < 0.62 && Math.abs(dx) < 0.022 + (0.02 * (y - 0.5)) / 0.12) return 0.8
  if (y >= 0.62 && y < 0.66 && Math.abs(dx) < 0.08) return 1
  if (y >= 0.66 && y < 0.8 && Math.abs(dx) < 0.13) return y < 0.675 ? 1 : 0.5
  if (y >= 0.8) return 0.08
  // The rays, fading out from the cup.
  const d = Math.hypot(dx, y - 0.3)
  const angle = Math.atan2(y - 0.3, dx)
  if (d > 0.24 && Math.sin(angle * 14) > 0.55) return 0.2 * clamp01(1 - (d - 0.24) / 0.6)
  return 0
}

/** The pins along each side of the `chip`. */
const PINS = 20

/**
 * An 8086 in its 40-pin DIP, lit from above, its traces running off the board to vias. Needs a
 * plate at least 1.5 as wide as it is high.
 */
export const chip: Scene = (x, y, grid: Grid) => {
  const cell = 1 / grid.rows
  const dx = (x - 0.5) * aspect(grid)
  const inBody = Math.abs(dx) < 0.62 && y >= 0.36 && y <= 0.64
  if (inBody) {
    if (Math.hypot(dx + 0.62, y - 0.5) < 0.05) return 0
    if (Math.hypot(dx + 0.52, y - 0.575) < 0.022) return 0.12
    if (y < 0.372) return 1
    return 0.48 + 0.3 * (1 - (y - 0.36) / 0.28)
  }
  for (let i = 0; i < PINS; i++) {
    const px = -0.57 + (i * 1.14) / (PINS - 1)
    const off = Math.abs(dx - px)
    const top = y >= 0.3 && y < 0.36
    const bottom = y > 0.64 && y <= 0.7
    if (off < 0.018 && (top || bottom)) return y < 0.31 || y > 0.69 ? BRIGHT : 1
    // Every other pin's trace, out to a via at its own length.
    if (i % 2 === 1) continue
    const length = 0.06 + 0.2 * noise(i, top || y < 0.5 ? 1 : 2)
    const end = y < 0.5 ? 0.3 - length : 0.7 + length
    const via = Math.hypot(dx - px, y - end)
    if (via < 0.02 && via > 0.009) return 1
    const onTrace = y < 0.5 ? y >= end && y < 0.3 : y > 0.7 && y <= end
    if (off < cell * 0.6 && onTrace) return 0.7
  }
  return 0
}
