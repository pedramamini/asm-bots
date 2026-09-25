/**
 * The tournament runner (PRODUCT_SPEC §4): plays a stored tournament to its end with
 * `@asmbots/tourney`'s iterators, each match headless in the arena Worker, and saves the record
 * after every match (every round of a melee). A reload loses at most the match in flight:
 * `resumeRunning` starts every tournament still `running` from the matches it saved.
 *
 * A round robin runs through `iterateRoundRobin`, a bracket through `iterateBracket`; a melee is
 * one match, run a round at a time (`runMatch`'s `resume` and `through`) and scored with
 * `meleeStandings`. Pause and cancel stop at once: the match in flight is dropped, not saved.
 */
import type { BattleConfigInput } from '@asmbots/engine'
import {
  type Bracket,
  champion,
  createBracket,
  iterateBracket,
  iterateRoundRobin,
  MAX_MELEE_ENTRANTS,
  type MatchResult,
  meleeStandings,
  type RunMatchOptions,
  roundRobinSchedule,
} from '@asmbots/tourney'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { assembleCached } from '../arena/setup/assembly'
import { rosterCatalog } from '../arena/setup/bots'
import { ArenaClient, createArenaStore } from '../arena/worker/client'
import type { ArenaBot } from '../arena/worker/protocol'
import {
  getTournament,
  listTournaments,
  saveTournament,
  TOURNAMENTS_KEY,
  type Tournament,
  type TournamentEntrant,
  tournamentKey,
} from './store'

/** What runs the matches: an `ArenaClient`, or a stand-in in a test. */
export interface MatchExecutor {
  runMatch(
    bots: readonly ArenaBot[],
    config: BattleConfigInput,
    rounds: number,
    options?: RunMatchOptions,
  ): Promise<MatchResult>
}

/**
 * `match`: a match starts; `entrants` are the tournament's entrant indices in it, `round` the
 * first round it runs (a melee's, resumed). `saved`: the record changed and is stored, after a
 * match or on a change of status.
 */
export type RunnerEvent =
  | {
      readonly type: 'match'
      readonly id: string
      readonly entrants: readonly number[]
      readonly round: number
    }
  | { readonly type: 'saved'; readonly tournament: Tournament }

/** Why a run stopped short: the abort reason of its signal. */
class Stop extends Error {
  constructor(readonly kind: 'pause' | 'cancel' | 'forget') {
    super(`tournament ${kind}`)
    this.name = 'Stop'
  }
}

/** The bots of `entrants`, as the Worker loads them. Throws for a bot that is gone or broken. */
export function entrantBots(entrants: readonly TournamentEntrant[]): ArenaBot[] {
  const roster = new Map(
    rosterCatalog().flatMap((bot) =>
      bot.ref.kind === 'roster' ? [[bot.ref.slug, bot.assembled] as const] : [],
    ),
  )
  return entrants.map((entrant) => {
    if (entrant.code === undefined && entrant.bytes !== undefined) {
      return { name: entrant.name, bytes: entrant.bytes }
    }
    const assembled =
      entrant.source === 'roster'
        ? roster.get(entrant.ref)
        : entrant.code === undefined
          ? undefined
          : assembleCached(entrant.code)
    if (assembled === undefined) throw new Error(`${entrant.name}: no such bot`)
    if (assembled.diagnostics.some((d) => d.severity === 'error')) {
      throw new Error(`${entrant.name}: does not assemble`)
    }
    const { author, strategy, version } = assembled
    return { name: entrant.name, bytes: assembled.bytes, meta: { author, strategy, version } }
  })
}

/** A bracket's matches played, and those it will play at most: walkovers settle unplayed. */
export function bracketProgress(bracket: Bracket): Tournament['progress'] {
  const done = bracket.matches.filter((m) => m.status === 'done').length
  const left = bracket.matches.filter((m) => m.status === 'ready' || m.status === 'pending')
  return { done, of: done + left.length }
}

