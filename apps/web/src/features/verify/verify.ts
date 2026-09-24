/**
 * `verify` (ARCHITECTURE §7, verification model): a published match, run again on this machine.
 * The server's inputs (`GET /api/matches/:id/verify`) play headless in an arena Worker, a round at
 * a time, and the check is a live match's (`liveCheck`): the bots against their SHA-256, the match
 * key against the one the row stores, and each round's result hash against the row's, or the
 * match's one hash for a row stored without rounds. The row is the result the standings came from.
 */
import { bytesProblem, type MatchVerification, replayBots } from '@asmbots/protocol'
import type { MatchResult } from '@asmbots/tourney'
import { type BytesCheck, NO_RUN, type ReplayCheck, type ReplayRun } from '../arena/battle/verify'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import { liveCheck } from '../live/check'

/** What runs the rounds: an arena Worker's client, or a stand-in in a test. */
export type VerifyClient = Pick<ArenaClient, 'runMatch' | 'dispose'>

export interface VerifyOptions {
  /** Makes the client that runs the match. Default: an arena Worker with a store of its own. */
  readonly createClient?: (() => VerifyClient) | undefined
  /** Stops the run: its Worker ends, and nothing more is reported. */
  readonly signal?: AbortSignal | undefined
}

const newClient = (): VerifyClient => new ArenaClient({ store: createArenaStore() })

/**
 * Runs `verification`'s inputs a round at a time, and calls `onCheck` with how the match stands
 * after its bytes are checked and after each round. Resolves with the last check: `verified`, or
 * `mismatch` at the first thing that differs (a run the Worker refuses is one, and says why).
 */
export async function verifyMatch(
  { match, inputs }: MatchVerification,
  onCheck: (check: ReplayCheck) => void,
  { createClient = newClient, signal }: VerifyOptions = {},
): Promise<ReplayCheck> {
  let bytes: BytesCheck = 'pending'
  let run: ReplayRun = NO_RUN
  const report = (): ReplayCheck => {
    const check: ReplayCheck =
      run.error === null
        ? liveCheck(inputs, match, run, bytes, 'the server')
        : { state: 'mismatch', reason: `the match did not run: ${run.error}` }
    if (!signal?.aborted) onCheck(check)
    return check
  }
  const problem = await bytesProblem(inputs)
  bytes = problem === null ? 'ok' : { problem }
  const checked = report()
  if (checked.state === 'mismatch' || signal?.aborted) return checked
  const client = createClient()
  const stop = () => client.dispose()
  signal?.addEventListener('abort', stop)
  try {
    const bots = replayBots(inputs)
    const config = { ...inputs.config, seed: inputs.seed }
    let partial: MatchResult | undefined
    for (let round = 1; round <= inputs.rounds; round++) {
      partial = await client.runMatch(bots, config, inputs.rounds, {
        resume: partial,
        through: round,
      })
      run = {
        key: partial.key,
        hashes: new Map(partial.rounds.map((r, i) => [i, r.resultHash])),
        error: null,
      }
      const check = report()
      if (check.state !== 'pending') return check
    }
    return report()
  } catch (error) {
    run = { ...run, error: error instanceof Error ? error.message : String(error) }
    return report()
  } finally {
    signal?.removeEventListener('abort', stop)
    client.dispose()
  }
}
