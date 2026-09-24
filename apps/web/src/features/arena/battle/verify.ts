/**
 * A replay's check (PRODUCT_SPEC §2, ARCHITECTURE §7: "verified locally"): the arena runs the
 * replay's inputs, and each round's result hash (ISA §5.6) must equal the one the replay recorded.
 * The arena's own run is the check: a round is verified when it ends.
 */
import type { LocalReplay } from './replay'

/** What the arena's run of a replay has given so far. */
export interface ReplayRun {
  /** The key of the match the Worker loaded, `matchHash` of the replay's inputs; null before. */
  readonly key: string | null
  /** Each round's result hash as the arena ended it, by round (from 0). */
  readonly hashes: ReadonlyMap<number, string>
  /** Why the arena could not run the replay, or null. */
  readonly error: string | null
}

/** The run of a replay before anything came back. */
export const NO_RUN: ReplayRun = Object.freeze({ key: null, hashes: new Map(), error: null })

/** The replay's bots against their SHA-256 (`bytesProblem`): not checked yet, as recorded, or not. */
export type BytesCheck = 'pending' | 'ok' | { readonly problem: string }

/**
 * How a replay stands: `pending` until its rounds have ended, with the rounds verified so far;
 * `verified` when every round's hash matched; `mismatch`, and why, at the first thing that did not.
 */
export type ReplayCheck =
  | { readonly state: 'pending'; readonly verified: number; readonly of: number }
  | { readonly state: 'verified'; readonly of: number }
  | { readonly state: 'mismatch'; readonly reason: string }

/**
 * The check of `replay` given the arena's `run` and the SHA-256 check of its bots. Bytes that are
 * not what the replay says, a run that failed, a match loaded from other inputs than the recorded
 * one's (another key), and a round's hash that differs are each a mismatch.
 */
export function checkReplay(replay: LocalReplay, run: ReplayRun, bytes: BytesCheck): ReplayCheck {
  const of = replay.match.of
  if (typeof bytes === 'object') return { state: 'mismatch', reason: bytes.problem }
  if (run.error !== null)
    return { state: 'mismatch', reason: `the replay did not run: ${run.error}` }
  if (run.key !== null && run.key !== replay.match.key) {
    return { state: 'mismatch', reason: 'the recorded match is of other bots or another config' }
  }
  let verified = 0
  for (let round = 0; round < of; round++) {
    const hash = run.hashes.get(round)
    if (hash === undefined) continue
    const recorded = replay.match.rounds[round]?.resultHash
    if (hash !== recorded) {
      const which = of > 1 ? `round ${round + 1}: ` : ''
      return {
        state: 'mismatch',
        reason: `${which}result ${hash}, recorded ${recorded ?? 'nothing'}`,
      }
    }
    verified++
  }
  if (verified === of && bytes === 'ok' && run.key !== null) return { state: 'verified', of }
  return { state: 'pending', verified, of }
}

/** The chip's words: `verifying`, `verified 1/3`, `verified`, `mismatch`. */
export function checkLabel(check: ReplayCheck): string {
  switch (check.state) {
    case 'pending':
      return check.verified === 0 ? 'verifying' : `verified ${check.verified}/${check.of}`
    case 'verified':
      return 'verified'
    case 'mismatch':
      return 'mismatch'
  }
}

/** What the chip's title says about `check`. */
export function checkTitle(check: ReplayCheck): string {
  switch (check.state) {
    case 'pending':
      return check.of === 1
        ? 'checked against the recorded result hash when the battle ends'
        : `${check.verified} of ${check.of} rounds match their recorded result hash; each round is checked when it ends`
    case 'verified':
      return check.of === 1
        ? 'the result hash matches the recorded one'
        : `all ${check.of} rounds match their recorded result hash`
    case 'mismatch':
      return check.reason
  }
}
