/**
 * More dither scenes (DESIGN_SYSTEM §10): the banners at the right of a page's intro, one a
 * section, and the plates of the profile and the docs home. A banner is
 * wide, 3:1 or wider, and keeps its subject at the right end, where the intro's text is not.
 */
import { aspect, BRIGHT, clamp01, type Grid, noise, type Scene, smoothstep } from './dither'
import { range } from './scenes'

/** Whether `value` is within half a cell of `at`: a line one cell thick. */
function on(value: number, at: number, cell: number): boolean {
  return Math.abs(value - at) < cell / 2
}

/** The x of a point measured in heights from the plate's right edge: 0 there, growing leftward. */
function fromRight(x: number, grid: Grid): number {
  return (1 - x) * aspect(grid)
}

/** A faint scatter of dots, the plates' empty ground. */
function ground(x: number, y: number, amount = 0.06): number {
  return noise(x * 3.1, y * 7.7) > 0.93 ? amount * 4 : 0
}

/** `/hills`: one peak and its king's flag at the right, lower ridges running off to the left. */
export const summit: Scene = range({
  peaks: [
    { x: 0.84, height: 0.72, spread: 0.2, flag: true },
    { x: 0.64, height: 0.42, spread: 0.16 },
    { x: 0.44, height: 0.3, spread: 0.18 },
    { x: 0.2, height: 0.22, spread: 0.2 },
    { x: 0.99, height: 0.4, spread: 0.1 },
  ],
  sun: { x: 0.64, y: 0.34, r: 0.2 },
  stars: 1.4,
})

/** A bracket's rounds, left to right: each round's x, 0..1 across the bracket's box. */
const ROUNDS = [0, 0.27, 0.54, 0.8] as const

/** The y of slot `slot` in round `round` of an 8-bot bracket, 0..1 down its box. */
function slotY(round: number, slot: number): number {
  const width = 2 ** round
  return 0.08 + (0.84 * (slot * width + width / 2)) / 8
}

/** Which slot of each round the champion held: the bot in slot 5 won. */
const PATH = [5, 2, 1, 0] as const

/**
 * `/tournaments`: an 8-bot bracket closing to one line and a cup, the champion's path lit. The
 * bracket fills the plate's right three quarters.
 */
export const bracket: Scene = (x, y, grid) => {
  const cellX = 1 / grid.cols
  const cellY = 1 / grid.rows
  const left = 0.3
  const bx = (x - left) / (1 - left)
  if (bx < 0) return ground(x, y) * (x / left)
  const cup = cupAt(x, y, grid)
  if (cup !== 0) return cup
  const bCell = cellX / (1 - left)
  for (let round = 0; round < ROUNDS.length - 1; round++) {
    const x0 = ROUNDS[round] ?? 0
    const x1 = ROUNDS[round + 1] ?? 1
    const mid = (x0 + x1) / 2
    const slots = 8 / 2 ** round
    for (let slot = 0; slot < slots; slot++) {
      const sy = slotY(round, slot)
      const lit = PATH[round] === slot
      // Out from the slot to the joint, then the joint's upright, then in to the winner's slot.
      if (on(y, sy, cellY) && bx >= x0 && bx <= mid) return lit ? BRIGHT : 0.85
      if (slot % 2 === 0) {
        const sy2 = slotY(round, slot + 1)
        const winner = slotY(round + 1, slot / 2)
        const litJoint = PATH[round + 1] === slot / 2 && (lit || PATH[round] === slot + 1)
        if (on(bx, mid, bCell) && y >= sy && y <= sy2) {
          return litJoint && (PATH[round] === slot ? y <= winner : y >= winner) ? BRIGHT : 0.85
        }
        if (on(y, winner, cellY) && bx >= mid && bx <= x1) return litJoint ? BRIGHT : 0.85
      }
    }
  }
  // The final's line, out to the cup.
  if (on(y, slotY(3, 0), cellY) && bx >= (ROUNDS[3] ?? 0.8) && bx < 0.88) return BRIGHT
  // Each first-round slot's name, as a dim bar.
  if (bx >= 0 && bx < 0.1) {
    for (let slot = 0; slot < 8; slot++) {
      const sy = slotY(0, slot)
      if (y > sy - cellY * 2.2 && y < sy - cellY * 0.8) return PATH[0] === slot ? 0.7 : 0.3
    }
  }
  return ground(x, y)
}

