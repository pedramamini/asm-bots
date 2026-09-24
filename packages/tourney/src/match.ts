/**
 * Matches (ISA §5.5): K rounds with seeds `seed, seed + 1, ..., seed + K - 1` and the bot order
 * rotated each round. The match score of a bot is the sum of its round points.
 *
 * Round i places the bots in the order `i mod N, i mod N + 1, ...`, around the list: each bot
 * goes first as often as the others (over N rounds), so the bias of placement order cancels.
 * Seeds wrap at 2^32, as the engine takes a uint32.
 *
 * `iterateMatch` runs one round per step and yields the partial match after each, so the UI and
 * the Durable Object can drive a match, stop it, and resume it from the last partial.
 */
import {
  type BattleConfig,
  type BattleConfigInput,
  DEFAULT_CONFIG,
  fnv1a64,
  type LoadedBot,
} from '@asmbots/engine'
import { type RoundResult, runRound } from './round'

/** One round of a match. Indices are entrant indices: positions in the `bots` of the match. */
export interface MatchRound {
  /** The round number, from 0. */
  readonly round: number
  /** The placement seed: the match seed + `round`, mod 2^32. */
  readonly seed: number
  /** The fighting order: `order[j]` is the entrant placed j-th. */
  readonly order: readonly number[]
  /** The engine result's hash (ISA §5.6), for the bots in fighting order. */
  readonly resultHash: string
  /** The cycles the battle ran. */
  readonly durationCycles: number
  /** Round points per entrant. */
  readonly points: readonly number[]
  /** The entrants alive at the end, ascending. */
  readonly survivors: readonly number[]
  /**
   * Cycles each entrant lived through: its death cycle (the cycle it died in, from 0), or
   * `durationCycles` when it survived.
   */
  readonly survival: readonly number[]
}

/** A match, whole or in part. */
export interface MatchResult {
  /** `matchHash` of the inputs: equal keys, equal matches. */
  readonly key: string
  /** The entrants' names, in entrant order. */
  readonly names: readonly string[]
  /** The rounds the match has in all. */
  readonly of: number
  /** The rounds run so far, in order. The match is complete when there are `of` of them. */
  readonly rounds: readonly MatchRound[]
  /** Match points per entrant: the sum of its round points. */
  readonly points: readonly number[]
}

/** What `iterateMatch` yields after each round. */
export interface MatchProgress {
  /** The rounds run so far. */
  readonly round: number
  /** The rounds the match has in all. */
  readonly of: number
  /** The match so far. */
  readonly partial: MatchResult
}

export interface IterateMatchOptions {
  /** When it aborts, the iterator throws the abort reason before it runs the next round. */
  readonly signal?: AbortSignal | undefined
  /** A partial of the same match (same key): the iterator runs only the rounds it lacks. */
  readonly resume?: MatchResult | undefined
}

export interface RunMatchOptions {
  /** A partial of the same match (same key): only the rounds it lacks run. */
  readonly resume?: MatchResult | undefined
  /**
   * Stop once the match has this many rounds, 1..`rounds`: a partial comes back, which a later
   * call resumes. Default: all of them. Fewer than `resume` has is an `Error`.
   */
  readonly through?: number | undefined
}

/** `config` over the engine defaults. The engine checks the values when a round runs. */
function resolve(config: BattleConfigInput): BattleConfig {
  return {
    coreSize: config.coreSize ?? DEFAULT_CONFIG.coreSize,
    maxCycles: config.maxCycles ?? DEFAULT_CONFIG.maxCycles,
    maxProcesses: config.maxProcesses ?? DEFAULT_CONFIG.maxProcesses,
    minSpacing: config.minSpacing ?? DEFAULT_CONFIG.minSpacing,
    maxBotBytes: config.maxBotBytes ?? DEFAULT_CONFIG.maxBotBytes,
    seed: config.seed ?? DEFAULT_CONFIG.seed,
  }
}

function checkRounds(rounds: number): void {
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new RangeError(`match: rounds must be a positive integer, got ${rounds}`)
  }
}

function hex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/**
 * The cache key of a match: FNV-1a 64 over every input that decides its result, in a fixed
 * layout. That is the resolved config, the round count, and each bot's name and bytes, in
 * order. Names count because the engine result, and so its hash, carries them. A config left
 * out and the same config written out in full give the same key.
 */
export function matchHash(
  bots: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
): string {
  const c = resolve(config)
  const text = JSON.stringify([
    'x16c-match/1',
    [c.coreSize, c.maxCycles, c.maxProcesses, c.minSpacing, c.maxBotBytes, c.seed],
    rounds,
    bots.map((b) => [b.name, hex(b.bytes)]),
  ])
  return fnv1a64(new TextEncoder().encode(text))
}

