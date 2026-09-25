/**
 * A match's rotation (ISA §5.5): round i places the bots in the order `i mod N, i mod N + 1, ...`
 * with the seed `seed + i`. Its own module, apart from `runMatch`: the arena's setup checks a
 * match's placements with it and loads none of the engine's interpreter.
 */

/** Round `round`'s fighting order in a match of `n` bots: `order[j]` is the entrant placed j-th. */
export function roundOrder(n: number, round: number): number[] {
  return Array.from({ length: n }, (_, j) => (round + j) % n)
}

/** Round `round`'s placement seed in a match whose seed is `seed`: `seed + round`, mod 2^32. */
export function roundSeed(seed: number, round: number): number {
  return (seed + round) >>> 0
}
