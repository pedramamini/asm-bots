/**
 * The size of a tournament before it plays (PRODUCT_SPEC §4): what a list says of one that has
 * not finished ("running · 12 / 66"), and what a form says of one being made.
 */

/** The formats, as the server names them. */
export type TournamentFormat = 'roundrobin' | 'bracket' | 'melee'

/** Whether a bracket of `entrants` bots plays its third-place match: it needs two semifinal losers. */
export function playsThirdPlace(entrants: number, thirdPlace: boolean): boolean {
  return thirdPlace && entrants >= 4
}

/**
 * The matches a tournament of `entrants` bots plays: every pair of a round robin; one fewer than
 * the bots of a bracket (a bye plays nothing), and its third-place match; one match of a melee.
 * None for fewer than 2 bots.
 */
export function plannedMatches(
  format: TournamentFormat,
  entrants: number,
  thirdPlace = false,
): number {
  if (entrants < 2) return 0
  switch (format) {
    case 'roundrobin':
      return (entrants * (entrants - 1)) / 2
    case 'bracket':
      return entrants - 1 + (playsThirdPlace(entrants, thirdPlace) ? 1 : 0)
    case 'melee':
      return 1
  }
}
