import { describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import {
  botHash,
  createHill,
  type HillChallenger,
  type HillConfig,
  type HillEntry,
  type HillMatchRunner,
  type HillProgress,
  type HillResult,
  type HillState,
  hill,
  type MatchResult,
  runMatch,
  submitToHill,
} from '../src/index'

const bot = (name: string, bytes: readonly number[]): LoadedBot => ({
  name,
  bytes: Uint8Array.from(bytes),
})

/** `jmp short $`: lives until the cycle cap. */
const loop = (name: string) => bot(name, [0xeb, 0xfe])
/** `dat`: dies on its first instruction. */
const dat = (name: string) => bot(name, [0x00, 0x00])

const CONFIG: HillConfig = { size: 3, rounds: 1, battle: { maxCycles: 100, seed: 7 } }

/** A made-up whole one-round match with the given points. */
const fake = (names: string[], points: number[]): MatchResult => ({
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
      survival: [0, 0],
    },
  ],
  points,
})

/**
 * A runner where the stronger bot wins 3-0 and equals tie 1-1. The strength is the bot's first
 * byte, so each bot has distinct bytes. It records the pairs it ran.
 */
function strengthRunner(strength: Map<string, number>) {
  const calls: string[] = []
  const run: HillMatchRunner = (c, d) => {
    calls.push(`${c.id}>${d.id}`)
    const a = c.bot.bytes[0] as number
    const b = strength.get(d.id) as number
    return fake([c.bot.name, d.name], a > b ? [3, 0] : a < b ? [0, 3] : [1, 1])
  }
  return { run, calls }
}

async function drain(it: AsyncGenerator<HillProgress, HillResult>): Promise<HillProgress[]> {
  const steps: HillProgress[] = []
  for await (const step of it) steps.push(step)
  return steps
}

/** Submits bots of the given strengths, in order, to `state`. */
async function submitAll(state: HillState, bots: readonly [string, number][]) {
  const strength = new Map<string, number>()
  const { run, calls } = strengthRunner(strength)
  let result: HillResult | null = null
  for (const [id, s] of bots) {
    strength.set(id, s)
    // Distinct bytes per id; the first byte is the strength.
    const steps = await drain(submitToHill(state, { id, bot: bot(id, [s, id.charCodeAt(0)]) }, run))
    result = steps.at(-1)?.final as HillResult
    state = result.state
  }
  return { state, result: result as HillResult, calls, run, strength }
}

const ids = (entries: readonly HillEntry[]) => entries.map((e) => e.id)

