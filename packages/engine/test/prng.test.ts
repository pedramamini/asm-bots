import { describe, expect, it } from 'bun:test'
import { Pcg32, type Pcg32State } from '../src/index'

/*
 * Expected values come from the pcg-c-basic reference (https://github.com/imneme/pcg-c-basic),
 * compiled with clang: `pcg32_srandom_r(&rng, seed, seq)`, then `pcg32_random_r` or
 * `pcg32_boundedrand_r`. The demo round is `pcg32-demo` output, which matches pcg-c's
 * `test-high/expected/check-pcg32.out`.
 */

const draws = (g: Pcg32, n: number) => Array.from({ length: n }, () => g.next())
const bounded = (g: Pcg32, bound: number, n: number) =>
  Array.from({ length: n }, () => g.nextInt(bound))

/** The state after `n` raw draws from a fresh `(seed, seq)` generator. */
function stateAfter(seed: number, seq: number, n: number): Pcg32State {
  const g = new Pcg32(seed, seq)
  for (let i = 0; i < n; i++) g.next()
  return g.serialize()
}

/** A BigInt transcription of pcg_basic.c: an independent model of the uint32-halves arithmetic. */
function model(seed: number, seq: number) {
  const mask = (1n << 64n) - 1n
  const inc = ((BigInt(seq) << 1n) | 1n) & mask
  let state = 0n
  const step = () => {
    state = (state * 6364136223846793005n + inc) & mask
  }
  step()
  state = (state + BigInt(seed)) & mask
  step()
  return {
    next(): number {
      const old = state
      step()
      const x = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn)
      const rot = Number(old >> 59n)
      return ((x >>> rot) | (x << (-rot & 31))) >>> 0
    },
    serialize: (): Pcg32State => [
      Number(state >> 32n),
      Number(state & 0xffffffffn),
      Number(inc >> 32n),
      Number(inc & 0xffffffffn),
    ],
  }
}

