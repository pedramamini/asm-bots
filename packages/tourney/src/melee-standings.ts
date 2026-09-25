/**
 * Melee standings (PRODUCT_SPEC §4): each entrant's points, wins, ties, losses, and survival
 * histogram, from a match of all the entrants. Its own module, apart from `melee`, which runs
 * matches: the arena's battle view ranks a melee with it and loads none of the engine's
 * interpreter.
 */
import { type BattleConfigInput, DEFAULT_CONFIG } from '@asmbots/engine'
import type { MatchResult } from './match'
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
