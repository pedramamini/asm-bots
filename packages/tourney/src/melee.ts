/**
 * Melee (ARCHITECTURE §5, PRODUCT_SPEC §4): up to 16 entrants, all in one core each round. A
 * melee is one match of all the entrants, so the order rotates and the seeds step as in any
 * match (ISA §5.5). Standings are by total points.
 *
 * Per round, an entrant wins as the sole survivor, ties as one of several survivors, and loses
 * when it dies. Its survival histogram counts the rounds by the cycles it lived through, in
 * `bins` equal bins over 0..maxCycles; a survivor of a battle that ran to the cycle cap lands in
 * the last bin.
 */
import { type BattleConfigInput, DEFAULT_CONFIG, type LoadedBot } from '@asmbots/engine'
import { type IterateMatchOptions, iterateMatch, type MatchResult, runMatch } from './match'
import { compareStandings } from './scoring'

/** The most entrants in a melee. */
export const MAX_MELEE_ENTRANTS = 16

/** The survival histogram bins when the caller gives none. */
export const DEFAULT_SURVIVAL_BINS = 10

/** One entrant's line in melee standings. */
export interface MeleeStanding {
  /** The entrant's index in the melee's entrant list. */
  readonly entrant: number
  readonly name: string
  /** The sum of its round points. */
  readonly points: number
  /** Rounds it was the sole survivor of. */
  readonly wins: number
  /** Rounds it survived with others. */
  readonly ties: number
  /** Rounds it died in. */
  readonly losses: number
  /** The cycles it lived through, per round. */
  readonly survival: readonly number[]
  /** `histogram[b]`: the rounds whose survival falls in bin b. Sums to the rounds run. */
  readonly histogram: readonly number[]
}

export interface MeleeOptions {
  /** Survival histogram bins. Default `DEFAULT_SURVIVAL_BINS`. */
  readonly bins?: number | undefined
}

export interface IterateMeleeOptions extends MeleeOptions, IterateMatchOptions {}

/** A melee, whole or in part. */
export interface MeleeResult {
  /** The melee's match: all the entrants, in entrant order. */
  readonly match: MatchResult
  readonly standings: readonly MeleeStanding[]
}

/** What `iterateMelee` yields after each round. */
export interface MeleeProgress {
  /** The rounds run so far. */
  readonly round: number
  /** The rounds the melee has in all. */
  readonly of: number
  readonly partial: MeleeResult
}

function check(entrants: readonly LoadedBot[], bins: number): void {
  if (entrants.length < 2 || entrants.length > MAX_MELEE_ENTRANTS) {
    throw new RangeError(`melee: needs 2..${MAX_MELEE_ENTRANTS} entrants, got ${entrants.length}`)
  }
  if (!Number.isInteger(bins) || bins < 1) {
    throw new RangeError(`melee: bins must be a positive integer, got ${bins}`)
  }
}

/** The histogram bin of `cycles` lived: `bins` equal bins over 0..maxCycles. */
function bin(cycles: number, maxCycles: number, bins: number): number {
  if (maxCycles <= 0) return 0
  return Math.min(bins - 1, Math.floor((cycles * bins) / maxCycles))
}

/** The melee standings of `match` (all the entrants, in entrant order), ordered. */
export function meleeStandings(
  match: MatchResult,
  config: BattleConfigInput,
  bins = DEFAULT_SURVIVAL_BINS,
): MeleeStanding[] {
  const maxCycles = config.maxCycles ?? DEFAULT_CONFIG.maxCycles
  return match.names
    .map((name, entrant) => {
      const survival = match.rounds.map((r) => r.survival[entrant] as number)
      const histogram: number[] = new Array(bins).fill(0)
      for (const s of survival) {
        const b = bin(s, maxCycles, bins)
        histogram[b] = (histogram[b] as number) + 1
      }
      let wins = 0
      let ties = 0
      for (const r of match.rounds) {
        if (!r.survivors.includes(entrant)) continue
        if (r.survivors.length === 1) wins++
        else ties++
      }
      return {
        entrant,
        name,
        points: match.points[entrant] as number,
        wins,
        ties,
        losses: match.rounds.length - wins - ties,
        survival,
        histogram,
      }
    })
    .sort(compareStandings)
}

/**
 * Runs a melee of `rounds` rounds: all of `entrants` (2..16) in one core per round. Throws
 * `RangeError` for a bad entrant count or bin count, and what `runMatch` throws.
 */
export function melee(
  entrants: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  options: MeleeOptions = {},
): MeleeResult {
  const { bins = DEFAULT_SURVIVAL_BINS } = options
  check(entrants, bins)
  const match = runMatch(entrants, config, rounds)
  return { match, standings: meleeStandings(match, config, bins) }
}

/**
 * `melee` one round at a time: yields `{ round, of, partial }` after each round and returns the
 * whole melee. `resume` and `signal` work as in `iterateMatch`, with `resume` the melee's match.
 */
export async function* iterateMelee(
  entrants: readonly LoadedBot[],
  config: BattleConfigInput,
  rounds: number,
  options: IterateMeleeOptions = {},
): AsyncGenerator<MeleeProgress, MeleeResult> {
  const { bins = DEFAULT_SURVIVAL_BINS, ...matchOptions } = options
  check(entrants, bins)
  const it = iterateMatch(entrants, config, rounds, matchOptions)
  for (;;) {
    const step = await it.next()
    if (step.done) return { match: step.value, standings: meleeStandings(step.value, config, bins) }
    const { partial } = step.value
    yield {
      round: step.value.round,
      of: rounds,
      partial: { match: partial, standings: meleeStandings(partial, config, bins) },
    }
  }
}
