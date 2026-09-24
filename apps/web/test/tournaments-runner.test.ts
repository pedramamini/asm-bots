/**
 * The tournament store and runner (src/features/tournaments): records in IndexedDB (on
 * fake-indexeddb), each match run through a `MatchExecutor`, the record saved after each, and a
 * reload that picks up where the last save left it.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { BattleConfigInput } from '@asmbots/engine'
import {
  bracket,
  type MatchResult,
  meleeStandings,
  type RunMatchOptions,
  roundRobin,
  runMatch,
} from '@asmbots/tourney'
import type { ArenaBot } from '../src/features/arena/worker/protocol'
import { ArenaSession } from '../src/features/arena/worker/session'
import {
  entrantBots,
  type MatchExecutor,
  TournamentRunner,
} from '../src/features/tournaments/runner'
import {
  createTournament,
  deleteTournament,
  getTournament,
  listTournaments,
  type NewTournament,
  type Tournament,
  type TournamentEntrant,
} from '../src/features/tournaments/store'
import { manualSchedule, sessionClient } from './session-worker'

const CONFIG: BattleConfigInput = { maxCycles: 2_000, seed: 1 }
const ROUNDS = 2

const roster = (...slugs: string[]): TournamentEntrant[] =>
  slugs.map((slug) => ({ source: 'roster', ref: slug, name: slug }))

const FOUR = roster('dwarf', 'imp', 'paper', 'stone')

function input(kind: Tournament['kind'], entrants: TournamentEntrant[]): NewTournament {
  return { name: `${kind} cup`, kind, entrants, config: CONFIG, rounds: ROUNDS, thirdPlace: true }
}

/** `runMatch` in this thread, counting its calls; from call `hangFrom` on, it never answers. */
function executor(hangFrom = Number.POSITIVE_INFINITY) {
  const calls: (readonly string[])[] = []
  const exec: MatchExecutor = {
    runMatch(
      bots: readonly ArenaBot[],
      config: BattleConfigInput,
      rounds: number,
      options?: RunMatchOptions,
    ): Promise<MatchResult> {
      calls.push(bots.map((b) => b.name))
      if (calls.length >= hangFrom) return new Promise(() => {})
      return Promise.resolve(runMatch(bots, config, rounds, options))
    },
  }
  return { exec, calls }
}

/** Resolves once `runner` has saved `id` with `n` matches (a melee: rounds). */
function savedWith(runner: TournamentRunner, id: string, n: number): Promise<Tournament> {
  return new Promise((resolve) => {
    const off = runner.subscribe((event) => {
      if (event.type !== 'saved' || event.tournament.id !== id) return
      const { tournament } = event
      const count =
        tournament.kind === 'melee'
          ? (tournament.matches[0]?.rounds.length ?? 0)
          : tournament.matches.length
      if (count === n) {
        off()
        resolve(tournament)
      }
    })
  })
}

/** Runs `id` on a runner that stops answering after `n` matches, as a reload would leave it. */
async function playThenReload(id: string, n: number): Promise<Tournament> {
  const { exec } = executor(n + 1)
  const before = new TournamentRunner(() => exec)
  const saved = savedWith(before, id, n)
  void before.start(id)
  await saved
  const stored = (await getTournament(id)) as Tournament
  expect(stored.status).toBe('running')
  return stored
}

beforeEach(async () => {
  for (const t of await listTournaments()) await deleteTournament(t.id)
})

const clients: { dispose(): void }[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
})

describe('tournament store', () => {
  it('creates a scheduled tournament with nothing played, and lists the newest first', async () => {
    const first = await createTournament(input('melee', FOUR))
    const second = await createTournament(input('bracket', FOUR))
    expect(first).toMatchObject({
      status: 'scheduled',
      matches: [],
      champion: null,
      progress: { done: 0, of: 0 },
    })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const third = await createTournament(input('round-robin', FOUR))
    expect((await listTournaments()).map((t) => t.id)[0]).toBe(third.id)
    expect(await getTournament(second.id)).toEqual(second)
    await deleteTournament(second.id)
    expect(await getTournament(second.id)).toBeUndefined()
  })
})

