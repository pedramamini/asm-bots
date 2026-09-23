import { type ComponentProps, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseHex } from '../color'
import { hexAddress, hexByte } from '../hex'
import { cx, vars } from '../style'
import { ARENA_COLORS, BOT_HUES, type Theme } from '../themes'
import { type Battle, battle, CORE_SIZE, ROW_BYTES } from './battle'

/** The row ruler's left margin, px, and the column ruler's top margin at 4x and up. */
const RULER = 44
const COLUMN_RULER = 14
/** An owned byte's share of its bot's hue: non-zero, and zero (DESIGN_SYSTEM §5). */
const OWNED = 0.55
const OWNED_ZERO = 0.22
/** A dead bot's territory loses this share of its saturation. */
const DEATH_FADE = 0.4

export interface ArenaMockProps extends ComponentProps<'div'> {
  theme: Theme
  /** px per byte. Absent: the whole core at the largest whole size that fits. */
  cell?: number | undefined
  /** The top-left byte in view: its row is the first row, its column the first column. */
  origin?: number | undefined
  /** The canvas's accessible name. */
  label: string
}

interface View {
  cell: number
  cols: number
  rows: number
  /** The first row and the first column in view. */
  row: number
  col: number
  /** Where the grid starts in the box, px: after the ruler, centered for the whole core. */
  left: number
  top: number
  lattice: boolean
}

/**
 * A still of the arena (DESIGN_SYSTEM §5) drawn from a frozen battle: black, each owned byte in
 * its bot's hue, the exec trail and the write flash fading, a white outline and glow on each IP,
 * the hex ruler down the left, and at 4x and up the lattice and the column ruler. The renderer
 * (EXEC 2.3) replaces it; until then it shows the arena tokens in place. `children` lie over it:
 * the HUD.
 */
export function ArenaMock({
  theme,
  cell,
  origin = 0,
  label,
  className,
  children,
  ...rest
}: ArenaMockProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<readonly [width: number, height: number]>([0, 0])

  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    const measure = () => setSize([node.clientWidth, node.clientHeight])
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const view = useMemo(() => layout(size, cell, origin), [size, cell, origin])

  useLayoutEffect(() => {
    const node = canvas.current
    const context = node?.getContext('2d')
    if (node && context && view.cols > 0 && view.rows > 0)
      draw(node, context, battle(), theme, view)
  }, [theme, view])

  const rows = Array.from({ length: view.rows }, (_, row) => (view.row + row) * ROW_BYTES)
  const cols = Array.from({ length: view.cols }, (_, col) => view.col + col)
  return (
    <div {...rest} ref={box} className={cx('relative overflow-hidden bg-arena-bg', className)}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="absolute top-(--top) left-(--left) h-(--height) w-(--width)"
        style={vars({
          '--left': `${view.left}px`,
          '--top': `${view.top}px`,
          '--width': `${view.cols * view.cell}px`,
          '--height': `${view.rows * view.cell}px`,
        })}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {rows.map((address, row) =>
          address % 0x800 === 0 ? (
            <span
              key={address}
              className={cx(
                'absolute top-(--y) left-(--x) w-10 text-right text-[10px] leading-3.5 text-arena-ruler',
                address % 0x1000 === 0 && 'font-bold',
              )}
              style={vars({
                '--x': `${view.left - RULER}px`,
                '--y': `${view.top + row * view.cell}px`,
              })}
            >
              {hexAddress(address)}
            </span>
          ) : null,
        )}
        {view.lattice &&
          cols.map((col, n) =>
            col % 16 === 0 ? (
              <span
                key={col}
                className="absolute top-0 left-(--x) text-[10px] leading-3.5 text-arena-ruler"
                style={vars({ '--x': `${view.left + n * view.cell}px` })}
              >
                {hexByte(col)}
              </span>
            ) : null,
          )}
      </div>
      {children}
    </div>
  )
}

