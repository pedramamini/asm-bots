import { describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import {
  iterateRoundRobin,
  MAX_GROUP_ENTRANTS,
  type MatchResult,
  matchHash,
  type RoundRobinResult,
  roundRobin,
  roundRobinSchedule,
  runMatch,
  standingsFromMatches,
} from '../src/index'

const bot = (name: string, bytes: readonly number[]): LoadedBot => ({
  name,
  bytes: Uint8Array.from(bytes),
})

/** `jmp short $`: lives until the cycle cap. */
const loop = (name: string) => bot(name, [0xeb, 0xfe])
/** `dat`: dies on its first instruction. */
const dat = (name: string) => bot(name, [0x00, 0x00])

const CONFIG = { maxCycles: 100, seed: 3 }

function choose(n: number, k: number): number {
  let c = 1
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1)
  return c
}

/** A made-up finished match with the given points. */
const fake = (points: number[]): MatchResult => ({
  key: 'fake',
  names: points.map((_, i) => `e${i}`),
  of: 1,
  rounds: [],
  points,
})

describe('roundRobinSchedule', () => {
  it('schedules every pair once, for 3..32 entrants', () => {
    for (let n = 3; n <= 32; n++) {
      const s = roundRobinSchedule(n)
      expect(s.length).toBe((n * (n - 1)) / 2)
      const keys = new Set(s.map((m) => m.entrants.join(',')))
      expect(keys.size).toBe(s.length)
      for (const [i, m] of s.entries()) {
        expect(m.id).toBe(i)
        const [a, b] = m.entrants as [number, number]
        expect(m.entrants.length).toBe(2)
        expect(a).toBeLessThan(b)
        expect(b).toBeLessThan(n)
      }
    }
  })

  it('schedules every k-subset once', () => {
    for (let n = 3; n <= MAX_GROUP_ENTRANTS; n++) {
      for (let k = 3; k <= Math.min(n, 6); k++) {
        const s = roundRobinSchedule(n, k)
        expect(s.length).toBe(choose(n, k))
        expect(new Set(s.map((m) => m.entrants.join(','))).size).toBe(s.length)
        for (const m of s) {
          expect(m.entrants.length).toBe(k)
          expect([...m.entrants].sort((x, y) => x - y)).toEqual([...m.entrants])
        }
      }
    }
    expect(roundRobinSchedule(4, 3).map((m) => m.entrants)).toEqual([
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
    ])
    expect(roundRobinSchedule(5, 5).map((m) => m.entrants)).toEqual([[0, 1, 2, 3, 4]])
  })

  it('caps k-subsets at 16 entrants', () => {
    expect(roundRobinSchedule(16, 3).length).toBe(560)
    expect(() => roundRobinSchedule(17, 3)).toThrow(/at most 16 entrants/)
    // Pairs have no cap.
    expect(roundRobinSchedule(64).length).toBe(2016)
  })

  it('rejects bad sizes', () => {
    expect(() => roundRobinSchedule(1)).toThrow(RangeError)
    expect(() => roundRobinSchedule(4, 1)).toThrow(RangeError)
    expect(() => roundRobinSchedule(4, 5)).toThrow(RangeError)
    expect(() => roundRobinSchedule(4, 2.5)).toThrow(RangeError)
  })
})

describe('standingsFromMatches', () => {
  it('orders by points, then wins, then name', () => {
    const names = ['delta', 'bravo', 'alpha', 'charlie']
    const s = standingsFromMatches(names, [
      // delta beats bravo; alpha and charlie tie.
      { entrants: [0, 1], result: fake([6, 0]) },
      { entrants: [2, 3], result: fake([3, 3]) },
      // bravo beats alpha; charlie beats delta, narrowly.
      { entrants: [1, 2], result: fake([4, 2]) },
      { entrants: [0, 3], result: fake([2, 3]) },
    ])
    expect(s.map((r) => [r.name, r.points, r.wins, r.ties, r.losses, r.matches])).toEqual([
      ['delta', 8, 1, 0, 1, 2],
      ['charlie', 6, 1, 1, 0, 2],
      ['alpha', 5, 0, 1, 1, 2],
      ['bravo', 4, 1, 0, 1, 2],
    ])
  })

  it('breaks a points tie by wins, then by name, then by entrant', () => {
    const s = standingsFromMatches(
      ['b', 'a', 'c', 'a'],
      [
        { entrants: [0, 1], result: fake([3, 3]) },
        { entrants: [2, 3], result: fake([3, 0]) },
        { entrants: [3, 1], result: fake([3, 0]) },
      ],
    )
    // All on 3 points. One win each: a#3 before c by name. No wins: a#1 before b by name.
    expect(s.map((r) => [r.entrant, r.points, r.wins])).toEqual([
      [3, 3, 1],
      [2, 3, 1],
      [1, 3, 0],
      [0, 3, 0],
    ])
    // Same name, same points, same wins: the entrant index decides.
    const twins = standingsFromMatches(['x', 'x'], [{ entrants: [0, 1], result: fake([1, 1]) }])
    expect(twins.map((r) => r.entrant)).toEqual([0, 1])
  })

  it('scores a k-way match: the sole top wins, a shared top ties, the rest lose', () => {
    const s = standingsFromMatches(
      ['a', 'b', 'c'],
      [{ entrants: [0, 1, 2], result: fake([4, 4, 0]) }],
    )
    expect(s.map((r) => [r.name, r.wins, r.ties, r.losses])).toEqual([
      ['a', 0, 1, 0],
      ['b', 0, 1, 0],
      ['c', 0, 0, 1],
    ])
  })
})

