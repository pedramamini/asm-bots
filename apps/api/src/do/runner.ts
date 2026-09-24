import { DurableObject } from 'cloudflare:workers'
import { type LiveMessage, parse, RunnerJob, runnerJobId, type Standing } from '@asmbots/protocol'
import type { MatchResult } from '@asmbots/tourney'
import type { Env } from '../env'
import { log } from '../middleware'
import { endSubmission, finalizeHill, setupHill } from '../runner/hill'
import {
  ALARM_BUDGET,
  type JobBot,
  JobError,
  type JobSetup,
  type JobState,
  MAX_FAILURES,
  matchId,
  messageOf,
  type RunnerStatus,
  statusOf,
} from '../runner/job'
import { playHead } from '../runner/play'
import {
  advanceBracket,
  cancelTournament,
  finalizeTournament,
  setupTournament,
  tournamentStandings,
} from '../runner/tournament'

/** The longest wait between tries after a failure, ms. */
const MAX_BACKOFF = 60_000

/** The `Runner` of `job`: one Durable Object per job id. */
export function runnerOf(env: Pick<Env, 'RUNNER'>, job: RunnerJob): DurableObjectStub<Runner> {
  return env.RUNNER.get(env.RUNNER.idFromName(runnerJobId(job)))
}

/**
 * Runs one job (ARCHITECTURE §7): a hill submission (`hill:<slug>:<submissionId>`) or a
 * tournament (`tournament:<id>`), one match per alarm, so no alarm runs long and a job cut off
 * anywhere picks up where it was. Each match lands in R2 (its replay) and D1 (its row) before the
 * job moves on, and a match stored already is read back, not played again. When the queue is
 * empty the job settles: a hill's new board, or a tournament's standings. Standings change only
 * from matches the server played itself.
 *
 * Storage: `job` (a `JobState`), `bots` (its `JobBot`s), and `result:<spec id>` per match.
 */
export class Runner extends DurableObject<Env> {
  /**
   * Starts `spec`: reads what it needs from D1 and R2, keeps it, and sets the first alarm. A
   * runner that has the job already answers its status. Throws `ProtocolError` for a spec that
   * is not a job, and `JobError` for one that cannot run (no such hill, a bot over the size); a
   * hill submission that cannot run is marked failed.
   */
  async start(spec: RunnerJob): Promise<RunnerStatus> {
    const job = parse(RunnerJob, spec, 'the job')
    const id = runnerJobId(job)
    // An error thrown inside `blockConcurrencyWhile` resets the object: it comes out as a value.
    const begun = await this.ctx.blockConcurrencyWhile(async () => {
      try {
        const had = await this.job()
        if (had !== null) {
          if (had.id !== id) throw new JobError(`the runner of ${had.id} cannot start ${id}`)
          return { state: had, bots: await this.bots(), fresh: false }
        }
        const { bots, ...setup } = await this.setup(job)
        const state: JobState = {
          ...setup,
          id,
          spec: job,
          status: 'running',
          queue: [...setup.queue],
          played: [],
          partial: null,
          budget: ALARM_BUDGET,
          alarms: 0,
          failures: 0,
          error: null,
          outcome: null,
        }
        await this.ctx.storage.put<unknown>({ job: state, bots })
        await this.arm()
        return { state, bots, fresh: true }
      } catch (error) {
        return { error }
      }
    })
    if ('error' in begun) throw begun.error
    const { state, bots, fresh } = begun
    if (fresh) {
      log('info', 'runner.start', { job: id, of: state.of })
      await this.publish(state, [this.progress(state)])
    }
    return statusOf(state, bots)
  }

  /** The job's status, with the match it is playing, or null when this runner has none. */
  async status(): Promise<RunnerStatus | null> {
    const state = await this.job()
    return state && statusOf(state, await this.bots())
  }

  /**
   * Stops the job before its next match: its submission or tournament is marked cancelled, and
   * a hill's board stays as it was. A job that has ended answers its status.
   */
  async cancel(): Promise<RunnerStatus | null> {
    const state = await this.job()
    if (state === null || state.status !== 'running') return state && statusOf(state)
    state.status = 'cancelled'
    await this.ctx.storage.put('job', state)
    await this.ctx.storage.deleteAlarm()
    await this.end(state, 'cancelled')
    log('info', 'runner.cancel', { job: state.id, done: state.played.length })
    await this.publish(state, [this.progress(state)])
    return statusOf(state)
  }

  /** One step: the next match (or a few of its rounds), or the settling of the job. */
  override async alarm(): Promise<void> {
    const state = await this.job()
    if (state === null || state.status !== 'running') return
    state.alarms++
    try {
      await this.step(state)
    } catch (error) {
      await this.failed(error)
    }
  }

  private async setup(job: RunnerJob): Promise<JobSetup> {
    if (job.kind === 'tournament') return setupTournament(this.env, job)
    try {
      return await setupHill(this.env, job)
    } catch (error) {
      if (error instanceof JobError) {
        await this.env.DB.prepare(
          "UPDATE hill_submissions SET status = 'failed' WHERE id = ? AND status IN ('queued', 'running')",
        )
          .bind(job.submissionId)
          .run()
      }
      throw error
    }
  }

