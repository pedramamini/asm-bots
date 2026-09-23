import type { ComponentProps } from 'react'
import { graphicRole } from '../graphic'
import { HUE_COUNT, type Hue, hueColor } from '../hue'
import { cx, vars } from '../style'

/** The side of an identicon, in cells. */
const CELLS = 8
/** An off cell's share of the hue: the arena's owned-but-zero territory (DESIGN_SYSTEM §5). */
const OFF_OPACITY = 0.22

export interface IdenticonProps extends Omit<ComponentProps<'svg'>, 'width' | 'height'> {
  /** What the pattern comes from: a bot's bytes, or a string such as its hash. */
  value: Uint8Array | string
  /** The side, px. A multiple of 8 keeps each cell a whole number of pixels. */
  size?: number | undefined
  /** A bot index (the engine's owner - 1) or any CSS color; the hash picks a bot hue when absent. */
  hue?: Hue | undefined
}

/**
 * A bot's avatar (DESIGN_SYSTEM §6): 8 × 8 cells from a hash of its bytes, mirrored left to right,
 * drawn as a patch of the arena: black in every theme, on cells in the hue, off cells in the dim
 * wash of owned territory. Every bot hue shows on black, so a light hue holds up on paper. Equal
 * input always draws the same pattern in the same hue. Hidden from assistive tech unless
 * `aria-label` names it.
 */
export function Identicon({ value, size = 32, hue, className, style, ...rest }: IdenticonProps) {
  const hash = hashOf(value)
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: graphicRole hides it, or names it by aria-label.
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${CELLS} ${CELLS}`}
      shapeRendering="crispEdges"
      {...graphicRole(rest)}
      {...rest}
      className={cx('shrink-0 text-(--hue)', className)}
      style={{ ...style, ...vars({ '--hue': hueColor(hue ?? hueOf(hash)) }) }}
    >
      <rect width={CELLS} height={CELLS} className="fill-arena-bg" />
      <rect width={CELLS} height={CELLS} fill="currentColor" fillOpacity={OFF_OPACITY} />
      <path d={cellsPath(rowsOf(hash))} fill="currentColor" />
    </svg>
  )
}

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

function rowsOf(hash: number): Uint8Array {
  const rows = new Uint8Array(CELLS)
  for (let row = 0; row < CELLS; row++) {
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

/** One path for the on cells: a rectangle for each run of on cells in a row. */
function cellsPath(rows: Uint8Array): string {
  let d = ''
  rows.forEach((bits, y) => {
    for (let x = 0; x < CELLS; x++) {
      if (!((bits << x) & 0x80)) continue
      let run = 1
      while (x + run < CELLS && (bits << (x + run)) & 0x80) run++
      d += `M${x} ${y}h${run}v1h-${run}z`
      x += run
    }
  })
  return d
}
