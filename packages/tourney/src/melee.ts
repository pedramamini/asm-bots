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
import type { BattleConfigInput, LoadedBot } from '@asmbots/engine'
import { type IterateMatchOptions, iterateMatch, type MatchResult, runMatch } from './match'
import {
  DEFAULT_SURVIVAL_BINS,
  MAX_MELEE_ENTRANTS,
  type MeleeStanding,
  meleeStandings,
} from './melee-standings'

export type { MeleeStanding } from './melee-standings'
export { DEFAULT_SURVIVAL_BINS, MAX_MELEE_ENTRANTS, meleeStandings } from './melee-standings'

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
