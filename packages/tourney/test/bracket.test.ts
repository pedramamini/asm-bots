import { describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import {
  advance,
  type Bracket,
  type BracketMatchRunner,
  bracket,
  champion,
  createBracket,
  iterateBracket,
  type MatchResult,
  nextMatches,
  runMatch,
} from '../src/index'

const bot = (name: string, bytes: readonly number[]): LoadedBot => ({
  name,
  bytes: Uint8Array.from(bytes),
})

/** `jmp short $`: lives until the cycle cap. */
const loop = (name: string) => bot(name, [0xeb, 0xfe])
/** `dat`: dies on its first instruction. */
const dat = (name: string) => bot(name, [0x00, 0x00])

const CONFIG = { maxCycles: 100, seed: 5 }

const named = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `e${i}` }))

/** A made-up whole match of `names` with the given points and per-round survival. */
const fake = (names: string[], points: number[], survival: number[] = [0, 0]): MatchResult => ({
  key: `fake:${names.join(',')}`,
  names,
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
      survival,
    },
  ],
  points,
})

/** A runner where the lower entrant index always wins. */
const lowerWins =
  (b: Bracket): BracketMatchRunner =>
  ([x, y]) =>
    fake([b.names[x] as string, b.names[y] as string], x < y ? [3, 0] : [0, 3])

async function drain(b: Bracket, run: BracketMatchRunner): Promise<Bracket> {
  const it = iterateBracket(b, run)
  for (;;) {
    const step = await it.next()
    if (step.done) return step.value
  }
}

/** The first-round seed pairs, top to bottom. */
const firstRound = (b: Bracket) =>
  b.matches
    .filter((m) => m.round === 0)
    .map((m) => m.slots.map((s) => ('seed' in s.source ? s.source.seed : 0)))