describe('submitToHill', () => {
  it('accepts into an empty hill with no matches', async () => {
    const steps = await drain(
      submitToHill(createHill(CONFIG), { id: 'a', bot: loop('a') }, () => {
        throw new Error('no match to run')
      }),
    )
    expect(steps).toHaveLength(1)
    const final = steps[0]?.final as HillResult
    expect(steps[0]?.progress).toEqual({ match: 0, of: 0 })
    expect(final.accepted).toBe(true)
    expect(final.rank).toBe(1)
    expect(final.evicted).toBeNull()
    expect(final.board).toEqual([
      { rank: 1, entry: final.state.entries[0] as HillEntry, rankDelta: null, pointsDelta: null },
    ])
    expect(final.state.entries[0]).toMatchObject({ id: 'a', points: 0, age: 0, rating: null })
    expect(final.state.entries[0]?.hash).toBe(botHash(loop('a')))
  })

  it('fights every entry once, scores the field, and evicts the lowest from a full hill', async () => {
    const { state, result, calls } = await submitAll(createHill(CONFIG), [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ])
    // One match per defender per submission, never defender against defender.
    expect(calls).toEqual(['b>a', 'c>b', 'c>a', 'd>c', 'd>b', 'd>a'])
    expect(result.accepted).toBe(true)
    expect(result.rank).toBe(1)
    // Ranked with the challenger: d 9, c 6, b 3, a 0.
    expect(result.challenger.points).toBe(9)
    expect(result.evicted).toMatchObject({ id: 'a', points: 0, losses: 3 })
    // The field before the eviction: every entry scored over its matches with the other three.
    expect(result.field.map((e) => [e.id, e.points])).toEqual([
      ['d', 9],
      ['c', 6],
      ['b', 3],
      ['a', 0],
    ])
    // Re-scored without the matches against a.
    expect(ids(state.entries)).toEqual(['d', 'c', 'b'])
    expect(state.entries.map((e) => [e.points, e.wins, e.ties, e.losses])).toEqual([
      [6, 2, 0, 0],
      [3, 1, 0, 1],
      [0, 0, 0, 2],
    ])
    expect(state.matches).toHaveLength(3)
    expect(state.matches.flatMap((m) => m.entries)).not.toContain('a')
    expect(result.board.map((r) => [r.entry.id, r.rankDelta, r.pointsDelta])).toEqual([
      ['d', null, null],
      ['c', -1, -3],
      ['b', -1, -3],
    ])
  })

  it('ages the entries that stay, and rejects a challenger below the lowest', async () => {
    const { state, run } = await submitAll(createHill(CONFIG), [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    expect(state.entries.map((e) => [e.id, e.age])).toEqual([
      ['c', 0],
      ['b', 1],
      ['a', 2],
    ])
    const steps = await drain(submitToHill(state, { id: 'z', bot: bot('z', [0]) }, run))
    const final = steps.at(-1)?.final as HillResult
    expect(steps.map((s) => s.progress)).toEqual([
      { match: 1, of: 3 },
      { match: 2, of: 3 },
      { match: 3, of: 3 },
      { match: 3, of: 3 },
    ])
    expect(steps.slice(0, -1).every((s) => s.final === null)).toBe(true)
    expect(final.accepted).toBe(false)
    expect(final.rank).toBeNull()
    expect(final.evicted?.id).toBe('z')
    expect(final.challenger.points).toBe(0)
    // Last in the field; the entry above it is the score it had to beat.
    expect(ids(final.field)).toEqual(['c', 'b', 'a', 'z'])
    expect(ids(final.state.entries)).toEqual(['c', 'b', 'a'])
    expect(final.state.entries.map((e) => e.age)).toEqual([1, 2, 3])
    expect(final.state.matches).toEqual(state.matches)
    expect(final.matches).toHaveLength(3)
  })

  it('resolves score ties by age: the older entry stays', async () => {
    // Everyone ties: the challenger (age 0) ties the lowest and goes; incumbents keep order.
    const size2 = { ...CONFIG, size: 2 }
    const { result } = await submitAll(createHill(size2), [
      ['x', 5],
      ['y', 5],
      ['z', 5],
    ])
    expect(result.accepted).toBe(false)
    expect(result.evicted?.id).toBe('z')
    expect(ids(result.state.entries)).toEqual(['x', 'y'])

    // Two incumbents tie on score: the younger goes, though it is listed first.
    const entry = (id: string, age: number): HillEntry => ({
      id,
      name: id,
      hash: id,
      points: 1,
      wins: 0,
      ties: 1,
      losses: 0,
      age,
      rating: null,
    })
    const state: HillState = {
      config: size2,
      entries: [entry('young', 0), entry('old', 5)],
      matches: [{ key: 'k', entries: ['young', 'old'], points: [1, 1] }],
    }
    const strength = new Map([
      ['young', 1],
      ['old', 1],
    ])
    const { run } = strengthRunner(strength)
    const final = (await drain(submitToHill(state, { id: 'top', bot: bot('top', [9]) }, run))).at(
      -1,
    )?.final as HillResult
    expect(final.evicted?.id).toBe('young')
    expect(final.state.entries.map((e) => [e.id, e.points, e.age])).toEqual([
      ['top', 3, 0],
      ['old', 0, 6],
    ])
  })

  it('lets a resubmitted identical bot replace its own entry', async () => {
    const { state, run, calls, strength } = await submitAll(createHill(CONFIG), [
      ['a', 1],
      ['b', 2],
    ])
    calls.length = 0
    strength.set('a2', 1)
    // Same bytes as a, new id and name: it fights b only.
    const final = (
      await drain(submitToHill(state, { id: 'a2', bot: bot('a-v2', [1, 0x61]) }, run))
    ).at(-1)?.final as HillResult
    expect(calls).toEqual(['a2>b'])
    expect(final.replaced?.id).toBe('a')
    expect(final.evicted).toBeNull()
    expect(ids(final.state.entries)).toEqual(['b', 'a2'])
    expect(final.state.entries[1]).toMatchObject({ name: 'a-v2', age: 1, points: 0 })
    expect(final.state.matches.map((m) => m.entries)).toEqual([['a2', 'b']])
    // The replacing entry takes the old entry's rank for its deltas.
    expect(final.board[1]).toMatchObject({ rank: 2, rankDelta: 0, pointsDelta: 0 })

    // The same id with other bytes is a caller bug.
    await expect(drain(submitToHill(state, { id: 'a', bot: bot('a', [7]) }, run))).rejects.toThrow(
      'other bytes',
    )
  })

  it('resumes from the matches already run, and stops on abort', async () => {
    const { state, run, strength } = await submitAll(createHill(CONFIG), [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    strength.set('d', 2)
    const challenger: HillChallenger = { id: 'd', bot: bot('d', [2]) }
    const whole = await drain(submitToHill(state, challenger, run))

    const counted = strengthRunner(strength)
    const partial = whole[0]?.matches as MatchResult[]
    const resumed = await drain(submitToHill(state, challenger, counted.run, { resume: partial }))
    expect(counted.calls).toEqual(['d>b', 'd>a'])
    expect(resumed.at(-1)).toEqual(whole.at(-1) as HillProgress)

    const controller = new AbortController()
    const it = submitToHill(state, challenger, run, { signal: controller.signal })
    await it.next()
    controller.abort(new Error('stop'))
    await expect(it.next()).rejects.toThrow('stop')

    // A match of the wrong pair, run or resumed, is refused.
    const wrong: HillMatchRunner = () => fake(['d', 'nobody'], [3, 0])
    await expect(drain(submitToHill(state, challenger, wrong))).rejects.toThrow('not a whole match')
    await expect(
      drain(submitToHill(state, challenger, run, { resume: [...partial, ...partial] })),
    ).rejects.toThrow('not a whole match')
  })

  it('checks the hill', async () => {
    expect(() => createHill({ ...CONFIG, size: 0 })).toThrow(RangeError)
    expect(() => createHill({ ...CONFIG, rounds: 1.5 })).toThrow(RangeError)
    const { state } = await submitAll(createHill(CONFIG), [
      ['a', 1],
      ['b', 2],
    ])
    const small = { ...state, config: { ...CONFIG, size: 1 } }
    expect(() => hill(small, { id: 'c', bot: loop('c') }, () => loop('x'))).toThrow(RangeError)
  })
})

describe('hill', () => {
  const bots = new Map<string, LoadedBot>()
  const lookup = (e: HillEntry) => bots.get(e.id) as LoadedBot
  const challenger = (id: string, b: LoadedBot): HillChallenger => {
    bots.set(id, b)
    return { id, bot: b }
  }
  const seed = (s: HillState) =>
    [
      challenger('l1', loop('loop-1')),
      challenger('d1', dat('dat-1')),
      challenger('l2', bot('loop-2', [0xeb, 0xfe, 0x90])),
      challenger('d2', bot('dat-2', [0x00, 0x00, 0x00])),
    ].reduce((st, c) => hill(st, c, lookup).state, s)

  it('runs real matches, deterministic given the seed base', () => {
    const a = seed(createHill(CONFIG))
    const b = seed(createHill(CONFIG))
    expect(a).toEqual(b)
    // loop-2 ties loop-1 and beats dat-1; the second dat was pushed off.
    expect(a.entries.map((e) => [e.id, e.points, e.wins, e.ties, e.losses])).toEqual([
      ['l1', 4, 1, 1, 0],
      ['l2', 4, 1, 1, 0],
      ['d1', 0, 0, 0, 2],
    ])
    const c = seed(createHill({ ...CONFIG, battle: { ...CONFIG.battle, seed: 8 } }))
    expect(c.matches.map((m) => m.key)).not.toEqual(a.matches.map((m) => m.key))
    // Stored keys are the match hashes of the pairs.
    const m = runMatch([bots.get('l2') as LoadedBot, loop('loop-1')], CONFIG.battle, CONFIG.rounds)
    expect(a.matches.find((x) => x.entries[0] === 'l2' && x.entries[1] === 'l1')?.key).toBe(m.key)
  })

  it('matches submitToHill with a runMatch runner, and round-trips through JSON', async () => {
    const state = seed(createHill(CONFIG))
    const c = challenger('l3', bot('loop-3', [0xeb, 0xfe, 0x90, 0x90]))
    const run: HillMatchRunner = (ch, d, cfg) =>
      runMatch([ch.bot, lookup(d)], cfg.battle, cfg.rounds)
    const viaIterator = (await drain(submitToHill(state, c, run))).at(-1)?.final
    expect(viaIterator).toEqual(hill(state, c, lookup))
    const revived = JSON.parse(JSON.stringify(state)) as HillState
    expect(revived).toEqual(state)
    expect(hill(revived, c, lookup)).toEqual(hill(state, c, lookup))
  })
})
