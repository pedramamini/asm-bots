/**
 * Watching a round of a tournament's match again (PRODUCT_SPEC §4): the round's battle rebuilt
 * from its inputs, the bots in the round's fighting order placed with the round's seed, as a match
 * of one round. That battle is the one `runMatch` ran, so its result hash is the recorded one. A
 * server tournament's inputs are its matches' replays.
 */
import { type BattleConfigInput, DEFAULT_CONFIG } from '@asmbots/engine'
import { type Replay, replayBots, replayConfig } from '@asmbots/protocol'
import { type MatchResult, type MatchRound, roundOrder, roundSeed } from '@asmbots/tourney'
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
  /** The recorded result hash: the replay's check. None for a round not played yet. */
  readonly resultHash?: string | undefined
}

/** `Dwarf v Imp`, or `6 bots` past three. */
function matchLabel(names: readonly string[]): string {
  return names.length > 3 ? `${names.length} bots` : names.join(' v ')
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
  return {
    bots,
    config: { ...tournament.config, seed: round.seed },
    label: `${matchLabel(result.names)} · round ${round.round + 1}`,
    resultHash: round.resultHash,
  }
}

/**
 * Round `round` of `result`, a server tournament's match, from `replay`, the match the server
 * stored: its bots in the round's order, its config with the round's seed.
 */
export function replayWatchTarget(
  replay: Replay,
  result: MatchResult,
  round: MatchRound,
): WatchTarget {
  const bots = replayBots(replay)
  return {
    bots: round.order.map((k) => bots[k] as ArenaBot),
    config: { ...replayConfig(replay), seed: round.seed },
    label: `${matchLabel(result.names)} · round ${round.round + 1}`,
    resultHash: round.resultHash,
  }
}

/**
 * Round `round` of the match of `entrants` that the runner has just started, built from its inputs
 * as `runMatch` builds it (the order rotated by the round, the match seed stepped by it): what
 * auto-watch shows while the runner plays the same round headless. It has no hash to check yet.
 */
export function liveWatchTarget(
  tournament: Tournament,
  entrants: readonly number[],
  round: number,
): WatchTarget {
  const picked = entrants.map((e) => tournament.entrants[e] as TournamentEntrant)
  const all = entrantBots(picked)
  const seed = tournament.config.seed ?? DEFAULT_CONFIG.seed
  return {
    bots: roundOrder(all.length, round).map((k) => all[k] as ArenaBot),
    config: { ...tournament.config, seed: roundSeed(seed, round) },
    label: `live · ${matchLabel(picked.map((e) => e.name))} · round ${round + 1}`,
  }
}