describe('roundRobin', () => {
  const entrants = [dat('d'), loop('a'), loop('b')]

  it('plays every pair and ranks the standings', () => {
    const rr = roundRobin(entrants, CONFIG, { rounds: 2 })
    expect(rr.schedule.length).toBe(3)
    expect(rr.matches.map((m) => m.names)).toEqual([
      ['d', 'a'],
      ['d', 'b'],
      ['a', 'b'],
    ])
    for (const [i, m] of rr.matches.entries()) {
      const spec = rr.schedule[i]!
      expect(m).toEqual(
        runMatch(
          spec.entrants.map((e) => entrants[e]!),
          CONFIG,
          2,
        ),
      )
    }
    expect(rr.standings.map((r) => [r.name, r.points, r.wins, r.ties, r.losses])).toEqual([
      ['a', 8, 1, 1, 0],
      ['b', 8, 1, 1, 0],
      ['d', 0, 0, 0, 2],
    ])
  })

  it('plays k-way matches with groupSize', () => {
    const rr = roundRobin([...entrants, loop('c')], CONFIG, { rounds: 1, groupSize: 3 })
    expect(rr.matches.length).toBe(4)
    expect(rr.standings.every((r) => r.matches === 3)).toBe(true)
  })
})

describe('iterateRoundRobin', () => {
  const entrants = [dat('d'), loop('a'), loop('b'), dat('e')]
  const opts = { rounds: 2 }

  async function drain(
    it: AsyncGenerator<unknown, RoundRobinResult>,
    seen: unknown[] = [],
  ): Promise<RoundRobinResult> {
    for (;;) {
      const step = await it.next()
      if (step.done) return step.value
      seen.push(step.value)
    }
  }

  it('yields standings after each match and ends as roundRobin does', async () => {
    const seen: { match: number; of: number; standings: { matches: number }[] }[] = []
    const result = await drain(iterateRoundRobin(entrants, CONFIG, opts), seen)
    expect(seen.map((p) => p.match)).toEqual([1, 2, 3, 4, 5, 6])
    expect(seen.every((p) => p.of === 6)).toBe(true)
    for (const p of seen) {
      expect(p.standings.reduce((s, r) => s + r.matches, 0)).toBe(2 * p.match)
    }
    expect(result).toEqual(roundRobin(entrants, CONFIG, opts))
  })

  it('stops on abort and resumes from the matches played', async () => {
    const ac = new AbortController()
    const played: MatchResult[] = []
    const run = async () => {
      for await (const p of iterateRoundRobin(entrants, CONFIG, { ...opts, signal: ac.signal })) {
        played.push(p.result)
        if (p.match === 4) ac.abort()
      }
    }
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(played.length).toBe(4)
    const seen: { match: number }[] = []
    const rest = await drain(iterateRoundRobin(entrants, CONFIG, { ...opts, resume: played }), seen)
    expect(seen.map((p) => p.match)).toEqual([5, 6])
    expect(rest).toEqual(roundRobin(entrants, CONFIG, opts))
  })

  it('refuses a resume that does not fit the schedule', async () => {
    const wrong = runMatch([entrants[1]!, entrants[0]!], CONFIG, 2)
    await expect(
      drain(iterateRoundRobin(entrants, CONFIG, { ...opts, resume: [wrong] })),
    ).rejects.toThrow('cannot resume')
    const first = runMatch([entrants[0]!, entrants[1]!], CONFIG, 2)
    expect(first.key).toBe(matchHash([entrants[0]!, entrants[1]!], CONFIG, 2))
    const partial = { ...first, rounds: first.rounds.slice(0, 1) }
    await expect(
      drain(iterateRoundRobin(entrants, CONFIG, { ...opts, resume: [partial] })),
    ).rejects.toThrow('cannot resume')
  })
})
