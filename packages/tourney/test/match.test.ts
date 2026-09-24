import { describe, expect, it } from 'bun:test'
import { Battle, DEFAULT_CONFIG, type LoadedBot, resultHash, simulate } from '@asmbots/engine'
import {
  iterateMatch,
  type MatchResult,
  matchHash,
  newMatch,
  roundOrder,
  roundResult,
  roundSeed,
  runMatch,
  runRound,
  withRound,
} from '../src/index'

const bot = (name: string, bytes: readonly number[]): LoadedBot => ({
  name,
  bytes: Uint8Array.from(bytes),
})

/** `jmp short $`: lives until the cycle cap. */
const loop = (name = 'loop') => bot(name, [0xeb, 0xfe])
/** `dat`: dies on its first instruction. */
const dat = (name = 'dat') => bot(name, [0x00, 0x00])

const CONFIG = { maxCycles: 200, seed: 7 }

describe('runRound', () => {
  it('adds the hash, the cycles, and the points to the engine result', () => {
    const r = runRound([loop(), dat()], CONFIG)
    const direct = simulate([loop(), dat()], CONFIG)
    expect(r.result).toEqual(direct)
    expect(r.resultHash).toBe(resultHash(direct))
    expect(r.seed).toBe(7)
    expect(r.durationCycles).toBe(direct.cycles)
    expect(r.durationCycles).toBe(1)
    expect(r.points).toEqual([3, 0])
  })

  it('scores a tie 1 each and takes the default seed', () => {
    const r = runRound([loop('a'), loop('b')], { maxCycles: 50 })
    expect(r.seed).toBe(DEFAULT_CONFIG.seed)
    expect(r.durationCycles).toBe(50)
    expect(r.points).toEqual([1, 1])
  })
})

describe('runMatch', () => {
  it('rotates the bot order by the round number', () => {
    const m = runMatch([loop('a'), loop('b'), dat('c')], CONFIG, 4)
    expect(m.rounds.map((r) => r.order)).toEqual([
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
      [0, 1, 2],
    ])
  })

  it('seeds round i with seed + i, wrapping at 2^32', () => {
    expect(runMatch([loop(), dat()], CONFIG, 3).rounds.map((r) => r.seed)).toEqual([7, 8, 9])
    const wrap = runMatch([loop(), dat()], { ...CONFIG, seed: 0xfffffffe }, 3)
    expect(wrap.rounds.map((r) => r.seed)).toEqual([0xfffffffe, 0xffffffff, 0])
  })

  it('runs each round as the rotated battle with its seed', () => {
    const bots = [loop('a'), loop('b'), dat('c')]
    const m = runMatch(bots, CONFIG, 3)
    for (const r of m.rounds) {
      const direct = simulate(
        r.order.map((k) => bots[k] as LoadedBot),
        { ...CONFIG, seed: r.seed },
      )
      expect(r.resultHash).toBe(resultHash(direct))
      expect(r.durationCycles).toBe(direct.cycles)
    }
  })

  it('maps round points and survivors back to entrant order', () => {
    const m = runMatch([dat('a'), loop('b'), loop('c')], CONFIG, 3)
    for (const r of m.rounds) {
      // Two of three live: floor((9 - 1) / 2) = 4 each (ISA §5.5).
      expect(r.points).toEqual([0, 4, 4])
      expect(r.survivors).toEqual([1, 2])
    }
  })

  it('sums the round points', () => {
    const m = runMatch([loop('a'), dat('b')], CONFIG, 5)
    expect(m.points).toEqual([15, 0])
    const tie = runMatch([loop('a'), loop('b')], CONFIG, 4)
    expect(tie.points).toEqual([4, 4])
    for (const k of [0, 1]) {
      expect(tie.points[k]).toBe(tie.rounds.reduce((s, r) => s + (r.points[k] as number), 0))
    }
    expect(m.of).toBe(5)
    expect(m.names).toEqual(['a', 'b'])
  })

  it('is deterministic', () => {
    const bots = [loop('a'), loop('b'), dat('c')]
    expect(runMatch(bots, CONFIG, 4)).toEqual(runMatch(bots, CONFIG, 4))
  })

  it('rejects a bad round count', () => {
    for (const k of [0, -1, 1.5, Number.NaN]) {
      expect(() => runMatch([loop()], CONFIG, k)).toThrow(RangeError)
    }
  })
  it('runs a match a round at a time with resume and through', () => {
    const bots = [loop('a'), loop('b'), dat('c')]
    const whole = runMatch(bots, CONFIG, 4)
    let match = runMatch(bots, CONFIG, 4, { through: 1 })
    expect(match.rounds).toEqual(whole.rounds.slice(0, 1))
    for (let k = 2; k <= 4; k++) {
      match = runMatch(bots, CONFIG, 4, { resume: match, through: k })
      expect(match.rounds.length).toBe(k)
    }
    expect(match).toEqual(whole)
    expect(runMatch(bots, CONFIG, 4, { resume: whole })).toEqual(whole)
  })

  it('rejects a bad through, a resume past it, and a resume of another match', () => {
    const bots = [loop('a'), dat('c')]
    for (const k of [0, 5, 1.5]) {
      expect(() => runMatch(bots, CONFIG, 4, { through: k })).toThrow(RangeError)
    }
    const two = runMatch(bots, CONFIG, 4, { through: 2 })
    expect(() => runMatch(bots, CONFIG, 4, { resume: two, through: 1 })).toThrow('past through')
    expect(() => runMatch([dat('c'), loop('a')], CONFIG, 4, { resume: two })).toThrow(
      'cannot resume',
    )
  })
})

