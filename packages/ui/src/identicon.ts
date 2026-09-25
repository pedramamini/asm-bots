/**
 * A bot's identicon (DESIGN_SYSTEM §6) as numbers: 8 × 8 cells from a hash of its bytes, mirrored
 * left to right, and a bot hue. The kit's `Identicon` draws it in the page; the API's share cards
 * draw the same pattern in their SVG, so this module imports no React.
 */
import { HUE_COUNT } from './hue'

/** The side of an identicon, in cells. */
export const IDENTICON_CELLS = 8
/** An off cell's share of the hue: the arena's owned-but-zero territory (DESIGN_SYSTEM §5). */
export const IDENTICON_OFF_OPACITY = 0.22

/**
 * The identicon of `value` as 8 rows, top to bottom, one byte each: bit 7 is the left cell. A
 * 32-bit hash gives each row 4 bits for its left half, and the right half mirrors it.
 */
export function identiconRows(value: Uint8Array | string): Uint8Array {
  return rowsOf(hashOf(value))
}

/** The bot index whose hue an identicon of `value` takes when it is given none: 0 to 11. */
export function identiconHue(value: Uint8Array | string): number {
  return hueOf(hashOf(value))
}

/** One SVG path for the on cells of `rows`, a cell a unit: a rectangle for each run in a row. */
export function identiconPath(rows: Uint8Array): string {
  let d = ''
  rows.forEach((bits, y) => {
    for (let x = 0; x < IDENTICON_CELLS; x++) {
      if (!((bits << x) & 0x80)) continue
      let run = 1
      while (x + run < IDENTICON_CELLS && (bits << (x + run)) & 0x80) run++
      d += `M${x} ${y}h${run}v1h-${run}z`
      x += run
    }
  })
  return d
}

function rowsOf(hash: number): Uint8Array {
  const rows = new Uint8Array(IDENTICON_CELLS)
  for (let row = 0; row < IDENTICON_CELLS; row++) {
    const half = (hash >>> (row * 4)) & 0xf
    let bits = 0
    for (let cell = 0; cell < 4; cell++) {
      if ((half >> (3 - cell)) & 1) bits |= (0x80 >> cell) | (0x01 << cell)
    }
    rows[row] = bits
  }
  return rows
}

/** A hue from a second mix of the hash, so the hue does not follow the pattern's bits. */
function hueOf(hash: number): number {
  return mix(hash ^ 0x9e3779b9) % HUE_COUNT
}

/**
 * FNV-1a 32 of the bytes (a string's in UTF-8), then the MurmurHash3 finalizer, which spreads
 * each input bit over every output bit: a change to one byte redraws about half the cells.
 */
function hashOf(value: Uint8Array | string): number {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let h = 0x811c9dc5
  for (const byte of bytes) h = Math.imul(h ^ byte, 0x01000193)
  return mix(h)
}

/** The MurmurHash3 32-bit finalizer. */
function mix(h: number): number {
  let x = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return (x ^ (x >>> 16)) >>> 0
}
