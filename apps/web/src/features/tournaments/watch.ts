/**
 * Watching a round of a tournament's match again (PRODUCT_SPEC §4): the round's battle rebuilt
 * from its inputs, the bots in the round's fighting order placed with the round's seed, as a match
 * of one round. That battle is the one `runMatch` ran, so its result hash is the recorded one.
 */
import type { BattleConfigInput } from '@asmbots/engine'
import type { MatchResult, MatchRound } from '@asmbots/tourney'
import type { ArenaBot } from '../arena/worker/protocol'
import { entrantBots } from './runner'
import type { Tournament, TournamentEntrant } from './store'

/** A round to watch: what the arena loads, and what the round recorded. */
export interface WatchTarget {
  /** The bots in fighting order. */
  readonly bots: readonly ArenaBot[]
  /** The tournament's config with the round's seed. */
  readonly config: BattleConfigInput
  /** `Dwarf v Imp · round 2`. */
  readonly label: string
  /** The recorded result hash: the replay's check. */
  readonly resultHash: string
}

/**
 * Round `round` of `result`, a match of the tournament's entrants `entrants` (tournament entrant
 * indices, in the match's order). Throws what `entrantBots` throws: a bot gone or broken.
 */
export function watchTarget(
  tournament: Tournament,
  entrants: readonly number[],
  result: MatchResult,
  round: MatchRound,
): WatchTarget {
  const all = entrantBots(entrants.map((e) => tournament.entrants[e] as TournamentEntrant))
  const bots = round.order.map((k) => all[k] as ArenaBot)
  const names = result.names.length > 3 ? `${result.names.length} bots` : result.names.join(' v ')
  return {
    bots,
    config: { ...tournament.config, seed: round.seed },
    label: `${names} · round ${round.round + 1}`,
    resultHash: round.resultHash,
  }
}