describe('matchHash', () => {
  const bots = [loop('a'), dat('b')]

  it('is stable', () => {
    expect(matchHash(bots, CONFIG, 3)).toBe(matchHash([loop('a'), dat('b')], { ...CONFIG }, 3))
    expect(matchHash(bots, CONFIG, 3)).toBe('7bf371de6361b90a')
    expect(runMatch(bots, CONFIG, 3).key).toBe(matchHash(bots, CONFIG, 3))
  })

  it('treats a default left out and the default written out alike', () => {
    expect(matchHash(bots, {}, 3)).toBe(matchHash(bots, DEFAULT_CONFIG, 3))
    expect(matchHash(bots, { seed: undefined }, 3)).toBe(matchHash(bots, { seed: 0 }, 3))
  })

  it('changes with every input', () => {
    const base = matchHash(bots, CONFIG, 3)
    const others = [
      matchHash(bots, { ...CONFIG, seed: 8 }, 3),
      matchHash(bots, { ...CONFIG, maxCycles: 201 }, 3),
      matchHash(bots, CONFIG, 4),
      matchHash([dat('b'), loop('a')], CONFIG, 3),
      matchHash([loop('x'), dat('b')], CONFIG, 3),
      matchHash([bot('a', [0xeb, 0xfe, 0x00]), dat('b')], CONFIG, 3),
    ]
    expect(new Set([base, ...others]).size).toBe(others.length + 1)
  })
})

describe('iterateMatch', () => {
  const bots = [loop('a'), loop('b'), dat('c')]

  it('yields progress after each round and returns the match', async () => {
    const it = iterateMatch(bots, CONFIG, 3)
    const seen: number[] = []
    let step = await it.next()
    while (!step.done) {
      expect(step.value.of).toBe(3)
      expect(step.value.partial.rounds.length).toBe(step.value.round)
      seen.push(step.value.round)
      step = await it.next()
    }
    expect(seen).toEqual([1, 2, 3])
    expect(step.value).toEqual(runMatch(bots, CONFIG, 3))
  })

  it('stops mid-match when the signal aborts', async () => {
    const ac = new AbortController()
    const it = iterateMatch(bots, CONFIG, 5, { signal: ac.signal })
    const first = await it.next()
    const second = await it.next()
    expect(second.done).toBe(false)
    ac.abort()
    await expect(it.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(await it.next()).toEqual({ done: true, value: undefined })
    // The partials held before the abort stay as they were.
    expect(first.done === false && first.value.partial.rounds.length).toBe(1)
  })

  it('runs nothing when the signal aborted before the start', async () => {
    const ac = new AbortController()
    ac.abort(new Error('stop'))
    const it = iterateMatch(bots, CONFIG, 3, { signal: ac.signal })
    await expect(it.next()).rejects.toThrow('stop')
  })

  it('resumes from a partial and ends where an uninterrupted match does', async () => {
    const ac = new AbortController()
    let partial: MatchResult | undefined
    const run = async () => {
      for await (const p of iterateMatch(bots, CONFIG, 5, { signal: ac.signal })) {
        partial = p.partial
        if (p.round === 2) ac.abort()
      }
    }
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(partial?.rounds.length).toBe(2)
    const rest: number[] = []
    const it = iterateMatch(bots, CONFIG, 5, { resume: partial })
    let step = await it.next()
    while (!step.done) {
      rest.push(step.value.round)
      step = await it.next()
    }
    expect(rest).toEqual([3, 4, 5])
    expect(step.value).toEqual(runMatch(bots, CONFIG, 5))
  })

  it('refuses to resume a different match', async () => {
    const other = runMatch(bots, { ...CONFIG, seed: 99 }, 5)
    const it = iterateMatch(bots, CONFIG, 5, { resume: other })
    await expect(it.next()).rejects.toThrow('cannot resume')
  })
})

describe('rounds run elsewhere', () => {
  const bots = [loop('a'), dat('b'), loop('c')]

  it('plans each round as runMatch does: rotated order, seed + round mod 2^32', () => {
    expect(roundOrder(3, 0)).toEqual([0, 1, 2])
    expect(roundOrder(3, 4)).toEqual([1, 2, 0])
    expect(roundSeed(7, 2)).toBe(9)
    expect(roundSeed(0xffff_ffff, 2)).toBe(1)
    const m = runMatch(bots, CONFIG, 4)
    expect(m.rounds.map((r) => r.order)).toEqual([0, 1, 2, 3].map((i) => roundOrder(3, i)))
    expect(m.rounds.map((r) => r.seed)).toEqual([0, 1, 2, 3].map((i) => roundSeed(7, i)))
  })

  it('folds battles run round by round into the match runMatch returns', () => {
    let match = newMatch(bots, CONFIG, 4)
    expect(match).toEqual({
      key: matchHash(bots, CONFIG, 4),
      names: ['a', 'b', 'c'],
      of: 4,
      rounds: [],
      points: [0, 0, 0],
    })
    for (let i = 0; i < 4; i++) {
      const seed = roundSeed(CONFIG.seed, i)
      // A battle stepped by hand, as the arena Worker runs one.
      const battle = new Battle(
        roundOrder(3, i).map((k) => bots[k] as LoadedBot),
        { ...CONFIG, seed },
      )
      while (!battle.over) battle.step()
      const before = match
      match = withRound(match, roundResult(seed, battle.result()))
      expect(before.rounds).toHaveLength(i)
    }
    expect(match).toEqual(runMatch(bots, CONFIG, 4))
    expect(() => withRound(match, runRound(bots, CONFIG))).toThrow('has all 4 rounds')
  })

  it('refuses a bad round count', () => {
    expect(() => newMatch(bots, CONFIG, 0)).toThrow(RangeError)
  })
})