/** A small cup at the bracket's end: a bowl, handles, a stem, a foot. 0 where there is none. */
function cupAt(x: number, y: number, grid: Grid): number {
  const dx = fromRight(x, grid) - 0.2
  const dy = y - 0.5
  if (dy > -0.24 && dy < 0.02) {
    const t = (dy + 0.24) / 0.26
    const half = 0.13 * Math.sqrt(1 - t * t)
    if (Math.abs(dx) < half)
      return dy < -0.22 ? 1 : dx > half * 0.35 && dx < half * 0.6 ? BRIGHT : 0.9
  }
  const ring = Math.hypot(Math.abs(dx) - 0.13, dy + 0.15)
  if (Math.abs(dx) > 0.11 && ring > 0.035 && ring < 0.06) return 0.8
  if (dy >= 0.02 && dy < 0.12 && Math.abs(dx) < 0.02) return 0.9
  if (dy >= 0.12 && dy < 0.2 && Math.abs(dx) < 0.08) return 1
  return 0
}

/**
 * `/bots`: a 3.5" floppy at the right end, a bot's bytes streaming off it to the left as columns of
 * bits, brighter near the disk.
 */
export const disk: Scene = (x, y, grid) => {
  const cellY = 1 / grid.rows
  const dx = fromRight(x, grid) - 0.62
  const dy = y - 0.5
  const half = 0.4
  if (Math.abs(dx) < half && Math.abs(dy) < half) {
    // The clipped corner, top right as it faces us.
    if (-dx + -dy < -half * 1.72) return 0
    const edge = half - Math.max(Math.abs(dx), Math.abs(dy))
    if (edge < cellY) return 1
    // The metal shutter over the top, its window cut through.
    if (dx > -0.2 && dx < 0.14 && dy < -0.13) {
      if (dx > -0.1 && dx < -0.01 && dy > -0.34 && dy < -0.18) return 0.1
      return dx > 0.06 ? 0.75 : BRIGHT
    }
    // The label, with its written lines.
    if (Math.abs(dx) < 0.3 && dy > 0.02 && dy < half - 0.03) {
      const line = (dy - 0.02) / 0.07
      if (line % 1 < cellY / 0.07 && line > 0.8 && dx < 0.3 - 0.12 * noise(Math.floor(line), 1)) {
        return 0.8
      }
      return 0.06
    }
    // The write-protect hole, bottom left.
    if (dx < -0.29 && dx > -0.36 && dy > 0.27 && dy < 0.34) return 0
    return 0.55
  }
  // The bytes: a column a byte, eight bits from the disk's middle, least bit at the bottom.
  const left = dx > half
  const col = Math.floor(x * grid.cols)
  const bit = Math.floor(dy / cellY + 4)
  if (left && col % 2 === 0 && bit >= 0 && bit < 8) {
    const byte = Math.floor(noise(col, 3) * 256)
    const set = (byte >> bit) & 1
    const near = smoothstep(0.1, 1, 1 - (dx - half) / (aspect(grid) - 1.2))
    if (set === 1) return near > 0.92 ? BRIGHT : 0.18 + 0.8 * near
    return 0.04
  }
  return ground(x, y, 0.04)
}

/**
 * `/arena`: a lit grid floor to a horizon, a banded sun on it, and bots' processes as points of
 * light where the lines cross.
 */
export const arenaFloor: Scene = (x, y, grid) => {
  const cellX = 1 / grid.cols
  const cellY = 1 / grid.rows
  const horizon = 0.5
  const wide = aspect(grid)
  const cx = 0.76
  if (y > horizon) {
    const z = y - horizon
    if (z < 0.03) return 0.45
    // A line wherever the depth or the lateral step crosses a whole number within this cell.
    const depth = (d: number) => 0.09 / d
    const rowLine = Math.floor(depth(z)) !== Math.floor(depth(z + cellY))
    const lateral = (px: number) => ((px - cx) * wide) / z / 0.9
    const colLine = Math.floor(lateral(x)) !== Math.floor(lateral(x + cellX))
    if (rowLine && colLine && noise(Math.floor(lateral(x)), Math.floor(depth(z))) > 0.7) {
      return BRIGHT
    }
    if (rowLine || colLine) return 0.55 + 0.45 * smoothstep(0, 0.3, z)
    return 0.06
  }
  const d = Math.hypot((x - cx) * wide, y - horizon + 0.02)
  const r = 0.28
  if (d < r) {
    const below = (horizon - y) / r
    // Bands cut through its lower half, wider toward the horizon.
    if (below < 0.55 && Math.sin(below * 34) > 0.35 + below) return 0
    return 0.9
  }
  if (d < r * 1.7) return 0.08 + 0.18 * (1 - (d - r) / (r * 0.7)) ** 2
  if (noise(x, y) > 0.992) return 1
  return 0.1 * smoothstep(0, horizon, y)
}

