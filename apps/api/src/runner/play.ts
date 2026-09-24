/**
 * One step of a job: the match at the head of its queue, or its next rounds. A match is played
 * once: its `matchHash` names every input that decides its result, so a result stored under that
 * key, by this job before it was cut off or by any other job, is read back and not played again.
 * A result lands in R2 (the replay) before D1 (the row), and in D1 before the `Runner` moves on.
 */
import { buildReplay, type Match, type MatchOutcome } from '@asmbots/protocol'
import { type MatchResult, type MatchSpec, matchHash, runMatch } from '@asmbots/tourney'
import { type MatchRow, toMatch } from '../db/queries'
import type { Env } from '../env'
import { putReplay } from '../storage'
import { fighters, type JobBot, JobError, type JobState, matchId, messageOf } from './job'

export type Step =
  /** The match is longer than one alarm: these are its rounds so far. */
  | { readonly kind: 'partial'; readonly partial: MatchResult }
  /** The match is played, and stored under the job's match id. */
  | {
      readonly kind: 'done'
      readonly result: MatchResult
      readonly match: Match
      /** Its result was stored already: nothing was played. */
      readonly reused: boolean
    }

/** The rounds one alarm plays of a match of `bots` bots. */
function roundsPerAlarm(state: JobState, bots: number): number {
  return Math.max(1, Math.floor(state.budget / (bots * state.battle.maxCycles)))
}

/** `row`'s result as the tourney has a match, or null when it has not all of its rounds. */
function storedResult(
  row: MatchRow,
  key: string,
  names: readonly string[],
  rounds: number,
): MatchResult | null {
  if (row.result_json === null) return null
  const outcome = JSON.parse(row.result_json) as MatchOutcome
  if (outcome.rounds?.length !== rounds || outcome.points.length !== names.length) return null
  return { key, names, of: rounds, rounds: outcome.rounds, points: outcome.points }
}

/**
 * Stores the job's row of a match with `outcome` and returns it as a protocol `Match`. A row
 * that is there already stays as it is.
 */
async function insertRow(
  db: D1Database,
  state: JobState,
  bots: readonly JobBot[],
  spec: MatchSpec,
  key: string,
  outcome: MatchOutcome,
  replayKey: string,
): Promise<Match> {
  const participants = spec.entrants.map((i) => (bots[i] as JobBot).versionId)
  const duel = participants.length === 2
  const row: MatchRow = {
    id: matchId(state, spec),
    tournament_id: state.tournamentId,
    hill_id: state.hillId,
    a_version_id: duel ? (participants[0] ?? null) : null,
    b_version_id: duel ? (participants[1] ?? null) : null,
    participants_json: JSON.stringify(participants),
    rounds: state.rounds,
    seed: state.battle.seed,
    result_json: JSON.stringify(outcome),
    replay_key: replayKey,
    finished_at: new Date().toISOString(),
    match_key: key,
  }
  await db
    .prepare(
      `INSERT INTO matches (id, tournament_id, hill_id, a_version_id, b_version_id,
         participants_json, rounds, seed, result_json, replay_key, finished_at, match_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      row.id,
      row.tournament_id,
      row.hill_id,
      row.a_version_id,
      row.b_version_id,
      row.participants_json,
      row.rounds,
      row.seed,
      row.result_json,
      row.replay_key,
      row.finished_at,
      row.match_key,
    )
    .run()
  return toMatch(row)
}

/**
 * Plays `spec`, the head of the job's queue, or as many of its rounds as the budget allows; or
 * reads its result back when it is stored. Throws `JobError` for a match that cannot be played
 * (the engine refuses its bots) or a row of the job's that holds another match.
 */
export async function playHead(
  env: Env,
  state: JobState,
  bots: readonly JobBot[],
  spec: MatchSpec,
): Promise<Step> {
  const fight = fighters(bots, spec)
  const names = fight.map((b) => b.name)
  const key = matchHash(fight, state.battle, state.rounds)
  const id = matchId(state, spec)
  if (state.partial === null) {
    const [own, same] = await env.DB.batch<MatchRow>([
      env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id),
      env.DB.prepare(
        `SELECT * FROM matches WHERE match_key = ? AND result_json IS NOT NULL
         ORDER BY finished_at LIMIT 1`,
      ).bind(key),
    ])
    const mine = own?.results[0]
    if (mine !== undefined) {
      // The job stored this match, then was cut off before it moved on.
      if (mine.match_key !== key) throw new JobError(`match ${id} is stored as another match`)
      const result = storedResult(mine, key, names, state.rounds)
      if (result === null) throw new JobError(`match ${id} is stored without its rounds`)
      return { kind: 'done', result, match: toMatch(mine), reused: true }
    }
    // Another job played the same match (same key, same inputs): its result is this one's.
    const other = same?.results[0]
    const known = other === undefined ? null : storedResult(other, key, names, state.rounds)
    if (other !== undefined && known !== null && other.replay_key !== null) {
      const outcome = JSON.parse(other.result_json as string) as MatchOutcome
      const match = await insertRow(env.DB, state, bots, spec, key, outcome, other.replay_key)
      return { kind: 'done', result: known, match, reused: true }
    }
  }
  const from = state.partial?.rounds.length ?? 0
  const through = Math.min(state.rounds, from + roundsPerAlarm(state, fight.length))
  let result: MatchResult
  try {
    result = runMatch(fight, state.battle, state.rounds, {
      resume: state.partial ?? undefined,
      through,
    })
  } catch (error) {
    throw new JobError(`match ${id} cannot be played: ${messageOf(error)}`)
  }
  if (result.rounds.length < state.rounds) return { kind: 'partial', partial: result }
  const replay = await buildReplay({
    bots: fight,
    config: state.battle,
    rounds: state.rounds,
    match: result,
  })
  const replayKey = await putReplay(env.REPLAYS, replay)
  const { points, survivors, resultHash, rounds } = replay.result
  const outcome: MatchOutcome = { points, survivors, resultHash, rounds }
  const match = await insertRow(env.DB, state, bots, spec, key, outcome, replayKey)
  return { kind: 'done', result, match, reused: false }
}