/** Round `round`'s fighting order in a match of `n` bots: `order[j]` is the entrant placed j-th. */
export function roundOrder(n: number, round: number): number[] {
  return Array.from({ length: n }, (_, j) => (round + j) % n)
}

/** Round `round`'s placement seed in a match whose seed is `seed`: `seed + round`, mod 2^32. */
export function roundSeed(seed: number, round: number): number {
  return (seed + round) >>> 0
}

/**
 * A match of `bots` with no round run yet: what `iterateMatch` starts from. Throws `RangeError`
 * for a bad round count.
 */
export function newMatch(
  bots: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
): MatchResult {
  checkRounds(rounds)
  return {
    key: matchHash(bots, config, rounds),
    names: bots.map((b) => b.name),
    of: rounds,
    rounds: [],
    points: bots.map(() => 0),
  }
}

/**
 * `match` with its next round, `r`: the round's battle, run however the caller ran it, with the
 * bots in `roundOrder` and placed with `roundSeed`. The round's points and survival go to the
 * entrants. A fresh object: `match` stays as it was. Throws when the match is complete.
 */
export function withRound(match: MatchResult, r: RoundResult): MatchResult {
  const i = match.rounds.length
  if (i >= match.of) throw new Error(`match: match ${match.key} has all ${match.of} rounds`)
  const n = match.names.length
  const order = roundOrder(n, i)
  const points: number[] = new Array(n).fill(0)
  const survival: number[] = new Array(n).fill(0)
  r.result.bots.forEach((b, j) => {
    points[order[j] as number] = b.points
    survival[order[j] as number] = b.deathCycle ?? r.durationCycles
  })
  const round: MatchRound = {
    round: i,
    seed: r.seed,
    order,
    resultHash: r.resultHash,
    durationCycles: r.durationCycles,
    points,
    survivors: r.result.survivors.map((j) => order[j] as number).sort((a, b) => a - b),
    survival,
  }
  return {
    ...match,
    rounds: [...match.rounds, round],
    points: match.points.map((p, k) => p + (points[k] as number)),
  }
}

/**
 * Runs the rounds of a match after the `from.rounds.length` already run, up to `through` of
 * them, yielding the match after each. `before` runs ahead of each round. The partials are fresh
 * objects each time, so a caller can keep them.
 */
function* play(
  bots: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  from: MatchResult | undefined,
  before: () => void,
  through = rounds,
): Generator<MatchResult, MatchResult> {
  const c = resolve(config)
  const start = newMatch(bots, c, rounds)
  let match = from ?? start
  if (match.key !== start.key || match.of !== rounds || match.rounds.length > rounds) {
    throw new Error(`match: cannot resume match ${match.key} as match ${start.key}`)
  }
  for (let i = match.rounds.length; i < through; i++) {
    before()
    const order = roundOrder(bots.length, i)
    const r = runRound(
      order.map((k) => bots[k] as LoadedBot),
      { ...c, seed: roundSeed(c.seed, i) },
    )
    match = withRound(match, r)
    yield match
  }
  return match
}

/**
 * Runs a match of `rounds` rounds (ISA §5.5). Round i has seed `config.seed + i` and the bot
 * order rotated by i. With `resume`, it starts after the rounds that partial holds; with
 * `through`, it stops at that many rounds and returns the partial, so a caller can run a match a
 * round at a time. Throws `RangeError` for a bad round count or `through`, `Error` for a
 * `resume` of another match, and what `simulate` throws.
 */
export function runMatch(
  bots: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  options: RunMatchOptions = {},
): MatchResult {
  checkRounds(rounds)
  const { resume, through = rounds } = options
  if (!Number.isInteger(through) || through < 1 || through > rounds) {
    throw new RangeError(`match: through must be an integer in 1..${rounds}, got ${through}`)
  }
  if (resume !== undefined && resume.rounds.length > through) {
    throw new Error(`match: ${resume.rounds.length} rounds run, past through ${through}`)
  }
  const it = play(bots, config, rounds, resume, () => {}, through)
  for (;;) {
    const step = it.next()
    if (step.done) return step.value
  }
}

/**
 * `runMatch` one round at a time: yields `{ round, of, partial }` after each round and returns
 * the whole match. With `resume`, it starts after the rounds that partial holds. With `signal`,
 * an abort stops it before the next round: the iterator throws the abort reason.
 */
export async function* iterateMatch(
  bots: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  options: IterateMatchOptions = {},
): AsyncGenerator<MatchProgress, MatchResult> {
  const { signal, resume } = options
  const it = play(bots, config, rounds, resume, () => signal?.throwIfAborted())
  for (;;) {
    const step = it.next()
    if (step.done) return step.value
    yield { round: step.value.rounds.length, of: rounds, partial: step.value }
  }
}