/** `promise`, or the abort reason as soon as `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export class TournamentRunner {
  /** The runs in progress, by tournament id. */
  private readonly active = new Map<string, AbortController>()
  private readonly listeners = new Set<(event: RunnerEvent) => void>()

  /** `executor` is asked for on the first match, so a page that runs none starts no Worker. */
  constructor(private readonly executor: () => MatchExecutor) {}

  /** Calls `listener` with each event. Returns what stops it. */
  subscribe(listener: (event: RunnerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  isRunning(id: string): boolean {
    return this.active.has(id)
  }

  /**
   * Runs tournament `id` from where it stands until it ends, fails, or is paused or cancelled.
   * Resolves with the record as saved last; at once, with the record as it is, when it is
   * already running here, finished, cancelled, or gone.
   */
  async start(id: string): Promise<Tournament | undefined> {
    if (this.active.has(id)) return getTournament(id)
    const controller = new AbortController()
    this.active.set(id, controller)
    try {
      const stored = await getTournament(id)
      if (stored === undefined || stored.status === 'finished' || stored.status === 'cancelled') {
        return stored
      }
      return await this.run(stored, controller.signal)
    } finally {
      this.active.delete(id)
    }
  }

  /** Starts every tournament stored as `running` that is not running here. */
  async resumeRunning(): Promise<void> {
    const running = (await listTournaments()).filter(
      (t) => t.status === 'running' && !this.active.has(t.id),
    )
    await Promise.all(running.map((t) => this.start(t.id)))
  }

  /** Stops tournament `id` after the matches saved; `start` goes on from them. */
  pause(id: string): Promise<void> {
    return this.stop(id, 'pause')
  }

  /** Stops tournament `id` for good. */
  cancel(id: string): Promise<void> {
    return this.stop(id, 'cancel')
  }

  /** Stops tournament `id` without saving anything more: before it is deleted. */
  forget(id: string): void {
    this.active.get(id)?.abort(new Stop('forget'))
  }

  private async stop(id: string, kind: 'pause' | 'cancel'): Promise<void> {
    const controller = this.active.get(id)
    if (controller !== undefined) {
      controller.abort(new Stop(kind))
      return
    }
    // Not running here: a record left `running` by a reload, or one not started.
    const stored = await getTournament(id)
    if (stored === undefined || stored.status === 'finished' || stored.status === 'cancelled') {
      return
    }
    if (kind === 'pause' && stored.status !== 'running') return
    await this.save({ ...stored, status: kind === 'pause' ? 'paused' : 'cancelled' })
  }

  private emit(event: RunnerEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private async save(tournament: Tournament): Promise<Tournament> {
    const saved = await saveTournament(tournament)
    this.emit({ type: 'saved', tournament: saved })
    return saved
  }

  private async run(stored: Tournament, signal: AbortSignal): Promise<Tournament> {
    let current: Tournament = { ...stored, status: 'running', error: undefined }
    /** Saves `next` unless the run was stopped meanwhile: the stop saves what it keeps. */
    const keep = async (next: Tournament) => {
      signal.throwIfAborted()
      current = await this.save(next)
    }
    try {
      await keep(current)
      const bots = entrantBots(current.entrants)
      const { id, config, rounds } = current
      const runMatch = (
        entrants: readonly number[],
        options?: RunMatchOptions,
      ): Promise<MatchResult> => {
        this.emit({ type: 'match', id, entrants, round: options?.resume?.rounds.length ?? 0 })
        const matchBots = entrants.map((e) => bots[e] as ArenaBot)
        return abortable(this.executor().runMatch(matchBots, config, rounds, options), signal)
      }
      switch (current.kind) {
        case 'round-robin': {
          const of = roundRobinSchedule(bots.length).length
          await keep({ ...current, progress: { done: current.matches.length, of } })
          const it = iterateRoundRobin(bots, config, {
            rounds,
            resume: current.matches,
            signal,
            run: (_, spec) => runMatch(spec.entrants),
          })
          for (;;) {
            const step = await it.next()
            if (step.done) {
              const top = step.value.standings[0]
              await keep({ ...current, status: 'finished', champion: top?.entrant ?? null })
              break
            }
            const { result, standings, match } = step.value
            await keep({
              ...current,
              matches: [...current.matches, result],
              standings,
              progress: { done: match, of },
            })
          }
          break
        }
        case 'bracket': {
          const bracket =
            current.bracket ??
            createBracket(bots, {
              seeding: current.seeding ?? 'given',
              thirdPlace: (current.thirdPlace ?? false) && bots.length >= 3,
            })
          await keep({ ...current, bracket, progress: bracketProgress(bracket) })
          const it = iterateBracket(bracket, (pair) => runMatch(pair), { signal })
          for (;;) {
            const step = await it.next()
            if (step.done) {
              await keep({ ...current, status: 'finished', champion: champion(step.value) })
              break
            }
            const played = step.value
            await keep({
              ...current,
              bracket: played.bracket,
              matches: [...current.matches, played.match.result as MatchResult],
              progress: bracketProgress(played.bracket),
            })
          }
          break
        }
        case 'melee': {
          if (bots.length < 2 || bots.length > MAX_MELEE_ENTRANTS) {
            throw new RangeError(`melee: needs 2..${MAX_MELEE_ENTRANTS} entrants`)
          }
          const all = bots.map((_, e) => e)
          let match = current.matches[0]
          await keep({ ...current, progress: { done: match?.rounds.length ?? 0, of: rounds } })
          while (match === undefined || match.rounds.length < rounds) {
            signal.throwIfAborted()
            const through = (match?.rounds.length ?? 0) + 1
            match = await runMatch(all, { resume: match, through })
            await keep({
              ...current,
              matches: [match],
              standings: meleeStandings(match, config),
              progress: { done: through, of: rounds },
            })
          }
          const standings = meleeStandings(match, config)
          await keep({ ...current, status: 'finished', champion: standings[0]?.entrant ?? null })
          break
        }
      }
      return current
    } catch (error) {
      if (error instanceof Stop) {
        if (error.kind === 'forget') return current
        return this.save({ ...current, status: error.kind === 'pause' ? 'paused' : 'cancelled' })
      }
      const message = error instanceof Error ? error.message : String(error)
      return this.save({ ...current, status: 'failed', error: message })
    }
  }
}

let shared: TournamentRunner | undefined
let arena: ArenaClient | undefined

/**
 * The page's runner. Its matches run in an arena Worker of their own, beside any battle the
 * arena page is showing.
 */
export function tournamentRunner(): TournamentRunner {
  shared ??= new TournamentRunner(() => {
    arena ??= new ArenaClient({ store: createArenaStore() })
    return arena
  })
  return shared
}

/**
 * Keeps the query cache of `useTournaments` and `useTournament` current as `runner` saves, and
 * picks up the tournaments a reload left running.
 */
export function useRunnerSync(runner: TournamentRunner = tournamentRunner()): void {
  const client = useQueryClient()
  useEffect(() => {
    const off = runner.subscribe((event) => {
      if (event.type !== 'saved') return
      const { tournament } = event
      client.setQueryData(tournamentKey(tournament.id), tournament)
      client.setQueryData<Tournament[]>(TOURNAMENTS_KEY, (list) =>
        list?.map((t) => (t.id === tournament.id ? tournament : t)),
      )
    })
    void runner.resumeRunning()
    return off
  }, [runner, client])
}