/**
 * The docs home: an open manual, its lines of text, a figure of the core on the left page, and a
 * ribbon marking the place. For a plate about 3:2.
 */
export const manual: Scene = (x, y, grid) => {
  const cellY = 1 / grid.rows
  const dx = (x - 0.5) * aspect(grid)
  const w = 0.62
  const side = Math.abs(dx)
  if (side > w) return ground(x, y)
  // The pages rise from the spine to the outer edges.
  const top = 0.2 - 0.07 * Math.sin((side / w) * Math.PI * 0.5)
  const bottom = top + 0.62
  // The ribbon, over the right page and hanging below it.
  if (dx > 0.36 && dx < 0.4 && y > top - 0.02 && y < bottom + 0.1) {
    return y > bottom + 0.07 && Math.abs(dx - 0.38) < (y - bottom - 0.07) * 0.8 ? 0 : BRIGHT
  }
  if (y < top || y > bottom + 0.05) return ground(x, y)
  // The page block's edge under the pages.
  if (y > bottom) return on(y, bottom + 0.02, cellY) || on(y, bottom + 0.04, cellY) ? 0.7 : 0.25
  if (side < 0.012) return 0
  if (y - top < cellY || w - side < cellY * 0.8) return 1
  const inner = side - 0.06
  const row = (y - top - 0.06) / 0.055
  const inText = inner > 0 && side < w - 0.05 && row > 0 && row % 1 < 0.45
  if (dx < 0) {
    // The left page: a heading, then a figure of the core, then text.
    if (row > 0 && row < 1 && inText) return inner < 0.36 ? BRIGHT : 0.12
    if (row >= 1.5 && row < 6) {
      const cx = Math.floor((inner - 0.02) / 0.06)
      const cy = Math.floor((row - 1.5) / 1.1)
      const inCell = (inner - 0.02) % 0.06 < 0.045 && (row - 1.5) % 1.1 < 0.8
      if (inner > 0.02 && cx < 8 && inCell) return noise(cx, cy) > 0.62 ? 0.95 : 0.3
      return 0.12
    }
  }
  if (inText) {
    const length = 0.3 + 0.2 * noise(Math.floor(row), dx < 0 ? 1 : 2)
    return inner < length ? 0.75 : 0.12
  }
  return 0.12
}

/**
 * A profile: a terminal on its stand, its screen a prompt and a few lines of output, the cursor lit.
 * For a plate about 3:2.
 */
export const terminal: Scene = (x, y, grid) => {
  const cellY = 1 / grid.rows
  const dx = (x - 0.5) * aspect(grid)
  // The case, its screen inset.
  const caseW = 0.52
  if (Math.abs(dx) < caseW && y > 0.08 && y < 0.74) {
    const edge = Math.min(caseW - Math.abs(dx), y - 0.08, 0.74 - y)
    if (edge < cellY) return 1
    const sx = dx + caseW - 0.08
    const sy = y - 0.15
    if (sx > 0 && sx < 2 * caseW - 0.16 && sy > 0 && sy < 0.46) {
      const row = sy / 0.075
      const text = row % 1 < 0.5 && sx > 0.04
      const r = Math.floor(row)
      if (text && r === 0) return sx < 0.08 ? BRIGHT : sx < 0.42 ? 0.95 : 0
      if (text && r >= 1 && r <= 3) return sx < 0.1 + 0.55 * noise(r, 5) ? 0.7 : 0
      if (text && r === 4) return sx < 0.08 ? BRIGHT : sx > 0.12 && sx < 0.17 ? BRIGHT : 0
      // The glass's scanlines.
      return Math.floor(sy / cellY) % 3 === 0 ? 0.1 : 0.03
    }
    // A power light, bottom right of the bezel.
    if (Math.hypot(dx - caseW + 0.07, y - 0.68) < 0.018) return BRIGHT
    return 0.45
  }
  // The neck and the foot.
  if (Math.abs(dx) < 0.08 && y >= 0.74 && y < 0.82) return 0.6
  if (Math.abs(dx) < 0.3 && y >= 0.82 && y < 0.87) return y < 0.82 + cellY ? 1 : 0.7
  return ground(x, y) + (y > 0.87 ? 0.06 * clamp01(1 - Math.abs(dx) / 0.8) : 0)
}
