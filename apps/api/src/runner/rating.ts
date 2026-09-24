/**
 * Hill ratings (ARCHITECTURE §5): Glicko-2, a rating period per challenge. The challenger plays
 * one game against each entry it fought (`@asmbots/tourney` `rateMatches`, scored by the match's
 * points), and every player starts the period where the last one left it: the default when it has
 * no rating on the hill.
 */
import { DEFAULT_RATING, type MatchResult, type Rating, rateMatches } from '@asmbots/tourney'

/**
 * The ratings after `challenger` fought `defenders` (bot version ids), `results[i]` its match with
 * `defenders[i]`, challenger first. `ratingOf` gives a player's rating before; the result has the
 * challenger's and every defender's after.
 */
export function rateChallenge(
  ratingOf: (versionId: string) => Rating | undefined,
  challenger: string,
  defenders: readonly string[],
  results: readonly Pick<MatchResult, 'points'>[],
): Map<string, Rating> {
  const players = [challenger, ...defenders]
  const after = rateMatches(
    players.map((id) => ratingOf(id) ?? DEFAULT_RATING),
    results.map((result, i) => ({ entrants: [0, i + 1], result })),
  )
  return new Map(players.map((id, i) => [id, after[i] as Rating]))
}
