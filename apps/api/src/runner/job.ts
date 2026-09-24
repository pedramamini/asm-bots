/**
 * A `Runner` job (ARCHITECTURE §7) as its Durable Object keeps it: the spec, the bots, the matches
 * still to play, and where the job is. The DO stores the state under `job`, the bots under `bots`,
 * and each match's result under `result:<spec id>`.
 */
import type { BattleConfig, LoadedBot } from '@asmbots/engine'
import type { JobStatus, ReplayConfig, RunnerJob } from '@asmbots/protocol'
import type { MatchResult, MatchSpec } from '@asmbots/tourney'
import { botBytesKey } from '../storage'

/**
 * Instructions one alarm may play, counted as bots × cycles a round × rounds: about 5 s of CPU at a
 * cautious 10 M instructions a second, well inside a Worker's CPU limit. A longer match plays a
 * few rounds an alarm.
 */
export const ALARM_BUDGET = 50_000_000

/** Failures in a row before a job gives up. */
export const MAX_FAILURES = 5

/** How a job plays: a hill's challenger against each entry, or a tournament of one kind. */
export type JobFormat = 'hill' | 'roundrobin' | 'bracket' | 'melee'

/** A bot of a job: a bot version, as the job took it. */
export interface JobBot {
  readonly versionId: string
  /** Its bot's name when the job took it: its name in every match of the job. */
  readonly name: string
  readonly bytes: Uint8Array
}

/** A played match: what standings need of it. */
export interface PlayedSpec extends MatchSpec {
  /** Match points per entrant. */
  readonly points: readonly number[]
}

/** How a hill job ended for its challenger. */
export interface HillOutcome {
  /** Whether it stayed on the hill. */
  readonly accepted: boolean
  /** Its rank on the new board, or null when it did not stay. */
  readonly rank: number | null
  /** Its score in the field, before the lowest entry went. */
  readonly score: number
  /** The bot version pushed off: the challenger itself when it did not stay. */
  readonly evicted: string | null
}

/** What a job is set up with (`setupHill`, `setupTournament`). */
export interface JobSetup {
  readonly format: JobFormat
  /** Its `LiveRoom` (`liveRoomName`). */
  readonly room: string
  /** Its matches' `hill_id` and `tournament_id`. */
  readonly hillId: string | null
  readonly tournamentId: string | null
  /** Its match ids are `<prefix>-<spec id>`: the submission id, or the tournament id. */
  readonly prefix: string
  readonly rounds: number
  /** Every match's config; its seed is the match seed. */
  readonly battle: BattleConfig
  /** A `MatchSpec`'s entrants index them. A hill job's challenger is bot 0. */
  readonly bots: readonly JobBot[]
  /** The matches to play, in order. */
  readonly queue: readonly MatchSpec[]
  /** The matches the job knows of. */
  readonly of: number
}

export interface JobState extends Omit<JobSetup, 'bots' | 'queue' | 'of'> {
  readonly id: string
  readonly spec: RunnerJob
  status: JobStatus
  queue: MatchSpec[]
  /** In the order they finished. */
  played: PlayedSpec[]
  /** The matches the job knows of: played, queued, and a bracket's still to be drawn. */
  of: number
  /** The head of the queue, part played, when it is longer than one alarm's budget. */
  partial: MatchResult | null
  /** `ALARM_BUDGET`, kept per job. */
  budget: number
  alarms: number
  /** Failures in a row. */
  failures: number
  error: string | null
  outcome: HillOutcome | null
}

/** What `Runner.status` answers. */
export interface RunnerStatus {
  readonly job: string
  readonly status: JobStatus
  /** Matches played, of the matches known. */
  readonly done: number
  readonly of: number
  readonly alarms: number
  /** The last error, when the job failed or is trying again. */
  readonly error: string | null
  /** A hill job's outcome, once it is finished. */
  readonly outcome: HillOutcome | null
}

export function statusOf(state: JobState): RunnerStatus {
  return {
    job: state.id,
    status: state.status,
    done: state.played.length,
    of: state.of,
    alarms: state.alarms,
    error: state.error,
    outcome: state.outcome,
  }
}

/** A job that cannot go on as asked: trying again would fail the same way. */
export class JobError extends Error {
  override readonly name = 'JobError'
}

/** The engine config of matches under `config` placed from `seed`: the config's fields only. */
export function battleOf(config: ReplayConfig, seed: number): BattleConfig {
  const { coreSize, maxCycles, maxProcesses, minSpacing, maxBotBytes } = config
  return { coreSize, maxCycles, maxProcesses, minSpacing, maxBotBytes, seed }
}

/** The D1 `matches` id of a job's match. */
export function matchId(state: Pick<JobState, 'prefix'>, spec: MatchSpec): string {
  return `${state.prefix}-${spec.id}`
}

/** A match's bots, in entrant order, as the engine loads them. */
export function fighters(bots: readonly JobBot[], spec: MatchSpec): LoadedBot[] {
  return spec.entrants.map((i) => {
    const bot = bots[i]
    if (bot === undefined) throw new JobError(`match ${spec.id} names bot ${i}, and there is none`)
    return { name: bot.name, bytes: bot.bytes }
  })
}

/** A bot version to load: its id, its bot's name, and the SHA-256 of its bytes. */
export interface VersionRef {
  readonly versionId: string
  readonly name: string
  readonly sha256: string
}

/** The bots of `refs`, their bytes read from R2. */
export async function loadBots(bucket: R2Bucket, refs: readonly VersionRef[]): Promise<JobBot[]> {
  return Promise.all(
    refs.map(async ({ versionId, name, sha256 }) => {
      const object = await bucket.get(botBytesKey(sha256))
      if (object === null) throw new JobError(`the bytes of bot version ${versionId} are missing`)
      return { versionId, name, bytes: new Uint8Array(await object.arrayBuffer()) }
    }),
  )
}

/** `error` in words. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
