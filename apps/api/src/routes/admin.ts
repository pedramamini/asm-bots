import {
  type AdminJob,
  type AdminStats,
  hillJobId,
  type RunnerJob,
  type RunnerReport,
  SubmissionStatus,
  TournamentStatus,
} from '@asmbots/protocol'
import { Hono, type MiddlewareHandler } from 'hono'
import { getUser } from '../db/queries'
import { runnerOf } from '../do/runner'
import type { AppEnv, Env } from '../env'
import { errorResponse, log } from '../middleware'
import { countSpectators, openableRooms } from '../rooms'
import { messageOf } from '../runner/job'

/** The most jobs the stats list, oldest first. */
export const MAX_LISTED_JOBS = 50

/** The handles `value` names (`ADMIN_HANDLES`): split on commas and spaces, in lowercase. */
export function adminHandles(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/[\s,]+/)
      .map((handle) => handle.toLowerCase())
      .filter((handle) => handle !== ''),
  )
}

/** 401 unless someone is signed in; 403 unless their handle is one of `ADMIN_HANDLES`. */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get('session')
  if (!session) return errorResponse(c, 'unauthorized', 'sign in first')
  const user = await getUser(c.env.DB, session.userId)
  if (user === null || !adminHandles(c.env.ADMIN_HANDLES).has(user.handle.toLowerCase())) {
    return errorResponse(c, 'forbidden', 'the stats are for admins')
  }
  await next()
}

/** A row of the job queue: a submission queued or running, or a tournament running. */
interface QueueRow {
  kind: 'hill' | 'tournament'
  id: string
  /** A submission's hill slug and bot version; null for a tournament. */
  hill: string | null
  version: string | null
  status: 'queued' | 'running'
  since: string | null
}

/** Counts by status, every status there (0 for none). */
function byStatus<S extends string>(
  statuses: readonly S[],
  rows: readonly { status: string; n: number }[],
): Record<S, number> {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<S, number>
  for (const { status, n } of rows) if (status in counts) counts[status as S] = n
  return counts
}

/** What `row`'s `Runner` says of its job; null when it has none or does not answer. */
async function report(env: Env, row: QueueRow): Promise<RunnerReport | null> {
  const job: RunnerJob =
    row.kind === 'hill'
      ? {
          kind: 'hill',
          hill: row.hill ?? '',
          submissionId: row.id,
          botVersionId: row.version ?? '',
        }
      : { kind: 'tournament', tournamentId: row.id }
  try {
    const status = await runnerOf(env, job).status()
    if (status === null) return null
    const { done, of, alarms, error } = status
    return { status: status.status, done, of, alarms, error }
  } catch (error) {
    log('warn', 'admin.runner', { job: row.id, error: messageOf(error) })
    return null
  }
}

/**
 * `GET /api/admin/stats`: the job queues and the Durable Objects (`AdminStats`), for the handles
 * in `ADMIN_HANDLES` only. It asks each job listed for its `Runner`'s status, and each room a page
 * may have open for its spectators.
 */
export const admin = new Hono<AppEnv>().use('*', requireAdmin).get('/stats', async (c) => {
  const db = c.env.DB
  const [submissions, tournaments, queue, rooms] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT status, COUNT(*) AS n FROM hill_submissions GROUP BY status'),
    db.prepare('SELECT status, COUNT(*) AS n FROM tournaments GROUP BY status'),
    db
      .prepare(
        `SELECT * FROM (
           SELECT 'hill' AS kind, s.id, h.slug AS hill, s.bot_version_id AS version, s.status,
             s.created_at AS since
           FROM hill_submissions s JOIN hills h ON h.id = s.hill_id
           WHERE s.status IN ('queued', 'running')
           UNION ALL
           SELECT 'tournament', t.id, NULL, NULL, t.status, t.starts_at FROM tournaments t
           WHERE t.status = 'running')
         ORDER BY since IS NULL, since, id LIMIT ?`,
      )
      .bind(MAX_LISTED_JOBS),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM hills)
         + (SELECT COUNT(*) FROM tournaments WHERE status != 'draft') AS n`,
    ),
  ])
  const submissionCounts = byStatus(
    SubmissionStatus.options,
    (submissions?.results ?? []) as { status: string; n: number }[],
  )
  const tournamentCounts = byStatus(
    TournamentStatus.options,
    (tournaments?.results ?? []) as { status: string; n: number }[],
  )
  const rows = (queue?.results ?? []) as unknown as QueueRow[]
  const [reports, counts] = await Promise.all([
    Promise.all(rows.map((row) => report(c.env, row))),
    openableRooms(db).then((names) => countSpectators(c.env, names)),
  ])
  const jobs = rows.map(
    (row, i): AdminJob => ({
      job: row.kind === 'hill' ? hillJobId(row.hill ?? '', row.id) : `tournament:${row.id}`,
      kind: row.kind,
      status: row.status,
      since: row.since,
      runner: reports[i] ?? null,
    }),
  )
  const stats: AdminStats = {
    at: new Date().toISOString(),
    submissions: submissionCounts,
    tournaments: tournamentCounts,
    queue: jobs,
    durableObjects: {
      runners:
        Object.values(submissionCounts).reduce((sum, n) => sum + n, 0) +
        tournamentCounts.running +
        tournamentCounts.finished,
      activeRunners: submissionCounts.queued + submissionCounts.running + tournamentCounts.running,
      liveRooms: Number((rooms?.results[0] as { n?: number } | undefined)?.n ?? 0),
      askedRooms: counts.length,
    },
    rooms: counts.filter((room) => room.spectators > 0),
    spectators: counts.reduce((sum, room) => sum + room.spectators, 0),
  }
  return c.json(stats)
})
