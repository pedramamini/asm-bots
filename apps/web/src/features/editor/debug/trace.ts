/**
 * The Trace panel's data (PRODUCT_SPEC §3): the last `TRACE_DEPTH` instructions of each process,
 * as `DebugSession` runs them. The session's sink hands each instruction over before it runs, so a
 * record holds the bytes the process ran and the registers it ran them on, even when the code
 * changes later. A process keeps its queue row from its spawn to its death, and a later spawn can
 * reuse the row: a spawn leaves a mark in the row's ring, and a trace stops at the mark. Step back
 * drops the records of the cycles it goes back over (`trim`).
 */
import { disassemble } from '@asmbots/asm'
import { AX, BP, BX, CX, DI, DX, FLAGS, type ProcRow, SI, SP } from '@asmbots/engine'
import type { ProcRef, Registers } from './session'

/** Instructions kept per process (PRODUCT_SPEC §3). */
export const TRACE_DEPTH = 200

/** The longest instruction, in bytes (ISA §7). */
const MAX_LENGTH = 6

/** Per record: the length (0 for a spawn's mark), the address, 3 words of bytes, 8 registers, FLAGS. */
const FIELDS = 14
const LEN = 0
const ADDR = 1
const BYTES = 2
const REGS = 5
const FLAGS_AT = 13

/** The registers in the CLI's order (ISA §1 names), each with its field in a process row. */
const ORDER: readonly (readonly [keyof Registers, number])[] = [
  ['ax', AX],
  ['bx', BX],
  ['cx', CX],
  ['dx', DX],
  ['si', SI],
  ['di', DI],
  ['bp', BP],
  ['sp', SP],
]

/** One instruction a process ran. */
export interface TraceEntry extends ProcRef {
  /** The cycle it ran in. */
  readonly cycle: number
  readonly addr: number
  /** The instruction's bytes as the process ran them: 1..6. */
  readonly bytes: Uint8Array
  /** The registers and FLAGS as the instruction found them. */
  readonly regs: Registers
  readonly flags: number
}

/** A ring of one queue row's records, oldest first. */
class Ring {
  readonly cycles: Uint32Array
  readonly data: Uint16Array
  start = 0
  length = 0

  constructor(depth: number) {
    this.cycles = new Uint32Array(depth)
    this.data = new Uint16Array(depth * FIELDS)
  }

  /** A new record's slot: the oldest one's when the ring is full. */
  add(cycle: number): number {
    const depth = this.cycles.length
    let slot: number
    if (this.length < depth) {
      slot = (this.start + this.length) % depth
      this.length++
    } else {
      slot = this.start
      this.start = (this.start + 1) % depth
    }
    this.cycles[slot] = cycle
    return slot * FIELDS
  }
}

/** The instructions each process ran, the newest `depth` of each. */
export class TraceLog {
  readonly depth: number
  /** Per bot, per queue row: its ring, made at its first record. */
  private rings: (Ring | undefined)[][] = []

  constructor(depth = TRACE_DEPTH) {
    if (!Number.isInteger(depth) || depth < 1) {
      throw new RangeError(`TraceLog: depth is a positive integer, got ${depth}`)
    }
    this.depth = depth
  }

  /** Row `row` of `bot` runs the `len`-byte instruction at `addr` of `core`, from `regs`. */
  exec(
    cycle: number,
    bot: number,
    row: number,
    addr: number,
    len: number,
    core: Uint8Array,
    regs: ProcRow,
  ): void {
    // Unrolled: this runs for every instruction of every process in a debug run.
    const ring = this.ring(bot, row)
    const o = ring.add(cycle)
    const d = ring.data
    d[o + LEN] = len < 1 ? 1 : len > MAX_LENGTH ? MAX_LENGTH : len
    d[o + ADDR] = addr
    // All six bytes: `entries` reads the instruction's own.
    d[o + BYTES] = (core[addr] as number) | ((core[(addr + 1) & 0xffff] as number) << 8)
    d[o + BYTES + 1] =
      (core[(addr + 2) & 0xffff] as number) | ((core[(addr + 3) & 0xffff] as number) << 8)
    d[o + BYTES + 2] =
      (core[(addr + 4) & 0xffff] as number) | ((core[(addr + 5) & 0xffff] as number) << 8)
    d[o + REGS] = regs[AX] as number
    d[o + REGS + 1] = regs[BX] as number
    d[o + REGS + 2] = regs[CX] as number
    d[o + REGS + 3] = regs[DX] as number
    d[o + REGS + 4] = regs[SI] as number
    d[o + REGS + 5] = regs[DI] as number
    d[o + REGS + 6] = regs[BP] as number
    d[o + REGS + 7] = regs[SP] as number
    d[o + FLAGS_AT] = regs[FLAGS] as number
  }

