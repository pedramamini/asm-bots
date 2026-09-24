/**
 * `Runner` jobs (ARCHITECTURE §7): the server's long work, one `Runner` Durable Object per job. A
 * hill job fights one submission against a hill's entries; a tournament job plays a tournament's
 * matches. The `Runner` keeps the job's spec, plays one match per alarm, and tells the job's
 * `LiveRoom` how far it is (`progress` in `live.ts`).
 */
import * as z from 'zod/mini'
import { Slug } from './schema'

/**
 * The id of what a job runs for: a submission or a tournament. Letters, digits, `_` and `-`, at
 * most 48, so a job id splits on `:` and a match id (`<ref>-<n>`) stays an `Id`.
 */
export const JobRef = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,48}$/))

/** A hill submission: bot version `botVersionId` challenges the hill `hill` (its slug). */
export const HillJob = z.object({
  kind: z.literal('hill'),
  hill: Slug,
  submissionId: JobRef,
  botVersionId: z.string().check(z.minLength(1), z.maxLength(64)),
})
export type HillJob = z.output<typeof HillJob>

/** All of a tournament's matches, to its standings. */
export const TournamentJob = z.object({ kind: z.literal('tournament'), tournamentId: JobRef })
export type TournamentJob = z.output<typeof TournamentJob>

export const RunnerJob = z.discriminatedUnion('kind', [HillJob, TournamentJob])
export type RunnerJob = z.output<typeof RunnerJob>

/** A job's id, and so its `Runner`'s name: `hill:<slug>:<submissionId>` or `tournament:<id>`. */
export function runnerJobId(job: RunnerJob): string {
  return job.kind === 'hill'
    ? `hill:${job.hill}:${job.submissionId}`
    : `tournament:${job.tournamentId}`
}

/** Where a job is: playing, done, stopped by its owner, or stopped by an error. */
export const JOB_STATUSES = ['running', 'finished', 'cancelled', 'failed'] as const
export const JobStatus = z.enum(JOB_STATUSES)
export type JobStatus = z.output<typeof JobStatus>
