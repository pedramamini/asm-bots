/**
 * The cron (`triggers.crons` in `wrangler.jsonc`: Saturdays 18:00 UTC): starts the weekly
 * championship due and makes next week's (`championship.ts`).
 */
import type { TournamentJob } from '@asmbots/protocol'
import {
  type Championship,
  championshipInsert,
  nextChampionshipStart,
  weeklyChampionship,
} from './championship'
import { runnerOf } from './do/runner'
import type { Env } from './env'
import { log } from './middleware'
import { messageOf } from './runner/job'

/** Tries at starting a championship's `Runner` before the cron gives up on it until next week. */
const START_TRIES = 3

/** Makes the next weekly championship after `now`, unless it is there already. Returns it. */
export async function scheduleChampionship(db: D1Database, now: Date): Promise<Championship> {
  const next = weeklyChampionship(nextChampionshipStart(now))
  const { sql, params } = championshipInsert(next)
  await db
    .prepare(sql)
    .bind(...params)
    .run()
  return next
}

/** What the cron did to a championship due: started it, cancelled it, or could not start it. */
export interface Started {
  readonly id: string
  readonly status: 'running' | 'cancelled' | 'failed'
}

/**
 * Starts every championship due by `now` that is still scheduled. One with fewer than 2 entrants
 * is cancelled. A start that fails is tried again, unless its `Runner` refused the job (and so
 * cancelled it).
 */
export async function startChampionships(env: Env, now: Date): Promise<Started[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS n
     FROM tournaments t WHERE t.owner_id IS NULL AND t.status = 'scheduled' AND t.starts_at <= ?
     ORDER BY t.starts_at`,
  )
    .bind(now.toISOString())
    .all<{ id: string; n: number }>()
  const out: Started[] = []
  for (const { id, n } of results) {
    if (n < 2) {
      await env.DB.prepare(
        "UPDATE tournaments SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'",
      )
        .bind(id)
        .run()
      log('warn', 'championship.cancel', { tournament: id, entrants: n })
      out.push({ id, status: 'cancelled' })
      continue
    }
    out.push({ id, status: await start(env, id, n) })
  }
  return out
}

async function start(env: Env, id: string, entrants: number): Promise<Started['status']> {
  const job: TournamentJob = { kind: 'tournament', tournamentId: id }
  for (let tries = 1; ; tries++) {
    try {
      const status = await runnerOf(env, job).start(job)
      log('info', 'championship.start', { tournament: id, entrants, of: status.of })
      return 'running'
    } catch (error) {
      const row = await env.DB.prepare('SELECT status FROM tournaments WHERE id = ?')
        .bind(id)
        .first<{ status: string }>()
      log('error', 'championship.start', { tournament: id, tries, error: messageOf(error) })
      if (row?.status === 'cancelled') return 'cancelled'
      if (tries >= START_TRIES) return 'failed'
    }
  }
}

/** The cron's work at `now`: the championship due starts, and next week's is made. */
export async function runCron(
  env: Env,
  now: Date,
): Promise<{ started: Started[]; next: Championship }> {
  const started = await startChampionships(env, now)
  const next = await scheduleChampionship(env.DB, now)
  return { started, next }
}

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const { started, next } = await runCron(env, new Date(controller.scheduledTime))
  log('info', 'cron', {
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
    started,
    next: next.id,
  })
}
