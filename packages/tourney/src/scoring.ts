/**
 * Standings (PRODUCT_SPEC §4): points, wins, ties, and losses per entrant over a set of matches.
 *
 * A match outcome comes from the match points: the entrant with the most points wins, entrants
 * that share the most points tie, and the rest lose. For two entrants that is the usual W/T/L.
 */
import type { MatchResult } from './match'

/** One entrant's line in a standings table. */
export interface Standing {
  /** The entrant's index in the tournament's entrant list. */
  readonly entrant: number
  readonly name: string
  /** The sum of its match points. */
  readonly points: number
  readonly wins: number
  readonly ties: number
  readonly losses: number
  /** The matches it played. */
  readonly matches: number
}

/** A played match and the tournament entrants in it: `entrants[j]` is the match's entrant j. */
export interface PlayedMatch {
  readonly entrants: readonly number[]
  readonly result: MatchResult
}

/**
 * Orders standings: points, then wins, both descending; then name and entrant index, ascending.
 * Names compare by code unit, not locale, so the order is the same everywhere.
 */
export function compareStandings(
  a: Pick<Standing, 'entrant' | 'name' | 'points' | 'wins'>,
  b: Pick<Standing, 'entrant' | 'name' | 'points' | 'wins'>,
): number {
  if (a.points !== b.points) return b.points - a.points
  if (a.wins !== b.wins) return b.wins - a.wins
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.entrant - b.entrant
}

/** The standings of `names` (the tournament's entrants) over `matches`, ordered. */
export function standingsFromMatches(
  names: readonly string[],
  matches: Iterable<PlayedMatch>,
): Standing[] {
  const rows = names.map((name, entrant) => ({
    entrant,
    name,
    points: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    matches: 0,
  }))
  for (const { entrants, result } of matches) {
    const top = Math.max(...result.points)
    const atTop = result.points.filter((p) => p === top).length
    entrants.forEach((e, j) => {
      const row = rows[e]
      if (row === undefined) throw new RangeError(`standings: no entrant ${e}`)
      const p = result.points[j] as number
      row.points += p
      row.matches++
      if (p < top) row.losses++
      else if (atTop === 1) row.wins++
      else row.ties++
    })
  }
  return rows.sort(compareStandings)
}