/** A deterministic stream of uint32s for test inputs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s
  }
}

describe('Pcg32 outputs', () => {
  it('gives the PCG reference vector for seed 42, seq 54', () => {
    expect(draws(new Pcg32(42, 54), 6)).toEqual([
      0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e,
    ])
  })

  it('plays round 1 of pcg32-demo: coins, dice, and a shuffled deck', () => {
    const g = new Pcg32(42, 54)
    draws(g, 6)
    const coins = bounded(g, 2, 65)
      .map((b) => (b ? 'H' : 'T'))
      .join('')
    const rolls = bounded(g, 6, 33)
      .map((r) => r + 1)
      .join(' ')
    const cards = Array.from({ length: 52 }, (_, i) => i)
    for (let i = 52; i > 1; i--) {
      const chosen = g.nextInt(i)
      ;[cards[chosen], cards[i - 1]] = [cards[i - 1] as number, cards[chosen] as number]
    }
    const deck = cards.map((c) => `${'A23456789TJQK'[c >> 2]}${'hcds'[c & 3]}`).join(' ')
    expect(coins).toBe('HHTTTHTHHHTHTTTHHHHHTTTHHHTHTHTHTTHTTTHHHHHHTTTTHHTTTTTHTTTTTTTHT')
    expect(rolls).toBe('3 4 1 1 2 2 3 2 4 3 2 4 3 3 5 2 3 1 3 1 5 1 4 1 5 6 4 6 6 2 6 3 3')
    expect(deck).toBe(
      'Qd Ks 6d 3s 3d 4c 3h Td Kc 5c Jh Kd Jd As 4s 4h Ad Th Ac Jc 7s Qs ' +
        '2s 7h Kh 2d 6c Ah 4d Qh 9h 6s 5s 2c 9c Ts 8d 9s 3c 8c Js 5d 2h 6h ' +
        '7d 8s 9d 5h 8h Qc 7c Tc',
    )
  })

  it('gives the reference output one million draws in', () => {
    const g = new Pcg32(42, 54)
    let x = 0
    for (let i = 0; i < 1_000_000; i++) x = g.next()
    expect(x).toBe(0xef1e2afa)
    expect(g.serialize()).toEqual([0x5230a7ae, 0x1b365db8, 0, 0x6d])
  })

  it('seeds stream 0 when no seq is given: the battle PCG32(seed)', () => {
    const vectors = [
      [0, [0xe4c14788, 0x379c6516, 0x5c4ab3bb, 0x601d23e0, 0x1c382b8c, 0xd1faab16]],
      [1, [0xe2393051, 0x01112f35, 0xd3509d35, 0x0b932f4a, 0x8aa46776, 0x8c532036]],
      [0xffffffff, [0x85c956c0, 0xb88786d1, 0x4cb8f16b, 0x75b8a28f, 0x557839c5, 0xdb39f8a1]],
      [0xdeadbeef, [0x14d45b8b, 0xec21c400, 0x1426a5cf, 0x6ef02c0a, 0xbe3b319a, 0xb8867e12]],
    ] as const
    for (const [seed, want] of vectors) {
      expect(draws(new Pcg32(seed), 6)).toEqual([...want])
      expect(draws(new Pcg32(seed, 0), 6)).toEqual([...want])
    }
  })

  it('carries seq bit 31 into the high half of inc', () => {
    expect(draws(new Pcg32(0x12345678, 0x80000000), 6)).toEqual([
      0x6e8fbc9d, 0xaed17c40, 0xdc84abd8, 0x15e42304, 0x71b2f3ed, 0xfa897170,
    ])
    expect(draws(new Pcg32(0xffffffff, 0xffffffff), 6)).toEqual([
      0xa28e4c34, 0xcbc6647f, 0x4ec04ffd, 0xad42ce33, 0xead28f9c, 0x052661fd,
    ])
    expect(new Pcg32(0, 0x80000000).serialize().slice(2)).toEqual([1, 1])
    expect(new Pcg32(0, 0xffffffff).serialize().slice(2)).toEqual([1, 0xffffffff])
  })

  it('matches a BigInt model draw for draw, 5,000 draws on each of 40 streams', () => {
    const rand = lcg(0x9c32)
    const pairs = [
      [0, 0],
      [42, 54],
      [0xffffffff, 0xffffffff],
      [0x80000000, 0x7fffffff],
      ...Array.from({ length: 36 }, () => [rand(), rand()]),
    ]
    const wrong: string[] = []
    for (const [seed = 0, seq = 0] of pairs) {
      const [g, m] = [new Pcg32(seed, seq), model(seed, seq)]
      for (let i = 0; i < 5000 && wrong.length < 10; i++) {
        const [got, want] = [g.next(), m.next()]
        if (got !== want) wrong.push(`(${seed}, ${seq}) draw ${i}: ${got}, model ${want}`)
      }
      expect(g.serialize()).toEqual(m.serialize())
    }
    expect(wrong).toEqual([])
  })
})

describe('Pcg32.nextInt', () => {
  it('matches pcg32_boundedrand_r, including the draws it drops', () => {
    // [bound, raw draws consumed, results]. Under 2^31 + 1, 16 results drop 9 draws.
    const cases = [
      [
        0x80000001,
        25,
        [
          559678134, 974992175, 64156306, 1067743306, 1273847917, 1069982636, 19922796, 1713320025,
          2033732495, 1836607525, 573805929, 81421794, 1322676881, 851508741, 293695791, 837321402,
        ],
      ],
      [
        0xffffffff,
        8,
        [
          2707161783, 2068313097, 3122475824, 2211639955, 3215226955, 3421331566, 3217466285,
          2167406445,
        ],
      ],
      [3, 24, [0, 0, 2, 1, 1, 1, 2, 0, 0, 2, 0, 1, 1, 1, 0, 0, 0, 0, 2, 0, 0, 1, 1, 0]],
      [65536, 8, [695, 62473, 13104, 62099, 30795, 24686, 41901, 65389]],
      [1, 4, [0, 0, 0, 0]],
    ] as const
    for (const [bound, consumed, want] of cases) {
      const g = new Pcg32(42, 54)
      expect(bounded(g, bound, want.length)).toEqual([...want])
      expect(g.serialize()).toEqual(stateAfter(42, 54, consumed))
    }
  })

  it('keeps a draw equal to the threshold', () => {
    // State 0 outputs 0, which is 2^32 mod n for n = 1 and 2^32: kept, so one draw each.
    for (const n of [1, 0x100000000]) {
      const g = Pcg32.deserialize([0, 0, 0, 1])
      expect(g.nextInt(n)).toBe(0)
      expect(g.serialize()).toEqual([0, 1, 0, 1])
    }
  })

  it('returns next() unchanged for a bound of 2^32', () => {
    const [a, b] = [new Pcg32(7, 9), new Pcg32(7, 9)]
    expect(bounded(a, 0x100000000, 100)).toEqual(draws(b, 100))
  })

  it('stays in 0..n-1 for bounds from 1 to 2^32', () => {
    const g = new Pcg32(1, 2)
    const bounds = [1, 2, 3, 7, 52, 1000, 65536, 0x7fffffff, 0x80000000, 0x80000001, 0xffffffff]
    for (const n of [...bounds, 0x100000000]) {
      for (const x of bounded(g, n, 500)) {
        if (!(Number.isInteger(x) && x >= 0 && x < n)) throw new Error(`nextInt(${n}) gave ${x}`)
      }
    }
    const seen = new Set(bounded(g, 7, 500))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('rejects a bound that is not an integer in 1..2^32, without drawing', () => {
    const g = new Pcg32(3, 4)
    const before = g.serialize()
    for (const n of [0, -1, 1.5, 0x100000001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => g.nextInt(n)).toThrow(RangeError)
    }
    expect(g.serialize()).toEqual(before)
  })
})

describe('Pcg32 seeding', () => {
  it('sets inc to (seq << 1) | 1 and takes two steps, as pcg32_srandom_r does', () => {
    expect(new Pcg32(42, 54).serialize()).toEqual([0x185706b8, 0x2c2e03f8, 0, 0x6d])
    expect(stateAfter(42, 54, 6)).toEqual([0xbeb6d0b7, 0x3fdb974a, 0, 0x6d])
  })

  it('rejects a seed or seq that is not a uint32', () => {
    for (const bad of [-1, 0x100000000, 1.5, Number.NaN]) {
      expect(() => new Pcg32(bad)).toThrow(RangeError)
      expect(() => new Pcg32(0, bad)).toThrow(RangeError)
    }
  })

  it('gives different streams for different seeds and seqs', () => {
    const first = (seed: number, seq: number) => draws(new Pcg32(seed, seq), 4).join()
    const all = [first(0, 0), first(1, 0), first(0, 1), first(1, 1), first(42, 54)]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('Pcg32 serialize and deserialize', () => {
  it('round-trips: the copy continues exactly where the original stopped', () => {
    const g = new Pcg32(42, 54)
    draws(g, 1234)
    const copy = Pcg32.deserialize(g.serialize())
    expect(copy.serialize()).toEqual(g.serialize())
    expect(draws(copy, 1000)).toEqual(draws(g, 1000))
    expect(copy.nextInt(0x80000001)).toBe(g.nextInt(0x80000001))
    expect(copy.serialize()).toEqual(g.serialize())
  })

  it('round-trips a high-half inc', () => {
    const g = new Pcg32(0xffffffff, 0xffffffff)
    const copy = Pcg32.deserialize(g.serialize())
    expect(draws(copy, 100)).toEqual(draws(g, 100))
  })

  it('serializes to four uint32s that survive structuredClone and JSON', () => {
    const g = new Pcg32(9, 10)
    draws(g, 10)
    const state = g.serialize()
    expect(state.length).toBe(4)
    for (const x of state) expect(Number.isInteger(x) && x >= 0 && x <= 0xffffffff).toBe(true)
    const viaClone = Pcg32.deserialize(structuredClone(state))
    const viaJson = Pcg32.deserialize(JSON.parse(JSON.stringify(state)))
    const want = draws(g, 50)
    expect(draws(viaClone, 50)).toEqual(want)
    expect(draws(viaJson, 50)).toEqual(want)
  })

  it('makes an independent copy', () => {
    const g = new Pcg32(5, 6)
    const state = g.serialize()
    const copy = Pcg32.deserialize(state)
    draws(copy, 10)
    expect(g.serialize()).toEqual(state)
    expect(Pcg32.deserialize(state).serialize()).toEqual(state)
  })

  it('rejects anything but four uint32s with an odd inc', () => {
    const bad: unknown[] = [
      [1, 2, 3],
      [1, 2, 3, 5, 7],
      [1, 2, 3, 4],
      [1, 2, 3, 1.5],
      [-1, 2, 3, 5],
      [1, 0x100000000, 3, 5],
      [1, 2, Number.NaN, 5],
      ['1', 2, 3, 5],
      { 0: 1, 1: 2, 2: 3, 3: 5, length: 4 },
      null,
    ]
    for (const state of bad) {
      expect(() => Pcg32.deserialize(state as Pcg32State)).toThrow(RangeError)
    }
    expect(Pcg32.deserialize([0, 0, 0, 1]).serialize()).toEqual([0, 0, 0, 1])
  })
})
