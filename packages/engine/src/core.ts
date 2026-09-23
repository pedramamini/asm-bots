/** Core size in bytes: one flat address space, no segments (ISA §1). */
export const CORE_SIZE = 0x10000

/** Addresses wrap mod 64 KB (ISA §0.4): `a & ADDR_MASK`. */
export const ADDR_MASK = 0xffff

/**
 * Observes the core's writes: `len` bytes from `addr` (wrapping), each tagged `owner`. It runs
 * after the bytes change. The battle installs one to feed write events.
 */
export type WriteLog = (addr: number, len: number, owner: number) => void

/**
 * The 64 KB core and its owner map (ISA §1, §5.4). Addresses wrap mod 64 KB. Words are
 * little-endian and straddle `0xFFFF`/`0x0000`. Every write tags each byte it touches with
 * `owner`: 0 for nobody, bot index + 1 for a bot. Reads are untracked. Values keep their low 8
 * or 16 bits, so callers pass results unmasked.
 */
export class Core {
  readonly bytes = new Uint8Array(CORE_SIZE)
  readonly owner = new Uint8Array(CORE_SIZE)
  /** Called after every write when set. */
  onWrite: WriteLog | undefined = undefined

  read8(a: number): number {
    return this.bytes[a & ADDR_MASK] as number
  }

  read16(a: number): number {
    const i = a & ADDR_MASK
    return (this.bytes[i] as number) | ((this.bytes[(i + 1) & ADDR_MASK] as number) << 8)
  }

  write8(a: number, v: number, owner: number): void {
    const i = a & ADDR_MASK
    this.bytes[i] = v
    this.owner[i] = owner
    this.onWrite?.(i, 1, owner)
  }

  write16(a: number, v: number, owner: number): void {
    const i = a & ADDR_MASK
    const j = (i + 1) & ADDR_MASK
    this.bytes[i] = v
    this.bytes[j] = v >> 8
    this.owner[i] = owner
    this.owner[j] = owner
    this.onWrite?.(i, 2, owner)
  }

  /**
   * Writes `src` from `a` as one write: the loader's path (ISA §5.5). Bytes past `0xFFFF` wrap
   * to `0x0000`, as a run of `write8` calls would. An empty `src` writes nothing.
   */
  fill(a: number, src: ArrayLike<number>, owner: number): void {
    const start = a & ADDR_MASK
    const n = src.length
    if (n === 0) return
    for (let k = 0; k < n; k++) {
      const i = (start + k) & ADDR_MASK
      this.bytes[i] = src[k] as number
      this.owner[i] = owner
    }
    this.onWrite?.(start, n, owner)
  }
}
