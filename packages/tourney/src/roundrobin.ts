/**
 * Round robin (ARCHITECTURE §5, PRODUCT_SPEC §4): every pair of entrants plays one match, or,
 * with `groupSize` k > 2, every k-subset plays one k-way match. Every match has the same config,
 * so a match's key (`matchHash`) depends only on its entrants: a cache can share it across
 * tournaments.
 *
 * `iterateRoundRobin` runs one match per step and yields the standings after each. With
 * `resume` it takes the matches already played and runs only the rest; with `run` the caller
 * runs each match (the web app, in its arena Worker).
 */
import type { BattleConfigInput, LoadedBot } from '@asmbots/engine'
import { type MatchResult, matchHash, runMatch } from './match'
import { type Standing, standingsFromMatches } from './scoring'

/** The most entrants a round robin of k-subsets (k > 2) takes: C(16, 8) is 12870 matches. */
export const MAX_GROUP_ENTRANTS = 16

/** A scheduled match: its id (its place in the schedule) and its entrants, ascending. */
export interface MatchSpec {
  readonly id: number
  readonly entrants: readonly number[]
}

export interface RoundRobinOptions {
  /** Rounds per match. */
  readonly rounds: number
  /** Entrants per match: 2 for pairs, more for k-way melee matches. */
  readonly groupSize?: number | undefined
}

/**
 * Runs one scheduled match: `bots` are its entrants, in `spec.entrants` order. It must give what
 * `runMatch(bots, config, rounds)` gives: the iterator checks the key.
 */
export type RoundRobinMatchRunner = (
  bots: readonly LoadedBot[],
  spec: MatchSpec,
) => MatchResult | Promise<MatchResult>

export interface IterateRoundRobinOptions extends RoundRobinOptions {
  /** When it aborts, the iterator throws the abort reason before it runs the next match. */
  readonly signal?: AbortSignal | undefined
  /** The results of the first matches of the schedule, in order: the iterator skips them. */
  readonly resume?: readonly MatchResult[] | undefined
  /** Runs each match. Default: `runMatch`, in this thread. */
  readonly run?: RoundRobinMatchRunner | undefined
}

/** What `iterateRoundRobin` yields after each match. */
export interface RoundRobinProgress {
  /** The matches played so far. */
  readonly match: number
  /** The matches in the schedule. */
  readonly of: number
  /** The match just played. */
  readonly spec: MatchSpec
  readonly result: MatchResult
  /** The standings over the matches played so far. */
  readonly standings: readonly Standing[]
}

/** A whole round robin. */
export interface RoundRobinResult {
  readonly schedule: readonly MatchSpec[]
  /** `matches[i]` is the result of `schedule[i]`. */
  readonly matches: readonly MatchResult[]
  readonly standings: readonly Standing[]
}

/**
 * The schedule of a round robin of `n` entrants: every `groupSize`-subset, in lexicographic
 * order. Throws `RangeError` when `groupSize` is not in 2..n, or when `groupSize > 2` and there
 * are more than `MAX_GROUP_ENTRANTS` entrants.
 */
export function roundRobinSchedule(n: number, groupSize = 2): MatchSpec[] {
  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError(`round robin: needs at least 2 entrants, got ${n}`)
  }
  if (!Number.isInteger(groupSize) || groupSize < 2 || groupSize > n) {
    throw new RangeError(`round robin: groupSize must be an integer in 2..${n}, got ${groupSize}`)
  }
  if (groupSize > 2 && n > MAX_GROUP_ENTRANTS) {
    throw new RangeError(
      `round robin: groups of ${groupSize} take at most ${MAX_GROUP_ENTRANTS} entrants, got ${n}`,
    )
  }
  const schedule: MatchSpec[] = []
  const pick = Array.from({ length: groupSize }, (_, i) => i)
  for (;;) {
    schedule.push({ id: schedule.length, entrants: [...pick] })
    // Step to the next subset: bump the last index that can move, and reset the ones after it.
    let i = groupSize - 1
    while (i >= 0 && pick[i] === n - groupSize + i) i--
    if (i < 0) return schedule
    pick[i] = (pick[i] as number) + 1
    for (let j = i + 1; j < groupSize; j++) pick[j] = (pick[j - 1] as number) + 1
  }
}