  /** A spawn starts a process in row `row` of `bot`: its trace starts here. */
  spawn(cycle: number, bot: number, row: number): void {
    const ring = this.ring(bot, row)
    const o = ring.add(cycle)
    ring.data.fill(0, o, o + FIELDS)
  }

  /** Drops the records of cycle `cycle` and later: a step back to `cycle`. */
  trim(cycle: number): void {
    for (const rows of this.rings) {
      for (const ring of rows) {
        if (ring === undefined) continue
        const depth = ring.cycles.length
        while (
          ring.length > 0 &&
          (ring.cycles[(ring.start + ring.length - 1) % depth] as number) >= cycle
        ) {
          ring.length--
        }
      }
    }
  }

  /** Drops every record: a new battle. */
  clear(): void {
    this.rings = []
  }

  /** The instructions the process in row `row` of `bot` ran, oldest first: its newest `depth`. */
  entries(bot: number, row: number): TraceEntry[] {
    const ring = this.rings[bot]?.[row]
    if (ring === undefined) return []
    const depth = ring.cycles.length
    const out: TraceEntry[] = []
    for (let i = ring.length - 1; i >= 0; i--) {
      const slot = (ring.start + i) % depth
      const o = slot * FIELDS
      const d = ring.data
      const len = d[o + LEN] as number
      // A spawn's mark: what is older is an earlier process of the row.
      if (len === 0) break
      const bytes = new Uint8Array(len)
      for (let k = 0; k < len; k++) {
        const word = d[o + BYTES + (k >> 1)] as number
        bytes[k] = (k & 1) === 0 ? word & 0xff : word >> 8
      }
      const regs: Record<string, number> = {}
      ORDER.forEach(([name], k) => {
        regs[name] = d[o + REGS + k] as number
      })
      out.push({
        cycle: ring.cycles[slot] as number,
        bot,
        row,
        addr: d[o + ADDR] as number,
        bytes,
        regs: regs as unknown as Registers,
        flags: d[o + FLAGS_AT] as number,
      })
    }
    return out.reverse()
  }

  private ring(bot: number, row: number): Ring {
    let rows = this.rings[bot]
    if (rows === undefined) {
      rows = []
      this.rings[bot] = rows
    }
    let ring = rows[row]
    if (ring === undefined) {
      ring = new Ring(this.depth)
      rows[row] = ring
    }
    return ring
  }
}

/** FLAGS as the CLI trace writes it: `ODITSZAPC`, uppercase for a set flag. */
const FLAG_BITS: readonly (readonly [string, number])[] = [
  ['o', 11],
  ['d', 10],
  ['i', 9],
  ['t', 8],
  ['s', 7],
  ['z', 6],
  ['a', 4],
  ['p', 2],
  ['c', 0],
]

/** `flags` as `ODITSZAPC` letters: uppercase when set, lowercase when clear. */
export function flagLetters(flags: number): string {
  return FLAG_BITS.map(([letter, bit]) =>
    (flags >> bit) & 1 ? letter.toUpperCase() : letter,
  ).join('')
}

const hex4 = (v: number) => v.toString(16).padStart(4, '0')

/** The instruction's text as the disassembler writes it at its address. */
export function traceText(entry: TraceEntry): string {
  return disassemble(entry.bytes, entry.addr)[0]?.text ?? ''
}

/** The columns of `traceLine`, as the CLI's `--trace` heads them (apps/cli/README.md). */
export const TRACE_HEADER = [
  'cycle'.padStart(10),
  'bot',
  'proc',
  'addr'.padEnd(6),
  'bytes'.padEnd(17),
  `${'text'.padEnd(24)} |`,
  `${ORDER.map(([name]) => name.padEnd(4)).join(' ')} |`,
  'ODITSZAPC',
].join(' ')

/**
 * One instruction in the CLI's trace format (`asmbots fight --trace`, apps/cli/README.md):
 * `cycle bot proc addr bytes text | ax bx cx dx si di bp sp | ODITSZAPC`. The registers are the
 * ones the instruction found; the next line shows what it left.
 */
export function traceLine(entry: TraceEntry, text = traceText(entry)): string {
  const bytes = Array.from(entry.bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
  const regs = ORDER.map(([name]) => hex4(entry.regs[name])).join(' ')
  return [
    String(entry.cycle).padStart(10),
    String(entry.bot).padStart(3),
    String(entry.row).padStart(4),
    `0x${hex4(entry.addr)}`,
    bytes.padEnd(17),
    `${text.padEnd(24)} |`,
    `${regs} |`,
    flagLetters(entry.flags),
  ].join(' ')
}
