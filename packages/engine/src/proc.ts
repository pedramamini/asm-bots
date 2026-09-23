/**
 * Processes (ISA §5.1). A process is a row of ten uint16 fields: the eight 16-bit registers in
 * x86 order (ISA §1), then IP and FLAGS. A register code from the codec indexes the row
 * directly: `row[code]` is 16-bit register `code`.
 */

export const AX = 0
export const CX = 1
export const DX = 2
export const BX = 3
export const SP = 4
export const BP = 5
export const SI = 6
export const DI = 7
export const IP = 8
export const FLAGS = 9

/** Fields per process row. */
export const PROC_FIELDS = 10

/** One process's fields, a view into its queue's `data`. Index it with `AX`..`FLAGS`. */
export type ProcRow = Uint16Array

/**
 * Byte register `code`, x86 order (ISA §1): 0..3 are AL CL DL BL, the low halves of AX CX DX
 * BX; 4..7 are AH CH DH BH, their high halves.
 */
export function getReg8(row: ProcRow, code: number): number {
  return ((row[code & 3] as number) >> ((code & 4) << 1)) & 0xff
}

/** Sets byte register `code` to the low 8 bits of `v`, keeping the other half of the word. */
export function setReg8(row: ProcRow, code: number, v: number): void {
  const i = code & 3
  const shift = (code & 4) << 1
  row[i] = ((row[i] as number) & ~(0xff << shift)) | ((v & 0xff) << shift)
}

/**
 * A bot's process queue (ISA §5.1): a FIFO of up to `capacity` processes, front first.
 *
 * Rows never move. `data` holds a ring of `capacity` row numbers, then the rows. Ring positions
 * `head` to `head + size - 1` (mod `capacity`) hold the queued processes, front first. The
 * other positions hold the free rows, so the ring is always a permutation of the row numbers.
 * To move the front process to the back, `rotate` swaps two ring entries. It copies no
 * registers. `data`, `head`, and `size` are the whole state.
 *
 * A turn (ISA §5.2) runs the front process in place (`rows[front()]`), then calls `rotate` if
 * the process lives or `shift` if it dies. A spawn gets its row from `push`. The running
 * process is still in the queue, so the bot is at its cap when `size === capacity`.
 */
export class ProcQueue {
  readonly capacity: number
  /** The ring (`capacity` row numbers), then the rows (`PROC_FIELDS` each). */
  readonly data: Uint16Array
  /** `rows[r]` is row `r`, a view into `data`. */
  readonly rows: readonly ProcRow[]
  /** The ring position of the front process. */
  head = 0
  /** The number of queued processes. */
  size = 0

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0x10000) {
      throw new RangeError(`ProcQueue: capacity must be an integer in 1..65536, got ${capacity}`)
    }
    this.capacity = capacity
    this.data = new Uint16Array(capacity * (PROC_FIELDS + 1))
    const rows: ProcRow[] = []
    for (let r = 0; r < capacity; r++) {
      this.data[r] = r
      const at = capacity + r * PROC_FIELDS
      rows.push(this.data.subarray(at, at + PROC_FIELDS))
    }
    this.rows = rows
  }

  /** The row of the front process. */
  front(): number {
    if (this.size === 0) throw new RangeError('ProcQueue: empty')
    return this.data[this.head] as number
  }

  /** The row of the process `i` places behind the front: `at(0)` is `front()`. */
  at(i: number): number {
    if (!Number.isInteger(i) || i < 0 || i >= this.size) {
      throw new RangeError(`ProcQueue: no process at ${i} of ${this.size}`)
    }
    const p = this.head + i
    return this.data[p < this.capacity ? p : p - this.capacity] as number
  }

  /**
   * Adds a process at the back and returns its row. The row holds stale values, so the caller
   * sets all ten fields. The row is never one still queued.
   */
  push(): number {
    if (this.size === this.capacity) throw new RangeError('ProcQueue: full')
    const p = this.head + this.size
    this.size++
    return this.data[p < this.capacity ? p : p - this.capacity] as number
  }

  /**
   * Removes the front process and returns its row. The row keeps its values until a `push`
   * returns it.
   */
  shift(): number {
    if (this.size === 0) throw new RangeError('ProcQueue: empty')
    const h = this.head
    this.head = h + 1 === this.capacity ? 0 : h + 1
    this.size--
    return this.data[h] as number
  }

  /** Moves the front process to the back. Its row and registers stay where they are. */
  rotate(): void {
    if (this.size === 0) throw new RangeError('ProcQueue: empty')
    const h = this.head
    if (this.size < this.capacity) {
      // Swap the front row with the first free row, which then ends the free run.
      const p = h + this.size
      const t = p < this.capacity ? p : p - this.capacity
      const d = this.data
      const r = d[h] as number
      d[h] = d[t] as number
      d[t] = r
    }
    this.head = h + 1 === this.capacity ? 0 : h + 1
  }
}