/** Where the grid goes in a box of `width` × `height` px, and how much of the core it shows. */
function layout(
  [width, height]: readonly [number, number],
  cell: number | undefined,
  origin: number,
): View {
  if (cell === undefined) {
    const fit = Math.max(1, Math.floor(Math.min((width - RULER) / 256, height / 256)))
    const side = 256 * fit
    return {
      cell: fit,
      cols: 256,
      rows: 256,
      row: 0,
      col: 0,
      left: Math.max(0, Math.floor((width - RULER - side) / 2)) + RULER,
      top: Math.max(0, Math.floor((height - side) / 2)),
      lattice: fit >= 4,
    }
  }
  const lattice = cell >= 4
  const top = lattice ? COLUMN_RULER : 0
  const row = Math.floor((origin % CORE_SIZE) / ROW_BYTES)
  const col = origin % ROW_BYTES
  return {
    cell,
    cols: Math.max(0, Math.min(ROW_BYTES - col, Math.floor((width - RULER) / cell))),
    rows: Math.max(0, Math.min(CORE_SIZE / ROW_BYTES - row, Math.floor((height - top) / cell))),
    row,
    col,
    left: RULER,
    top,
    lattice,
  }
}

function draw(
  node: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  state: Battle,
  theme: Theme,
  view: View,
): void {
  const { cell, cols, rows } = view
  const width = cols * cell
  const height = rows * cell
  const ratio = window.devicePixelRatio || 1
  node.width = Math.round(width * ratio)
  node.height = Math.round(height * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)

  const arena = ARENA_COLORS[theme]
  context.fillStyle = arena.bg
  context.fillRect(0, 0, width, height)

  /** The cell of `address` in view, px, or null when it is out of view. */
  const place = (address: number): readonly [x: number, y: number] | null => {
    const row = Math.floor(address / ROW_BYTES) - view.row
    const col = (address % ROW_BYTES) - view.col
    return row < 0 || col < 0 || row >= rows || col >= cols ? null : [col * cell, row * cell]
  }

  // Owned bytes: one pass sorts them by fill, then each fill draws its cells.
  const fills = new Map<string, number[]>()
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const address = (view.row + row) * ROW_BYTES + view.col + col
      const id = state.owner[address] ?? 0
      if (id === 0) continue
      const key = `${id - 1}:${state.zero[address]}`
      const list = fills.get(key)
      if (list) list.push(col * cell, row * cell)
      else fills.set(key, [col * cell, row * cell])
    }
  }
  const hues = BOT_HUES[theme]
  for (const [key, cells] of fills) {
    const [bot, zero] = key.split(':').map(Number) as [number, number]
    const [r, g, b] = tone(hues[bot % hues.length] as string, state.dead.has(bot))
    context.fillStyle = `rgb(${r} ${g} ${b} / ${zero ? OWNED_ZERO : OWNED})`
    for (let i = 0; i < cells.length; i += 2) {
      context.fillRect(cells[i] as number, cells[i + 1] as number, cell, cell)
    }
  }

  // The exec trail, then the write flash, each fading with its age.
  const glow = (touches: Battle['execs'], color: string, halfLife: number) => {
    context.fillStyle = color
    for (const { address, age } of touches) {
      const at = place(address)
      if (at === null) continue
      context.globalAlpha = Math.exp(-age / halfLife)
      context.fillRect(at[0], at[1], cell, cell)
    }
    context.globalAlpha = 1
  }
  glow(state.execs, arena.exec, 600)
  glow(state.writes, arena.write, 220)

  if (view.lattice) {
    context.fillStyle = arena.lattice
    for (let col = 1; col < cols; col++) context.fillRect(col * cell, 0, 1, height)
    for (let row = 1; row < rows; row++) context.fillRect(0, row * cell, width, 1)
  }

  // Each IP: a 1 px outline and a 2 px glow; the process that runs next is the brighter.
  context.strokeStyle = arena.ip
  context.shadowColor = arena.ip
  context.shadowBlur = 4
  context.lineWidth = 1
  for (const process of state.processes) {
    const at = place(process.ip)
    if (at === null) continue
    context.globalAlpha = process.front ? 1 : 0.6
    context.strokeRect(at[0] - 0.5, at[1] - 0.5, cell + 1, cell + 1)
  }
  context.globalAlpha = 1
  context.shadowBlur = 0
}

/** A bot's hue as RGB, desaturated when the bot is dead (its territory stays, faded). */
function tone(hex: string, dead: boolean): readonly [number, number, number] {
  const [r, g, b] = parseHex(hex)
  if (!dead) return [r, g, b]
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const fade = (c: number) => Math.round(c + (gray - c) * DEATH_FADE)
  return [fade(r), fade(g), fade(b)]
}