function checkResume(
  entrants: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  schedule: readonly MatchSpec[],
  resume: readonly MatchResult[],
): void {
  if (resume.length > schedule.length) {
    throw new Error(`round robin: cannot resume ${resume.length} of ${schedule.length} matches`)
  }
  resume.forEach((m, i) => {
    const bots = (schedule[i] as MatchSpec).entrants.map((e) => entrants[e] as LoadedBot)
    if (m.key !== matchHash(bots, config, rounds) || m.rounds.length !== m.of) {
      throw new Error(`round robin: cannot resume match ${i} from ${m.key}`)
    }
  })
}

/**
 * Plays the matches of the schedule after the `resume` ones, yielding progress after each.
 * `before` runs ahead of each match.
 */
function* play(
  entrants: readonly LoadedBot[],
  config: BattleConfigInput,
  options: RoundRobinOptions,
  resume: readonly MatchResult[],
  before: () => void,
): Generator<RoundRobinProgress, RoundRobinResult> {
  const { rounds, groupSize = 2 } = options
  const schedule = roundRobinSchedule(entrants.length, groupSize)
  checkResume(entrants, config, rounds, schedule, resume)
  const names = entrants.map((b) => b.name)
  const matches = [...resume]
  const played = () =>
    matches.map((result, i) => ({ entrants: (schedule[i] as MatchSpec).entrants, result }))
  for (let i = matches.length; i < schedule.length; i++) {
    before()
    const spec = schedule[i] as MatchSpec
    const result = runMatch(
      spec.entrants.map((e) => entrants[e] as LoadedBot),
      config,
      rounds,
    )
    matches.push(result)
    yield {
      match: matches.length,
      of: schedule.length,
      spec,
      result,
      standings: standingsFromMatches(names, played()),
    }
  }
  return { schedule, matches, standings: standingsFromMatches(names, played()) }
}

/**
 * Runs a round robin: every `groupSize`-subset of `entrants` plays one match of
 * `options.rounds` rounds with `config`. Throws what `roundRobinSchedule` and `runMatch` throw.
 */
export function roundRobin(
  entrants: readonly LoadedBot[],
  config: BattleConfigInput,
  options: RoundRobinOptions,
): RoundRobinResult {
  const it = play(entrants, config, options, [], () => {})
  for (;;) {
    const step = it.next()
    if (step.done) return step.value
  }
}

/**
 * `roundRobin` one match at a time: yields `{ match, of, spec, result, standings }` after each
 * match and returns the whole round robin. With `resume`, it starts after the matches given;
 * an `Error` when they do not fit the schedule. With `run`, the caller runs each match; an
 * `Error` when what it gives is not the whole match. With `signal`, an abort stops it before
 * the next match: the iterator throws the abort reason.
 */
export async function* iterateRoundRobin(
  entrants: readonly LoadedBot[],
  config: BattleConfigInput,
  options: IterateRoundRobinOptions,
): AsyncGenerator<RoundRobinProgress, RoundRobinResult> {
  const { signal, resume = [], run } = options
  if (run === undefined) {
    const it = play(entrants, config, options, resume, () => signal?.throwIfAborted())
    for (;;) {
      const step = it.next()
      if (step.done) return step.value
      yield step.value
    }
  }
  const { rounds, groupSize = 2 } = options
  const schedule = roundRobinSchedule(entrants.length, groupSize)
  checkResume(entrants, config, rounds, schedule, resume)
  const names = entrants.map((b) => b.name)
  const matches = [...resume]
  const played = () =>
    matches.map((result, i) => ({ entrants: (schedule[i] as MatchSpec).entrants, result }))
  for (let i = matches.length; i < schedule.length; i++) {
    signal?.throwIfAborted()
    const spec = schedule[i] as MatchSpec
    const bots = spec.entrants.map((e) => entrants[e] as LoadedBot)
    const result = await run(bots, spec)
    if (result.key !== matchHash(bots, config, rounds) || result.rounds.length !== result.of) {
      throw new Error(`round robin: match ${i} ran as ${result.key}, not the whole match`)
    }
    matches.push(result)
    yield {
      match: matches.length,
      of: schedule.length,
      spec,
      result,
      standings: standingsFromMatches(names, played()),
    }
  }
  return { schedule, matches, standings: standingsFromMatches(names, played()) }
}
