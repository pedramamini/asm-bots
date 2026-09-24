/**
 * A live match's check (ARCHITECTURE §7, verification model): the spectator's own run of the
 * inputs the room sent at `matchStarted`, against the row the server stored at `matchFinished`.
 * Until that row comes the chip says `verifying`; then the match reads as a replay does
 * (`checkReplay`): its bots against their SHA-256, the match key, and each round's result hash.
 */
import { ISA, type LiveMatch, type Match, matchResultHash, type Replay } from '@asmbots/protocol'
import {
  type BytesCheck,
  checkReplay,
  type ReplayCheck,
  type ReplayRun,
} from '../arena/battle/verify'

/** The replay of `match` with the server's `result`; null when the row has no rounds to check. */
export function liveReplay(match: LiveMatch, result: Match): Replay | null {
  const outcome = result.result
  if (outcome?.rounds === undefined) return null
  return {
    isa: ISA,
    config: match.config,
    seed: match.seed,
    rounds: match.rounds,
    bots: match.bots,
    result: {
      key: match.key,
      survivors: outcome.survivors,
      points: outcome.points,
      resultHash: outcome.resultHash,
      rounds: outcome.rounds,
    },
  }
}

/** How `match` stands: the page's `run` of it, its `bytes` check, and the server's `result`. */
export function liveCheck(
  match: LiveMatch,
  result: Match | null,
  run: ReplayRun,
  bytes: BytesCheck,
): ReplayCheck {
  const replay = result === null ? null : liveReplay(match, result)
  if (replay !== null) return checkReplay(replay, run, bytes)
  const of = match.rounds
  if (typeof bytes === 'object') return { state: 'mismatch', reason: bytes.problem }
  if (run.error !== null)
    return { state: 'mismatch', reason: `the match did not run: ${run.error}` }
  if (run.key !== null && run.key !== match.key) {
    return {
      state: 'mismatch',
      reason: 'the match the room sent is of other bots or another config',
    }
  }
  const recorded = result?.result?.resultHash
  // A row with no rounds (none of the Runner's) still has the match's hash, once every round ran.
  if (recorded !== undefined && run.hashes.size === of && bytes === 'ok') {
    const hashes = Array.from({ length: of }, (_, round) => ({
      resultHash: run.hashes.get(round) ?? '',
    }))
    const mine = matchResultHash(hashes)
    return mine === recorded
      ? { state: 'verified', of }
      : { state: 'mismatch', reason: `result ${mine}, recorded ${recorded}` }
  }
  return { state: 'pending', verified: 0, of }
}
