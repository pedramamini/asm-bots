/**
 * PCG32 (XSH RR: 64-bit state, 64-bit odd increment, 32-bit output), bit-exact with the
 * pcg-c-basic reference. `new Pcg32(seed, seq)` is `pcg32_srandom_r(seed, seq)`, `next` is
 * `pcg32_random_r`, and `nextInt` is `pcg32_boundedrand_r`. The 64-bit arithmetic runs on uint32
 * halves, so no BigInt. The battle's `PCG32(seed)` (ISA §5.5) is `new Pcg32(seed)`, stream 0.
 */

/** The PCG multiplier 6364136223846793005 (`0x5851F42D4C957F2D`), as uint32 halves. */
const MUL_HI = 0x5851f42d
const MUL_LO = 0x4c957f2d

const UINT32_MAX = 0xffffffff

/**
 * A generator's full state: the 64-bit `state` and `inc` as uint32 halves, with `incLo` odd.
 * Plain numbers, so it survives `structuredClone` and JSON.
 */
export type Pcg32State = readonly [stateHi: number, stateLo: number, incHi: number, incLo: number]

function isUint32(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= 0 && (x as number) <= UINT32_MAX
}

/** The high 32 bits of the 64-bit product of uint32 `a` and `b`, by 16-bit halves. */
function mulHi(a: number, b: number): number {
  const a0 = a & 0xffff
  const a1 = a >>> 16
  const b0 = b & 0xffff
  const b1 = b >>> 16
  // Each sum stays below 2^32, so it is an exact double and the shifts see every bit.
  const mid = a1 * b0 + ((a0 * b0) >>> 16)
  const mid2 = a0 * b1 + (mid & 0xffff)
  return (a1 * b1 + (mid >>> 16) + (mid2 >>> 16)) >>> 0
}

export class Pcg32 {
  private stateHi = 0
  private stateLo = 0
  private incHi = 0
  private incLo = 1

  /** `pcg32_srandom_r(seed, seq)`. Both are uint32; `seq` selects the stream. */
  constructor(seed: number, seq = 0) {
    if (!isUint32(seed)) throw new RangeError(`Pcg32: seed must be a uint32, got ${seed}`)
    if (!isUint32(seq)) throw new RangeError(`Pcg32: seq must be a uint32, got ${seq}`)
    // inc = (seq << 1) | 1; state = 0; step; state += seed; step.
    this.incHi = seq >>> 31
    this.incLo = ((seq << 1) | 1) >>> 0
    this.step()
    const lo = this.stateLo + seed
    this.stateLo = lo >>> 0
    this.stateHi = (this.stateHi + (lo > UINT32_MAX ? 1 : 0)) >>> 0
    this.step()
  }

  /** The next uint32 (`pcg32_random_r`). */
  next(): number {
    const hi = this.stateHi
    const lo = this.stateLo
    this.step()
    // XSH RR on the old state: ((old >> 18) ^ old) >> 27 cut to 32 bits, rotated right by old >> 59.
    const xHi = hi ^ (hi >>> 18)
    const xLo = lo ^ ((lo >>> 18) | (hi << 14))
    const x = ((xLo >>> 27) | (xHi << 5)) >>> 0
    const rot = hi >>> 27
    return ((x >>> rot) | (x << (-rot & 31))) >>> 0
  }

  /**
   * A uniform integer in `0..n-1`, for an integer `n` in `1..2^32` (`pcg32_boundedrand_r`). Draws
   * below `2^32 mod n` are dropped so that no residue is favored, so a call draws at least once.
   */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000) {
      throw new RangeError(`Pcg32: nextInt bound must be an integer in 1..2^32, got ${n}`)
    }
    const threshold = (0x100000000 - n) % n
    for (;;) {
      const r = this.next()
      if (r >= threshold) return r % n
    }
  }

  /** The full state, for snapshots. */
  serialize(): Pcg32State {
    return [this.stateHi, this.stateLo, this.incHi, this.incLo]
  }

  /** A generator that continues exactly where the one that gave `state` stopped. */
  static deserialize(state: Pcg32State): Pcg32 {
    if (!Array.isArray(state) || state.length !== 4 || !state.every(isUint32)) {
      throw new RangeError('Pcg32: a serialized state is four uint32s')
    }
    if ((state[3] & 1) === 0) throw new RangeError('Pcg32: a serialized inc is odd')
    const g = new Pcg32(0)
    g.stateHi = state[0]
    g.stateLo = state[1]
    g.incHi = state[2]
    g.incLo = state[3]
    return g
  }

  /** state = state * MUL + inc, mod 2^64. */
  private step(): void {
    const hi = this.stateHi
    const lo = this.stateLo
    const sumLo = (Math.imul(lo, MUL_LO) >>> 0) + this.incLo
    const carry = sumLo > UINT32_MAX ? 1 : 0
    const prodHi = mulHi(lo, MUL_LO) + Math.imul(lo, MUL_HI) + Math.imul(hi, MUL_LO)
    this.stateLo = sumLo >>> 0
    this.stateHi = (prodHi + this.incHi + carry) >>> 0
  }
}
