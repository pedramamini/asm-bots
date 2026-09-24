/**
 * The memory panel's window (PRODUCT_SPEC §3): `MEMORY_ROWS` lines of disassembly of the core,
 * one instruction a row, around an address (the IP it follows, or a `goto`). x86 code has no marks
 * between its instructions, so a window that shows the rows before an address must find a start
 * whose sweep lands on it (`windowStart`). The window keeps its start while its address moves
 * inside it (`followStart`), so stepping through a loop does not scroll the rows.
 *
 * Where the loaded bots' listings say an instruction starts (`starts`), a sweep starts one there:
 * the bytes before it that do not end in step are a `db`. So a bot's code reads as its source
 * wrote it, whatever lies before it in the core (a return address its `call` pushed, a bomb).
 */
import { type DisLine, disassemble } from '@asmbots/asm'
import { decode } from '@asmbots/codec'

/** Rows in the memory panel (PRODUCT_SPEC §3). */
export const MEMORY_ROWS = 32
/** A new window puts its address this many rows down: more of what runs next than of what ran. */
export const ROWS_BEFORE = 8
/** Rows at each edge that an address the window follows may not stand in. */
export const FOLLOW_MARGIN = 3
/** The longest instruction, in bytes (ISA §7). */
const MAX_LENGTH = 6

/** `count` bytes of `core` from `start`, wrapping at 64 KB. */
function bytesFrom(core: Uint8Array, start: number, count: number): Uint8Array {
  const out = new Uint8Array(count)
  for (let k = 0; k < count; k++) out[k] = core[(start + k) & 0xffff] as number
  return out
}

/**
 * `rows` lines of `core` from `start`: a linear sweep, wrapping at 64 KB. `names` names the
 * targets of jumps, as the disassembler takes them.
 */
export function sweep(
  core: Uint8Array,
  start: number,
  rows = MEMORY_ROWS,
  names?: ReadonlyMap<number, string>,
  starts?: ReadonlySet<number>,
): DisLine[] {
  // Enough bytes for `rows` of the longest instruction: every row is whole.
  const span = rows * MAX_LENGTH
  const bytes = bytesFrom(core, start & 0xffff, span)
  const lines: DisLine[] = []
  // A known start cuts the sweep: each part disassembles on its own, a cut instruction as `db`.
  let from = 0
  for (let k = 1; k <= span && lines.length < rows; k++) {
    if (k < span && starts?.has((start + k) & 0xffff) !== true) continue
    const part = bytes.subarray(from, k)
    lines.push(...disassemble(part, (start + from) & 0xffff, { symbols: names }))
    from = k
  }
  return lines.slice(0, rows)
}

/**
 * A start for a window with a row at `target`, `before` rows down, or as near to that as any
 * start in reach gets. It tries each start back to `before` of the longest instruction. A sweep
 * falls into step with the code within a few instructions, so many starts land on `target`; of
 * those with `before` rows, it takes the one whose rows hold the fewest bytes that start no
 * instruction, and of those the farthest back. With none, `target` starts the window.
 */
export function windowStart(
  core: Uint8Array,
  target: number,
  before = ROWS_BEFORE,
  starts?: ReadonlySet<number>,
): number {
  if (before <= 0) return target & 0xffff
  const reach = before * MAX_LENGTH
  const from = (target - reach) & 0xffff
  const bytes = bytesFrom(core, from, reach + MAX_LENGTH)
  const read = (offset: number) => bytes[offset] ?? 0
  // The length of the row at each offset, and whether its first byte starts no instruction. A
  // known start cuts the row before it, as `sweep` does.
  const length = new Uint8Array(reach)
  const bad = new Uint8Array(reach)
  for (let offset = 0; offset < reach; offset++) {
    const d = decode(read, offset)
    let n = Math.max(1, d.length)
    for (let k = 1; k < n; k++) {
      if (starts?.has((from + offset + k) & 0xffff) === true) {
        n = k
        break
      }
    }
    length[offset] = n
    bad[offset] = 'instr' in d && n === d.length ? 0 : 1
  }
  // Lower is better: [0, bad rows] with `before` rows, else [1, -rows]. The farthest start comes
  // first, so it keeps a tie.
  let bestKey: readonly [number, number] | null = null
  let bestStart = target & 0xffff
  for (let start = 0; start < reach; start++) {
    const rows: number[] = []
    let offset = start
    while (offset < reach) {
      rows.push(offset)
      offset += length[offset] as number
    }
    if (offset !== reach) continue
    const shown = rows.slice(-before)
    const key: readonly [number, number] =
      shown.length === before
        ? [0, shown.reduce((n, at) => n + (bad[at] as number), 0)]
        : [1, -shown.length]
    if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      bestKey = key
      bestStart = (from + (shown[0] as number)) & 0xffff
    }
  }
  return bestStart
}

/**
 * The start of a window that shows `target`: `start` again while a row of its sweep starts at
 * `target`, clear of the edges; else a new window with `target` `ROWS_BEFORE` rows down.
 */
export function followStart(
  core: Uint8Array,
  start: number | null,
  target: number,
  starts?: ReadonlySet<number>,
): number {
  if (start !== null) {
    const rows = sweep(core, start, MEMORY_ROWS, undefined, starts)
    const row = rows.findIndex((line) => line.address === (target & 0xffff))
    if (row >= FOLLOW_MARGIN && row < MEMORY_ROWS - FOLLOW_MARGIN) return start
  }
  return windowStart(core, target, ROWS_BEFORE, starts)
}