  private async step(state: JobState): Promise<void> {
    const bots = await this.bots()
    const spec = state.queue[0]
    if (spec === undefined) return this.settle(state, bots)
    if (state.partial === null) {
      const participants = spec.entrants.map((i) => (bots[i] as JobBot).versionId)
      await this.publish(state, [
        {
          type: 'matchStarted',
          match: {
            id: matchId(state, spec),
            participants,
            rounds: state.rounds,
            seed: state.battle.seed,
          },
        },
      ])
    }
    const started = Date.now()
    const step = await playHead(this.env, state, bots, spec)
    if (step.kind === 'partial') {
      state.partial = step.partial
      if (await this.commit(state)) await this.arm()
      return
    }
    log('info', 'runner.match', {
      job: state.id,
      match: step.match.id,
      bots: spec.entrants.length,
      reused: step.reused,
      ms: Date.now() - started,
    })
    state.queue.shift()
    state.played.push({ ...spec, points: [...step.result.points] })
    state.partial = null
    state.failures = 0
    state.error = null
    // Only a bracket (to draw) and a melee (its standings) need the results before the end.
    const results =
      state.format === 'bracket' || state.format === 'melee'
        ? await this.results()
        : new Map<number, MatchResult>()
    results.set(spec.id, step.result)
    if (state.format === 'bracket') await advanceBracket(this.env, state, bots, results)
    if (!(await this.commit(state, { [`result:${spec.id}`]: step.result }))) return
    const messages: LiveMessage[] = [{ type: 'matchFinished', match: step.match }]
    if (state.format !== 'hill') {
      messages.push(this.standings(tournamentStandings(state, bots, results)))
    }
    if (state.queue.length > 0) {
      await this.arm()
      await this.publish(state, [...messages, this.progress(state)])
      return
    }
    await this.publish(state, messages)
    await this.settle(state, bots)
  }

  /** The queue is empty: writes what the job came to, or queues what it still has to play. */
  private async settle(state: JobState, bots: readonly JobBot[]): Promise<void> {
    const results = await this.results()
    if (state.format === 'hill') {
      const final = await finalizeHill(this.env, state, bots, results)
      if (final.kind === 'more') {
        state.queue.push(...final.queue)
        state.of += final.queue.length
        if (!(await this.commit(state, { bots: final.bots }))) return
        await this.arm()
        await this.publish(state, [this.progress(state)])
        return
      }
      // The board is written: the job is finished, whatever a cancel said meanwhile.
      state.status = 'finished'
      state.outcome = final.outcome
      await this.ctx.storage.put('job', state)
      log('info', 'runner.finish', { job: state.id, ...final.outcome })
      await this.publish(state, [this.standings(final.standings), this.progress(state)])
      return
    }
    const standings = await finalizeTournament(this.env, state, bots, results)
    state.status = 'finished'
    if (!(await this.commit(state))) return
    log('info', 'runner.finish', { job: state.id, matches: state.played.length })
    await this.publish(state, [this.standings(standings), this.progress(state)])
  }

  /**
   * After a step threw: what it did is dropped, and the job tries again later, waiting longer
   * each time. A `JobError`, or `MAX_FAILURES` in a row, fails it.
   */
  private async failed(error: unknown): Promise<void> {
    const state = await this.job()
    if (state === null || state.status !== 'running') return
    state.alarms++
    state.failures++
    state.error = messageOf(error)
    const giveUp = error instanceof JobError || state.failures >= MAX_FAILURES
    log(giveUp ? 'error' : 'warn', 'runner.step', {
      job: state.id,
      failures: state.failures,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
    if (!giveUp) {
      await this.ctx.storage.put('job', state)
      await this.arm(Math.min(MAX_BACKOFF, 1000 * 2 ** state.failures))
      return
    }
    state.status = 'failed'
    await this.ctx.storage.put('job', state)
    await this.end(state, 'failed')
    await this.publish(state, [this.progress(state)])
  }

  /** Marks in D1 that the job stopped: its submission, or its tournament (cancelled). */
  private async end(state: JobState, status: 'cancelled' | 'failed'): Promise<void> {
    if (state.tournamentId !== null) await cancelTournament(this.env, state)
    else await endSubmission(this.env, state, status)
  }

  /**
   * Keeps `state` (and `entries`) unless the job was cancelled while the step ran: then the step
   * is dropped. Its match stays in D1 and R2, as any played match does.
   */
  private async commit(state: JobState, entries: Record<string, unknown> = {}): Promise<boolean> {
    const stored = await this.job()
    if (stored?.status !== 'running') return false
    await this.ctx.storage.put<unknown>({ ...entries, job: state })
    return true
  }

  /** Sets the next alarm: now, or `after` ms from now, past `RUNNER_ALARM_DELAY_MS`. */
  private async arm(after = 0): Promise<void> {
    const delay = Number(this.env.RUNNER_ALARM_DELAY_MS ?? 0)
    await this.ctx.storage.setAlarm(Date.now() + (delay > 0 ? delay : 0) + after)
  }

  /** Sends `messages` to the job's room. Spectators are not the job: a failure is only logged. */
  private async publish(state: JobState, messages: LiveMessage[]): Promise<void> {
    try {
      const room = this.env.LIVE_ROOM.get(this.env.LIVE_ROOM.idFromName(state.room))
      await room.publish(messages)
    } catch (error) {
      log('warn', 'runner.publish', { job: state.id, room: state.room, error: messageOf(error) })
    }
  }

  private progress(state: JobState): LiveMessage {
    const { id: job, status, played, of } = state
    return { type: 'progress', job, status, done: played.length, of }
  }

  private standings(entries: Standing[]): LiveMessage {
    return { type: 'standings', entries }
  }

  private async job(): Promise<JobState | null> {
    return (await this.ctx.storage.get<JobState>('job')) ?? null
  }

  private async bots(): Promise<JobBot[]> {
    return (await this.ctx.storage.get<JobBot[]>('bots')) ?? []
  }

  /** The job's match results, by spec id. */
  private async results(): Promise<Map<number, MatchResult>> {
    const stored = await this.ctx.storage.list<MatchResult>({ prefix: 'result:' })
    return new Map(
      [...stored].map(([key, result]) => [Number(key.slice('result:'.length)), result]),
    )
  }
}