describe('createBracket', () => {
  it('places the seeds in the standard order', () => {
    expect(firstRound(createBracket(named(16), { seeding: 'given' }))).toEqual([
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [2, 15],
      [7, 10],
      [3, 14],
      [6, 11],
    ])
    expect(firstRound(createBracket(named(4), { seeding: 'given' }))).toEqual([
      [1, 4],
      [2, 3],
    ])
  })

  it('builds the shape for 3, 5, 8, 13, and 32 entrants, with byes on the top seeds', () => {
    for (const [n, size] of [
      [3, 4],
      [5, 8],
      [8, 8],
      [13, 16],
      [32, 32],
    ] as const) {
      const b = createBracket(named(n), { seeding: 'given' })
      expect(b.size).toBe(size)
      expect(b.rounds).toBe(Math.log2(size))
      expect(b.matches.length).toBe(size - 1)
      expect(b.final).toBe(size - 2)
      expect(b.matches.map((m) => m.id)).toEqual(b.matches.map((_, i) => i))
      for (let r = 0; r < b.rounds; r++) {
        expect(b.matches.filter((m) => m.round === r).length).toBe(size >> (r + 1))
      }
      const walkovers = b.matches.filter((m) => m.status === 'walkover')
      expect(walkovers.length).toBe(size - n)
      // The byes go to seeds 1..(size - n).
      expect(walkovers.map((m) => b.seeds[m.winner as number]).sort((x, y) => x - y)).toEqual(
        Array.from({ length: size - n }, (_, i) => i + 1),
      )
      expect(nextMatches(b).filter((m) => m.round === 0).length).toBe(size / 2 - (size - n))
      expect(b.matches.some((m) => m.status === 'empty')).toBe(false)
    }
  })

  it('settles empty matches and walkovers through the rounds in an oversized bracket', () => {
    const b = createBracket(named(3), { seeding: 'given', size: 8 })
    // 1v8 walkover, 4v5 empty, 2v7 walkover, 3v6 walkover; then 1 walks over the empty match.
    expect(b.matches.slice(0, 4).map((m) => m.status)).toEqual([
      'walkover',
      'empty',
      'walkover',
      'walkover',
    ])
    expect(b.matches[4]?.status).toBe('walkover')
    expect(b.matches[4]?.winner).toBe(0)
    expect(nextMatches(b).map((m) => m.slots.map((s) => s.entrant))).toEqual([[1, 2]])
  })

  it('seeds by rating, highest first, ties in entrant order', () => {
    const b = createBracket(
      [
        { name: 'a', rating: 1400 },
        { name: 'b', rating: 1700 },
        { name: 'c', rating: 1400 },
        { name: 'd', rating: 1550 },
      ],
      { seeding: 'rating' },
    )
    expect(b.seeds).toEqual([3, 1, 4, 2])
    expect(() => createBracket(named(4), { seeding: 'rating' })).toThrow(RangeError)
  })

  it('seeds at random, the same for the same seed', () => {
    const a = createBracket(named(16), { seeding: { random: 7 } })
    expect([...a.seeds].sort((x, y) => x - y)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(createBracket(named(16), { seeding: { random: 7 } })).toEqual(a)
    expect(createBracket(named(16), { seeding: { random: 8 } }).seeds).not.toEqual(a.seeds)
    expect(a.seeds).not.toEqual(createBracket(named(16), { seeding: 'given' }).seeds)
  })

  it('rejects bad counts, sizes, and third-place flags', () => {
    expect(() => createBracket(named(1), { seeding: 'given' })).toThrow(RangeError)
    expect(() => createBracket(named(33), { seeding: 'given' })).toThrow(RangeError)
    expect(() => createBracket(named(9), { seeding: 'given', size: 8 })).toThrow(RangeError)
    // biome-ignore lint/suspicious/noExplicitAny: a size the type does not allow
    expect(() => createBracket(named(4), { seeding: 'given', size: 6 as any })).toThrow(RangeError)
    expect(() => createBracket(named(2), { seeding: 'given', thirdPlace: true })).toThrow(
      RangeError,
    )
    expect(() => createBracket(named(4), { seeding: { random: -1 } })).toThrow(RangeError)
  })
})

describe('advance', () => {
  const b = createBracket(named(4), { seeding: 'given' })

  it('checks the match and the result', () => {
    expect(() => advance(b, 99, fake(['e0', 'e3'], [3, 0]))).toThrow('no match 99')
    expect(() => advance(b, 2, fake(['e0', 'e1'], [3, 0]))).toThrow('pending, not ready')
    expect(() => advance(b, 0, fake(['e3', 'e0'], [3, 0]))).toThrow('not a whole match')
    expect(() => advance(b, 0, { ...fake(['e0', 'e3'], [3, 0]), of: 2 })).toThrow(
      'not a whole match',
    )
  })

  it('leaves the bracket it was given alone and fills the next match', () => {
    const before = JSON.stringify(b)
    const after = advance(b, 0, fake(['e0', 'e3'], [0, 3]))
    expect(JSON.stringify(b)).toBe(before)
    expect(after.matches[0]).toMatchObject({ status: 'done', winner: 3, loser: 0 })
    expect(after.matches[2]?.slots.map((s) => s.state)).toEqual(['filled', 'pending'])
    expect(after.matches[2]?.slots[0].entrant).toBe(3)
    expect(() => advance(after, 0, fake(['e0', 'e3'], [0, 3]))).toThrow('done, not ready')
  })

  it('breaks a tie on points by survival, then by seed', () => {
    const bySurvival = advance(b, 0, fake(['e0', 'e3'], [1, 1], [40, 90]))
    expect(bySurvival.matches[0]?.winner).toBe(3)
    const bySeed = advance(b, 1, fake(['e1', 'e2'], [1, 1], [100, 100]))
    expect(bySeed.matches[1]?.winner).toBe(1)
  })
})

describe('iterateBracket', () => {
  it('plays to one champion and resolves third place, for 3..32 entrants', async () => {
    for (let n = 3; n <= 32; n++) {
      const b = createBracket(named(n), { seeding: 'given', thirdPlace: true })
      const done = await drain(b, lowerWins(b))
      expect(champion(done)).toBe(0)
      expect(nextMatches(done)).toEqual([])
      expect(done.matches.every((m) => m.status !== 'pending')).toBe(true)
      const final = done.matches[done.final]
      expect(final?.loser).toBe(1)
      const third = done.matches[done.thirdPlace as number]
      expect(third?.thirdPlace).toBe(true)
      // Seeds 3 and 4 lose the semifinals; with 3 entrants, seed 3 takes third by walkover.
      expect(third?.winner).toBe(2)
      expect(third?.status).toBe(n === 3 ? 'walkover' : 'done')
      // Every entrant but the champion loses exactly once, bar the third-place match.
      const losers = done.matches.filter((m) => !m.thirdPlace && m.loser !== null)
      expect(losers.length).toBe(n - 1)
    }
  })

  it('yields after each match and resumes from a yielded bracket', async () => {
    const b = createBracket(named(13), { seeding: { random: 3 }, thirdPlace: true })
    const whole = await drain(b, lowerWins(b))
    const it = iterateBracket(b, lowerWins(b))
    const seen: Bracket[] = []
    for (let i = 0; i < 5; i++) {
      const step = await it.next()
      if (step.done) throw new Error('ended early')
      expect(step.value.match.status).toBe('done')
      expect(step.value.bracket.matches[step.value.match.id]).toBe(step.value.match)
      seen.push(step.value.bracket)
    }
    // Round trip through JSON, as the Durable Object stores it, and pick up from there.
    const stored = JSON.parse(JSON.stringify(seen[4])) as Bracket
    expect(stored).toStrictEqual(seen[4] as Bracket)
    expect(await drain(stored, lowerWins(stored))).toStrictEqual(whole)
  })

  it('stops before the next match when the signal aborts', async () => {
    const b = createBracket(named(8), { seeding: 'given' })
    const controller = new AbortController()
    let runs = 0
    const run: BracketMatchRunner = (e, m) => {
      runs++
      return lowerWins(b)(e, m)
    }
    const it = iterateBracket(b, run, { signal: controller.signal })
    await it.next()
    controller.abort(new Error('stop'))
    await expect(it.next()).rejects.toThrow('stop')
    expect(runs).toBe(1)
  })
})

describe('bracket', () => {
  const entrants = [dat('d0'), loop('l0'), dat('d1'), loop('l1'), dat('d2')]

  it('runs every match on the engine and crowns a survivor', () => {
    const b = bracket(entrants, CONFIG, { rounds: 3, seeding: 'given', thirdPlace: true })
    const winner = champion(b)
    expect(winner === 1 || winner === 3).toBe(true)
    for (const m of b.matches.filter((x) => x.status === 'done')) {
      const bots = m.slots.map((s) => entrants[s.entrant as number] as LoadedBot)
      expect(m.result).toEqual(runMatch(bots, CONFIG, 3))
    }
    expect(JSON.parse(JSON.stringify(b))).toStrictEqual(b)
  })
})