describe('tournament runner', () => {
  it('resumes a round robin after a simulated reload with two matches already done', async () => {
    const { id } = await createTournament(input('round-robin', FOUR))
    const left = await playThenReload(id, 2)
    expect(left.progress).toEqual({ done: 2, of: 6 })

    // The reload: a new runner, whose matches run in the arena Worker's session.
    const { client, worker } = sessionClient(manualSchedule().schedule)
    clients.push(client)
    const after = new TournamentRunner(() => client)
    await after.resumeRunning()

    expect(worker.sent.map((r) => r.type)).toEqual(['match', 'match', 'match', 'match'])
    const done = (await getTournament(id)) as Tournament
    const whole = roundRobin(entrantBots(FOUR), CONFIG, { rounds: ROUNDS })
    expect(done.status).toBe('finished')
    expect(done.matches).toEqual(whole.matches)
    expect(done.standings).toEqual(whole.standings)
    expect(done.champion).toBe(whole.standings[0]?.entrant ?? -1)
    expect(done.progress).toEqual({ done: 6, of: 6 })
  })

  it('resumes a bracket from its saved state and ends as bracket() does', async () => {
    const five = roster('dwarf', 'imp', 'paper', 'stone', 'scanner')
    const { id } = await createTournament(input('bracket', five))
    const left = await playThenReload(id, 2)
    expect(left.bracket?.matches.filter((m) => m.status === 'done')).toHaveLength(2)

    const { exec, calls } = executor()
    await new TournamentRunner(() => exec).resumeRunning()
    const done = (await getTournament(id)) as Tournament
    const whole = bracket(entrantBots(five), CONFIG, {
      seeding: 'given',
      thirdPlace: true,
      rounds: ROUNDS,
    })
    expect(done.bracket).toEqual(whole)
    expect(done.status).toBe('finished')
    expect(done.champion).toBe(whole.matches[whole.final]?.winner ?? -1)
    // 5 entrants: 4 matches to a champion, and the third-place match.
    expect(done.matches).toHaveLength(5)
    expect(calls).toHaveLength(3)
  })

  it('runs a melee a round at a time and resumes from the rounds saved', async () => {
    const three = roster('dwarf', 'imp', 'paper')
    const { id } = await createTournament({ ...input('melee', three), rounds: 3 })
    const left = await playThenReload(id, 1)
    expect(left.progress).toEqual({ done: 1, of: 3 })

    const { exec, calls } = executor()
    const runner = new TournamentRunner(() => exec)
    // Each `match` event names the round it starts at, so auto-watch can show that round.
    const starts: number[] = []
    runner.subscribe((event) => {
      if (event.type === 'match') starts.push(event.round)
    })
    await runner.resumeRunning()
    expect(starts).toEqual([1, 2])
    const done = (await getTournament(id)) as Tournament
    const whole = runMatch(entrantBots(three), CONFIG, 3)
    expect(done.matches).toEqual([whole])
    expect(done.standings).toEqual(meleeStandings(whole, CONFIG))
    expect(done.champion).toBe(meleeStandings(whole, CONFIG)[0]?.entrant ?? -1)
    expect(calls).toHaveLength(2)
  })

  it('pauses after the matches saved, and starts again from them', async () => {
    const { id } = await createTournament(input('round-robin', FOUR))
    const { exec, calls } = executor(3)
    const runner = new TournamentRunner(() => exec)
    const saved = savedWith(runner, id, 2)
    const run = runner.start(id)
    await saved
    expect(runner.isRunning(id)).toBe(true)
    await runner.pause(id)
    const paused = (await run) as Tournament
    expect(paused.status).toBe('paused')
    expect(paused.matches).toHaveLength(2)
    expect(runner.isRunning(id)).toBe(false)
    // A reload does not start a paused tournament.
    const idle = executor()
    await new TournamentRunner(() => idle.exec).resumeRunning()
    expect(idle.calls).toHaveLength(0)

    const more = executor()
    const finished = await new TournamentRunner(() => more.exec).start(id)
    expect(finished?.status).toBe('finished')
    expect(more.calls).toHaveLength(4)
    // The third match, if it had started, was dropped.
    expect(calls.length).toBeLessThanOrEqual(3)
  })

  it('cancels for good, running or not', async () => {
    const { id } = await createTournament(input('round-robin', FOUR))
    const { exec } = executor(2)
    const runner = new TournamentRunner(() => exec)
    const saved = savedWith(runner, id, 1)
    const run = runner.start(id)
    await saved
    await runner.cancel(id)
    expect((await run)?.status).toBe('cancelled')
    const again = executor()
    expect((await new TournamentRunner(() => again.exec).start(id))?.status).toBe('cancelled')
    expect(again.calls).toHaveLength(0)

    const idle = await createTournament(input('melee', FOUR))
    await runner.cancel(idle.id)
    expect((await getTournament(idle.id))?.status).toBe('cancelled')
  })

  it('fails with the reason when an entrant does not assemble', async () => {
    const broken: TournamentEntrant = { source: 'local', ref: 'x', name: 'junk', code: 'nope r9' }
    const { id } = await createTournament(input('round-robin', [...FOUR, broken]))
    const { exec, calls } = executor()
    const failed = await new TournamentRunner(() => exec).start(id)
    expect(failed).toMatchObject({ status: 'failed', error: 'junk: does not assemble' })
    expect(calls).toHaveLength(0)
  })

  it('tells its listeners each match as it starts', async () => {
    const { id } = await createTournament({ ...input('round-robin', FOUR.slice(0, 3)) })
    const { exec } = executor()
    const runner = new TournamentRunner(() => exec)
    const started: (readonly number[])[] = []
    runner.subscribe((event) => {
      if (event.type === 'match') started.push(event.entrants)
    })
    await runner.start(id)
    expect(started).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
  })
})

describe('the arena Worker’s match request, in part', () => {
  it('runs the rounds after resume up to through, as runMatch does', () => {
    const session = new ArenaSession()
    const bots = entrantBots(FOUR.slice(0, 3))
    const [first] = session.handle({ type: 'match', bots, config: CONFIG, rounds: 3, through: 1 })
    const partial = (first as { match: MatchResult }).match
    expect(partial.rounds).toHaveLength(1)
    const [rest] = session.handle({
      type: 'match',
      bots,
      config: CONFIG,
      rounds: 3,
      resume: partial,
    })
    expect(rest).toEqual({ type: 'match', match: runMatch(bots, CONFIG, 3) })
  })
})
