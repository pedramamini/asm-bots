/**
 * Scoring (ISA §5.5, PRODUCT_SPEC §4): pMARS points per round, and standings (points, wins,
 * ties, and losses per entrant) over a set of matches, with a CSV export.
 *
 * A match outcome comes from the match points: the entrant with the most points wins, entrants
 * that share the most points tie, and the rest lose. For two entrants that is the usual W/T/L.
 */
import type { MatchResult } from './match'

/**
 * The pMARS points of each survivor of a round of `n` bots with `survivors` survivors:
 * `floor((n*n - 1) / survivors)`, 0 when none survive (ISA §5.5). The engine's own function, so
 * the tourney and the engine can never disagree.
 */
export { pmarsPoints } from '@asmbots/engine'

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

/**
 * A played match and the tournament entrants in it: `entrants[j]` is the match's entrant j. Only
 * its points count, so a caller that keeps no more of a match than its points can pass those.
 */
export interface PlayedMatch {
  readonly entrants: readonly number[]
  readonly result: Pick<MatchResult, 'points'>
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

/** The columns `csv` needs: a `Standing` or a `MeleeStanding` fits. */
export type CsvStanding = Pick<
  Standing,
  'entrant' | 'name' | 'points' | 'wins' | 'ties' | 'losses'
>

/** The header row of `csv`. */
export const CSV_HEADER = 'rank,entrant,name,points,wins,ties,losses'

/**
 * The standings as CSV (RFC 4180, CRLF line ends): a header, then one row per standing in the
 * given order, ranked from 1. A name with a comma, a quote, or a line break is quoted. A name
 * that starts with `=`, `+`, `-`, `@`, a tab, or a CR gets a leading `'`, so a spreadsheet does
 * not run it as a formula (bot names are user input).
 */
export function csv(standings: readonly CsvStanding[]): string {
  const rows = standings.map((s, i) =>
    [i + 1, s.entrant, csvField(s.name), s.points, s.wins, s.ties, s.losses].join(','),
  )
  return `${[CSV_HEADER, ...rows].join('\r\n')}\r\n`
}

function csvField(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}
