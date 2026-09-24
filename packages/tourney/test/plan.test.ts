import { describe, expect, it } from 'bun:test'
import {
  advance,
  type Bracket,
  createBracket,
  type MatchResult,
  nextMatches,
  plannedMatches,
  playsThirdPlace,
  roundRobinSchedule,
} from '../src/index'

/** A whole match the lower entrant index wins. */
const won = (b: Bracket, x: number, y: number): MatchResult => {
  const points = x < y ? [3, 0] : [0, 3]
  return {
    key: `fake:${x},${y}`,
    names: [b.names[x] as string, b.names[y] as string],
    of: 1,
    rounds: [
      {
        round: 0,
        seed: 0,
        order: [0, 1],
        resultHash: '',
        durationCycles: 0,
        points,
        survivors: [],
        survival: [0, 0],
      },
    ],
    points,
  }
}

/** The matches a bracket of `n` actually plays, walkovers aside. */
function played(n: number, thirdPlace: boolean): number {
  let b = createBracket(
    Array.from({ length: n }, (_, i) => ({ name: `e${i}` })),
    { seeding: 'given', thirdPlace: thirdPlace && n >= 3 },
  )
  let count = 0
  for (let next = nextMatches(b)[0]; next !== undefined; next = nextMatches(b)[0]) {
    const [x, y] = next.slots.map((s) => s.entrant as number) as [number, number]
    b = advance(b, next.id, won(b, x, y))
    count++
  }
  return count
}

describe('plannedMatches', () => {
  it('counts every pair of a round robin, one melee, and none under 2 bots', () => {
    for (let n = 2; n <= 32; n++) {
      expect(plannedMatches('roundrobin', n)).toBe(roundRobinSchedule(n).length)
      expect(plannedMatches('melee', n)).toBe(1)
    }
    for (const format of ['roundrobin', 'bracket', 'melee'] as const) {
      expect(plannedMatches(format, 1)).toBe(0)
      expect(plannedMatches(format, 0)).toBe(0)
    }
  })

  it('counts the matches a bracket plays, with and without its third-place match', () => {
    for (let n = 2; n <= 32; n++) {
      expect(plannedMatches('bracket', n)).toBe(played(n, false))
      expect(plannedMatches('bracket', n, true)).toBe(played(n, true))
    }
    expect([3, 4].map((n) => playsThirdPlace(n, true))).toEqual([false, true])
    expect(playsThirdPlace(8, false)).toBe(false)
  })
})
