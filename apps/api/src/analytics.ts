/**
 * Workers Analytics Engine (ARCHITECTURE §7, observability): one data point per match a `Runner`
 * settles, in the dataset `asmbots_matches` (binding `MATCH_ANALYTICS`). The README has the
 * columns and a query.
 */
import type { Env } from './env'
import { log } from './middleware'
import { type JobFormat, messageOf } from './runner/job'

/** A match a `Runner` settled. */
export interface MatchPoint {
  /** How its job plays: `hill`, `roundrobin`, `bracket`, `melee`. */
  readonly kind: JobFormat
  /** Its job (`runnerJobId`) and its `matches` row id. */
  readonly job: string
  readonly match: string
  /** Its result was stored already (this job's, or another's with the same key): nothing played. */
  readonly reused: boolean
  readonly bots: number
  readonly rounds: number
  /** The engine cycles its rounds ran, in all. */
  readonly cycles: number
  /** The wall time its alarms took, ms, storage included. */
  readonly ms: number
}

/**
 * `point` as the dataset's columns. index1: the kind (the sampling key). blob1: the kind, blob2:
 * `played` or `reused`, blob3: the job, blob4: the match. double1: 1 (a match: sum it for the
 * count), double2: ms, double3: bots, double4: rounds, double5: cycles.
 */
export function matchDataPoint(point: MatchPoint): AnalyticsEngineDataPoint {
  return {
    indexes: [point.kind],
    blobs: [point.kind, point.reused ? 'reused' : 'played', point.job, point.match],
    doubles: [1, point.ms, point.bots, point.rounds, point.cycles],
  }
}

/** Writes `point`. Analytics are not the job: a failure is only logged. */
export function recordMatch(env: Pick<Env, 'MATCH_ANALYTICS'>, point: MatchPoint): void {
  try {
    env.MATCH_ANALYTICS?.writeDataPoint(matchDataPoint(point))
  } catch (error) {
    log('warn', 'analytics.match', { job: point.job, match: point.match, error: messageOf(error) })
  }
}
