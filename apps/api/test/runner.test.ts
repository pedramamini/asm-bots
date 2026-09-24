/**
 * The `Runner` Durable Object, its alarms stepped by hand (`RUNNER_ALARM_DELAY_MS` is an hour in
 * the tests): hill submissions against a board the launch seed built, a job cut off halfway, two
 * jobs on one hill, a match played a few rounds an alarm, cancel, refusals, and tournaments. The
 * expected boards come from `@asmbots/tourney`'s `hill`, run here on the same bots.
 */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { assembleOrThrow } from '@asmbots/asm'
import type { LoadedBot } from '@asmbots/engine'
import {
  fromBase64,
  type HillJob,
  ISA,
  type LiveMessage,
  liveRoomName,
  type MatchOutcome,
  matchResultHash,
  parseReplay,
  type RunnerJob,
  sha256Hex,
  type TournamentJob,
} from '@asmbots/protocol'
import {
  createHill,
  type HillResult,
  type HillState,
  hill,
  type MatchResult,
  runMatch,
} from '@asmbots/tourney'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { listHillEntries } from '../src/db/queries'
import { applySeed, buildSeed, SEED_MATCH_SEED, type SeedHill } from '../src/db/seed'
import { type Runner, runnerOf } from '../src/do/runner'
import { writeBoard } from '../src/runner/hill'
import type { JobState } from '../src/runner/job'
import { botBytesKey, replayObjectKey } from '../src/storage'
import { spectate } from './live-socket'

const SPIN = '%name "Spin"\n%author "ASM Bots"\nstart: jmp $\n'
const HALT = '%name "Halt"\n%author "ASM Bots"\nstart: hlt ; lint: allow hlt-in-code\n'
const DWARF = `%name "Dwarf"
%author "ASM Bots"
SIZE equ end - start
start:  call .here
.here:  pop bx
        sub bx, .here
lap:    mov di, bx
        mov cx, (0x10000 - SIZE) / 4
.bomb:  sub di, 4
        mov word [di], 0
        loop .bomb
        jmp lap
end:
`
const IMP = `%name "Imp"
start:  call .here
.here:  pop bx
        sub bx, .here
        lea si, [bx+imp]
        lea di, [bx+imp+2]
imp:    movsw
        nop
`
const LOOP = '%name "Loop"\nstart: nop\n        jmp start\n'
/** Challengers no other job has played: every match of theirs is new. */
const PAD = '%name "Pad"\nstart: nop\n        nop\n        jmp start\n'
const PAD2 = '%name "Pad2"\nstart: nop\n        nop\n        nop\n        jmp start\n'

/** The seeded bots, in the order they took the hills. */
const DEFENDERS = [
  { slug: 'spin', source: SPIN, melee: true },
  { slug: 'halt', source: HALT, melee: true },
  { slug: 'dwarf', source: DWARF, melee: false },
]

const CONFIG = {
  coreSize: 0x10000,
  maxCycles: 20_000,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
}
const ROUNDS = 3

/** A duel hill of 3 for each test that changes one; `crowd` is a melee hill. */
const HILLS: SeedHill[] = [
  ...['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'eta', 'theta'].map((slug) => ({
    slug,
    name: slug,
    description: '',
    size: 3,
    rounds: ROUNDS,
    config: CONFIG,
    scoring: 'duel' as const,
  })),
  {
    slug: 'crowd',
    name: 'crowd',
    description: '',
    size: 8,
    rounds: ROUNDS,
    config: CONFIG,
    scoring: 'melee',
  },
]

const loaded = (source: string): LoadedBot => {
  const out = assembleOrThrow(source)
  return { name: out.name, bytes: out.bytes }
}

/** A user's bot at version 1, bytes in R2, as `POST /api/bots` makes one. */
async function addBot(id: string, source: string): Promise<LoadedBot> {
  const bot = loaded(source)
  const sha = await sha256Hex(bot.bytes)
  await env.REPLAYS.put(botBytesKey(sha), bot.bytes)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES (?, 'u1', ?, ?, 'public')`,
    ).bind(id, id, bot.name),
    env.DB.prepare(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    ).bind(`${id}-v1`, id, source, sha, bot.bytes.length, ISA),
  ])
  return bot
}

/** A queued submission of `versionId` to hill `slug` by `user`, and its job. */
async function submit(id: string, slug: string, versionId: string, user = 'u1'): Promise<HillJob> {
  await env.DB.prepare(
    'INSERT INTO hill_submissions (id, hill_id, bot_version_id, user_id) VALUES (?, ?, ?, ?)',
  )
    .bind(id, `hill-${slug}`, versionId, user)
    .run()
  return { kind: 'hill', hill: slug, submissionId: id, botVersionId: versionId }
}

/** Runs the job's alarms until none is set; the count. */
async function drain(runner: DurableObjectStub<Runner>): Promise<number> {
  let alarms = 0
  while (await runDurableObjectAlarm(runner)) {
    alarms++
    if (alarms > 200) throw new Error('the job does not end')
  }
  return alarms
}

const BOTS = new Map<string, LoadedBot>()

/** The seeded hill, played again here: the defenders take it in order. */
function seededHill(): HillState {
  let state = createHill({ size: 3, rounds: ROUNDS, battle: { ...CONFIG, seed: SEED_MATCH_SEED } })
  for (const { slug } of DEFENDERS) {
    const id = `roster-${slug}-v1`
    state = hill(
      state,
      { id, bot: BOTS.get(id) as LoadedBot },
      (e) => BOTS.get(e.id) as LoadedBot,
    ).state
  }
  return state
}

/** What `hill` makes of `state` when `id` challenges it. */
function challenge(state: HillState, id: string): HillResult {
  return hill(state, { id, bot: BOTS.get(id) as LoadedBot }, (e) => BOTS.get(e.id) as LoadedBot)
}

/** Hill `slug`'s board in D1, king first. */
async function board(slug: string) {
  const entries = await listHillEntries(env.DB, `hill-${slug}`)
  return entries.map((e) => [e.botVersionId, e.rank, e.score, e.wins, e.ties, e.losses, e.age])
}

function expectedBoard(result: HillResult) {
  return result.board.map(({ rank, entry: e }) => [
    e.id,
    rank,
    e.points,
    e.wins,
    e.ties,
    e.losses,
    e.age,
  ])
}

/** The D1 rows of a job's matches, by id. */
async function jobMatches(prefix: string) {
  const { results } = await env.DB.prepare('SELECT * FROM matches WHERE id LIKE ? ORDER BY id')
    .bind(`${prefix}-%`)
    .all<{ id: string; participants_json: string; result_json: string; replay_key: string }>()
  return results
}

function room(ref: Parameters<typeof liveRoomName>[0]) {
  return env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(liveRoomName(ref)))
}

function submissionRow(id: string) {
  return env.DB.prepare('SELECT status, score, rank FROM hill_submissions WHERE id = ?')
    .bind(id)
    .first()
}

/** The `runner.match` log lines `console.log` got: which match, and whether it was read back. */
function matchLogs(spy: { mock: { calls: unknown[][] } }): { match: string; reused: boolean }[] {
  return spy.mock.calls.flatMap(([line]) => {
    if (typeof line !== 'string' || !line.startsWith('{')) return []
    const entry = JSON.parse(line) as { msg: string; match: string; reused: boolean }
    return entry.msg === 'runner.match' ? [{ match: entry.match, reused: entry.reused }] : []
  })
}

beforeAll(async () => {
  await applySeed(env, await buildSeed(DEFENDERS, { hills: HILLS }))
  await env.DB.prepare(
    "INSERT INTO users (id, handle) VALUES ('u1', 'tester'), ('u2', 'rival')",
  ).run()
  for (const { slug, source } of DEFENDERS) BOTS.set(`roster-${slug}-v1`, loaded(source))
  BOTS.set('imp-v1', await addBot('imp', IMP))
  BOTS.set('imp2-v1', await addBot('imp2', IMP))
  BOTS.set('loop-v1', await addBot('loop', LOOP))
  BOTS.set('pad-v1', await addBot('pad', PAD))
  BOTS.set('pad2-v1', await addBot('pad2', PAD2))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a hill job', () => {
  it('fights 3 entries, one match an alarm, and writes the new board', async () => {
    const job = await submit('s-alpha', 'alpha', 'imp-v1')
    const runner = runnerOf(env, job)
    expect(await runner.start(job)).toMatchObject({ job: 'hill:alpha:s-alpha', done: 0, of: 3 })
    expect(await submissionRow('s-alpha')).toMatchObject({ status: 'running' })

    const alarms = await drain(runner)
    expect(alarms).toBeGreaterThanOrEqual(3)
    const expected = challenge(seededHill(), 'imp-v1')
    const status = await runner.status()
    expect(status).toEqual({
      job: 'hill:alpha:s-alpha',
      status: 'finished',
      done: 3,
      of: 3,
      alarms,
      error: null,
      outcome: {
        accepted: expected.accepted,
        rank: expected.rank,
        score: expected.challenger.points,
        needed: expected.accepted ? null : (expected.field.at(-2)?.points ?? null),
        evicted: expected.evicted?.id ?? null,
      },
      next: null,
    })
    expect(await board('alpha')).toEqual(expectedBoard(expected))
    expect(await submissionRow('s-alpha')).toEqual({
      status: 'finished',
      score: expected.challenger.points,
      rank: expected.rank,
    })

    // One row per match, each with its replay in R2, in the order the entries stood.
    const rows = await jobMatches('s-alpha')
    expect(rows.map((r) => JSON.parse(r.participants_json))).toEqual(
      seededHill().entries.map((e) => ['imp-v1', e.id]),
    )
    for (const row of rows) {
      const outcome = JSON.parse(row.result_json) as MatchOutcome
      const played = expected.matches.find((m) => m.points.join() === outcome.points.join())
      expect(played).toBeDefined()
      const object = await env.REPLAYS.get(replayObjectKey(row.replay_key))
      const replay = parseReplay(await object?.json())
      expect(replay.result.points).toEqual(outcome.points)
      expect(replay.bots.map((b) => b.name)).toEqual(
        JSON.parse(row.participants_json).map((id: string) => BOTS.get(id)?.name),
      )
    }

    // The room heard each match start and finish, then the board.
    const heard = await room({ kind: 'hill', id: 'hill-alpha' }).recent()
    expect(heard.map((m) => m.type)).toEqual([
      'progress',
      'matchStarted',
      'matchFinished',
      'progress',
      'matchStarted',
      'matchFinished',
      'progress',
      'matchStarted',
      'matchFinished',
      'standings',
      'progress',
    ])
    expect(heard.at(-1)).toEqual({
      type: 'progress',
      job: 'hill:alpha:s-alpha',
      status: 'finished',
      done: 3,
      of: 3,
    })
    const standings = heard.find((m) => m.type === 'standings') as Extract<
      LiveMessage,
      { type: 'standings' }
    >
    expect(standings.entries.map((e) => [e.botVersionId, e.rank])).toEqual(
      expected.board.map((r) => [r.entry.id, r.rank]),
    )

    // Starting it again answers its status: nothing runs twice.
    expect(await runner.start(job)).toMatchObject({ status: 'finished', done: 3 })
    expect(await runDurableObjectAlarm(runner)).toBe(false)
  })

  it("tells a spectator each match as it runs, and each match's inputs play to its result", async () => {
    const watcher = await spectate('hill:hill-theta')
    await watcher.until(2)
    const job = await submit('s-theta', 'theta', 'loop-v1')
    const runner = runnerOf(env, job)
    await runner.start(job)
    await drain(runner)

    // The socket heard what the room kept, as it happened.
    const kept = await room({ kind: 'hill', id: 'hill-theta' }).recent()
    const events = () => watcher.heard.filter((m) => m.type !== 'hello' && m.type !== 'spectators')
    await vi.waitFor(() => expect(events()).toEqual(kept))
    expect(kept.at(-1)).toMatchObject({ type: 'progress', status: 'finished', done: 3 })

    // A spectator runs each match from its `matchStarted` and gets the `matchFinished` hashes.
    const started = watcher.of('matchStarted')
    const finished = watcher.of('matchFinished')
    // Match ids end in the defender's bot index: the challenger is bot 0.
    expect(started.map((m) => m.match.id)).toEqual(['s-theta-1', 's-theta-2', 's-theta-3'])
    expect(finished.map((m) => m.match.id)).toEqual(started.map((m) => m.match.id))
    for (const [i, { job: name, match }] of started.entries()) {
      const done = finished[i]?.match
      expect(name).toBe('hill:theta:s-theta')
      expect(finished[i]?.job).toBe(name)
      expect(match.participants).toEqual(done?.participants)
      for (const bot of match.bots) expect(await sha256Hex(fromBase64(bot.bytes))).toBe(bot.sha256)
      const fight = match.bots.map((b) => ({ name: b.name, bytes: fromBase64(b.bytes) }))
      const again = runMatch(fight, { ...match.config, seed: match.seed }, match.rounds)
      expect(again.key).toBe(match.key)
      expect(done?.result?.rounds?.map((r) => r.resultHash)).toEqual(
        again.rounds.map((r) => r.resultHash),
      )
      expect(done?.result?.resultHash).toBe(matchResultHash(again.rounds))
    }
    watcher.ws.close(1000)
  })

  it('resumes when cut off after storing a match, and plays no match twice', async () => {
    const job = await submit('s-beta', 'beta', 'pad-v1')
    const runner = runnerOf(env, job)
    await runner.start(job)
    expect(await runDurableObjectAlarm(runner)).toBe(true)
    // Killed between two alarms: the next one picks up from storage.
    await evictDurableObject(runner)
    const before = await runInDurableObject(runner, (_, state) =>
      state.storage.get<JobState>('job'),
    )
    expect(before).toMatchObject({ played: [{ id: expect.any(Number) }] })
    const logs = vi.spyOn(console, 'log')
    expect(await runDurableObjectAlarm(runner)).toBe(true)
    // Killed after the second match reached R2 and D1, before the runner kept it.
    await runInDurableObject(runner, (_, state) => state.storage.put('job', before))
    await evictDurableObject(runner)
    await drain(runner)

    expect(await runner.status()).toMatchObject({ status: 'finished', done: 3, of: 3 })
    const rows = await jobMatches('s-beta')
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.participants_json)).size).toBe(3)
    // The second match was read back from D1, not played again.
    const played = matchLogs(logs)
    const second = played[0]?.match
    expect(played.filter((line) => line.match === second).map((line) => line.reused)).toEqual([
      false,
      true,
    ])
    expect(await board('beta')).toEqual(expectedBoard(challenge(seededHill(), 'pad-v1')))
  })

  it('fights an entry that came onto the hill while it ran, then writes over the new board', async () => {
    const first = await submit('s-gamma-1', 'gamma', 'imp-v1')
    // Another user: one user has one submission running on a hill at a time.
    const second = await submit('s-gamma-2', 'gamma', 'loop-v1', 'u2')
    const a = runnerOf(env, first)
    const b = runnerOf(env, second)
    await a.start(first)
    await b.start(second)
    // Both play their 3 matches; the first settles, and the second finds the board changed.
    for (let i = 0; i < 3; i++) {
      expect(await runDurableObjectAlarm(a)).toBe(true)
      expect(await runDurableObjectAlarm(b)).toBe(true)
    }
    await drain(a)
    const afterFirst = challenge(seededHill(), 'imp-v1')
    expect(await board('gamma')).toEqual(expectedBoard(afterFirst))
    await drain(b)

    const afterSecond = challenge(afterFirst.state, 'loop-v1')
    expect(await board('gamma')).toEqual(expectedBoard(afterSecond))
    const newcomers = afterFirst.accepted ? 1 : 0
    expect(await b.status()).toMatchObject({
      status: 'finished',
      done: 3 + newcomers,
      of: 3 + newcomers,
      outcome: { accepted: afterSecond.accepted, rank: afterSecond.rank },
    })
    const revision = await env.DB.prepare(
      "SELECT revision FROM hills WHERE id = 'hill-gamma'",
    ).first<{ revision: number }>()
    expect(revision).toEqual({ revision: 2 })
  })

  it('plays a match too long for one alarm a few rounds an alarm, to the same result', async () => {
    const points = vi.spyOn(env.MATCH_ANALYTICS as AnalyticsEngineDataset, 'writeDataPoint')
    const job = await submit('s-eps', 'eps', 'pad2-v1')
    const runner = runnerOf(env, job)
    await runner.start(job)
    // A budget of one round an alarm: 2 bots × 20,000 cycles.
    await runInDurableObject(runner, async (_, state) => {
      const stored = (await state.storage.get<JobState>('job')) as JobState
      await state.storage.put('job', { ...stored, budget: 2 * CONFIG.maxCycles })
    })
    expect(await runDurableObjectAlarm(runner)).toBe(true)
    const partial = await runInDurableObject(runner, (_, state) =>
      state.storage.get<JobState>('job'),
    )
    expect(partial?.partial?.rounds).toHaveLength(1)
    expect(partial?.played).toEqual([])
    const alarms = 1 + (await drain(runner))
    expect(alarms).toBe(3 * ROUNDS)

    const expected = challenge(seededHill(), 'pad2-v1')
    expect(await board('eps')).toEqual(expectedBoard(expected))
    const rows = await jobMatches('s-eps')
    for (const row of rows) {
      const [a, b] = JSON.parse(row.participants_json) as [string, string]
      const whole = runMatch(
        [BOTS.get(a) as LoadedBot, BOTS.get(b) as LoadedBot],
        { ...CONFIG, seed: SEED_MATCH_SEED },
        ROUNDS,
      )
      expect((JSON.parse(row.result_json) as MatchOutcome).rounds).toEqual(whole.rounds)
    }

    // Analytics Engine: one data point a match, however many alarms it took, with all its rounds.
    expect(points.mock.calls.map(([point]) => point)).toEqual(
      rows.map((row) => ({
        indexes: ['hill'],
        blobs: ['hill', 'played', 'hill:eps:s-eps', row.id],
        doubles: [
          1,
          expect.any(Number),
          2,
          ROUNDS,
          ((JSON.parse(row.result_json) as MatchOutcome).rounds ?? []).reduce(
            (sum, round) => sum + round.durationCycles,
            0,
          ),
        ],
      })),
    )
  })

  it('reads back a match another job played, and a copy of an entry replaces it', async () => {
    const first = await submit('s-zeta-1', 'zeta', 'imp-v1')
    await runnerOf(env, first).start(first)
    await drain(runnerOf(env, first))
    const logs = vi.spyOn(console, 'log')
    const points = vi.spyOn(env.MATCH_ANALYTICS as AnalyticsEngineDataset, 'writeDataPoint')
    // Same name, same bytes, another version: every match is one the first job played.
    const second = await submit('s-zeta-2', 'zeta', 'imp2-v1')
    const runner = runnerOf(env, second)
    await runner.start(second)
    await drain(runner)

    const played = matchLogs(logs)
    expect(played.length).toBeGreaterThan(0)
    expect(played.every((line) => line.reused)).toBe(true)
    // Its data points say so: nothing played.
    expect(points.mock.calls.map(([point]) => point?.blobs?.[1])).toEqual(
      played.map(() => 'reused'),
    )
    const keys = async (prefix: string) =>
      (await jobMatches(prefix)).map((r) => r.replay_key).sort()
    const firstKeys = await keys('s-zeta-1')
    for (const key of await keys('s-zeta-2')) expect(firstKeys).toContain(key)

    const afterFirst = challenge(seededHill(), 'imp-v1')
    const expected = challenge(afterFirst.state, 'imp2-v1')
    expect(await board('zeta')).toEqual(expectedBoard(expected))
    if (afterFirst.accepted) expect(expected.replaced?.id).toBe('imp-v1')
  })

  it('stops at cancel, and leaves the board as it was', async () => {
    const job = await submit('s-delta', 'delta', 'imp-v1')
    const runner = runnerOf(env, job)
    const before = await board('delta')
    await runner.start(job)
    expect(await runDurableObjectAlarm(runner)).toBe(true)
    expect(await runner.cancel()).toMatchObject({ status: 'cancelled', done: 1, of: 3 })
    expect(await runDurableObjectAlarm(runner)).toBe(false)
    expect(await runner.cancel()).toMatchObject({ status: 'cancelled' })
    expect(await board('delta')).toEqual(before)
    expect(await submissionRow('s-delta')).toMatchObject({ status: 'cancelled' })
    const heard = await room({ kind: 'hill', id: 'hill-delta' }).recent()
    expect(heard.at(-1)).toMatchObject({ type: 'progress', status: 'cancelled', done: 1 })
  })

  it('refuses a job it cannot run, and marks its submission failed', async () => {
    /** Why `job` does not start; the runner keeps nothing of it. */
    const refused = async (job: RunnerJob) => {
      const runner = runnerOf(env, job)
      const why = await runner.start(job).then(
        () => 'started',
        (error: Error) => error.message,
      )
      expect(await runner.status()).toBeNull()
      return why
    }
    const crowd = await submit('s-crowd', 'crowd', 'loop-v1')
    expect(await refused(crowd)).toMatch(/the crowd hill scores melees/)
    expect(await submissionRow('s-crowd')).toMatchObject({ status: 'failed' })
    const standing = await submit('s-eta-on', 'eta', 'roster-spin-v1')
    expect(await refused(standing)).toMatch(/roster-spin-v1 is on the eta hill already/)
    expect(await submissionRow('s-eta-on')).toMatchObject({ status: 'failed' })
    // A submission that has ended does not start again.
    expect(await refused(standing)).toMatch(/submission s-eta-on is failed/)
    const nobody: HillJob = {
      kind: 'hill',
      hill: 'eta',
      submissionId: 's-none',
      botVersionId: 'imp-v1',
    }
    expect(await refused(nobody)).toMatch(/no submission s-none/)
    const elsewhere = await submit('s-eta', 'alpha', 'loop-v1')
    expect(await refused({ ...elsewhere, hill: 'eta' })).toMatch(
      /submission s-eta is not bot version loop-v1 on the eta hill/,
    )
    expect(await refused({ ...nobody, hill: 'nowhere' })).toMatch(/no hill nowhere/)
    expect(await refused({ ...nobody, kind: 'melee' } as never)).toMatch(/kind is not well formed/)
  })
})

describe('writeBoard', () => {
  it('writes over the revision it read, and nothing over a stale one', async () => {
    const entries = seededHill().entries
    const read = await env.DB.prepare(
      "SELECT id, revision FROM hills WHERE id = 'hill-eta'",
    ).first<{ id: string; revision: number }>()
    expect(read).toEqual({ id: 'hill-eta', revision: 0 })
    const flipped = [...entries].reverse()
    expect(await writeBoard(env.DB, { id: 'hill-eta', revision: 0 }, flipped)).toBe(true)
    expect((await board('eta')).map(([id, rank]) => [id, rank])).toEqual(
      flipped.map((e, i) => [e.id, i + 1]),
    )
    expect(await writeBoard(env.DB, { id: 'hill-eta', revision: 0 }, entries)).toBe(false)
    expect((await board('eta')).map(([id]) => id)).toEqual(flipped.map((e) => e.id))
    expect(await writeBoard(env.DB, { id: 'hill-eta', revision: 1 }, entries.slice(0, 2))).toBe(
      true,
    )
    expect((await board('eta')).map(([id]) => id)).toEqual(entries.slice(0, 2).map((e) => e.id))
  })
})

describe('a tournament job', () => {
  const entrants = ['roster-spin-v1', 'roster-dwarf-v1', 'imp-v1']
  const tournament = async (id: string, kind: 'roundrobin' | 'bracket' | 'melee') => {
    const config = { rounds: 2, seed: 7, battle: CONFIG }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id)
         VALUES (?, ?, ?, ?, 'scheduled', ?, 'u1')`,
      ).bind(id, id, id, kind, JSON.stringify(config)),
      ...entrants.map((v) =>
        env.DB.prepare(
          'INSERT INTO tournament_entries (tournament_id, bot_version_id) VALUES (?, ?)',
        ).bind(id, v),
      ),
    ])
    const job: TournamentJob = { kind: 'tournament', tournamentId: id }
    const runner = runnerOf(env, job)
    const started = await runner.start(job)
    const alarms = await drain(runner)
    const row = await env.DB.prepare('SELECT status, bracket_json FROM tournaments WHERE id = ?')
      .bind(id)
      .first<{ status: string; bracket_json: string | null }>()
    const heard = await room({ kind: 'tournament', id }).recent()
    return {
      started,
      alarms,
      status: await runner.status(),
      row,
      heard,
      matches: await jobMatches(id),
    }
  }

  it('plays a bracket to its champion, drawing each round from the last', async () => {
    const run = await tournament('t-bracket', 'bracket')
    // Seeds by name: Dwarf 1, Imp 2, Spin 3; Dwarf has the bye and meets the winner of 2 v 3.
    expect(run.started).toMatchObject({ status: 'running', of: 2 })
    expect(run.status).toMatchObject({ status: 'finished', done: 2, of: 2 })
    expect(run.alarms).toBe(2)
    expect(run.row?.status).toBe('finished')
    const bracket = JSON.parse(run.row?.bracket_json ?? 'null') as {
      final: number
      matches: { status: string; winner: number | null }[]
    }
    expect(bracket.matches[bracket.final]).toMatchObject({ status: 'done' })
    expect(run.matches).toHaveLength(2)
    const seeds = await env.DB.prepare(
      "SELECT bot_version_id, seed FROM tournament_entries WHERE tournament_id = 't-bracket' ORDER BY seed",
    ).all()
    expect(seeds.results).toEqual([
      { bot_version_id: 'roster-dwarf-v1', seed: 1 },
      { bot_version_id: 'imp-v1', seed: 2 },
      { bot_version_id: 'roster-spin-v1', seed: 3 },
    ])
    expect(run.heard.at(-2)).toMatchObject({ type: 'standings' })
    expect(run.heard.at(-1)).toMatchObject({ type: 'progress', status: 'finished', done: 2 })
  })

  it('plays a round robin, every pair once', async () => {
    const run = await tournament('t-rr', 'roundrobin')
    expect(run.status).toMatchObject({ status: 'finished', done: 3, of: 3 })
    expect(run.row?.status).toBe('finished')
    expect(run.matches.map((m) => JSON.parse(m.participants_json))).toEqual([
      ['roster-dwarf-v1', 'imp-v1'],
      ['roster-dwarf-v1', 'roster-spin-v1'],
      ['imp-v1', 'roster-spin-v1'],
    ])
    const standings = run.heard.filter((m) => m.type === 'standings').at(-1)
    expect(standings).toMatchObject({ entries: expect.arrayContaining([expect.anything()]) })
  })

  it('plays a melee as one match of everyone', async () => {
    const run = await tournament('t-melee', 'melee')
    expect(run.status).toMatchObject({ status: 'finished', done: 1, of: 1 })
    expect(run.matches).toHaveLength(1)
    const [match] = run.matches
    expect(JSON.parse(match?.participants_json ?? '[]')).toHaveLength(3)
    const outcome = JSON.parse(match?.result_json ?? '{}') as MatchOutcome
    const result: MatchResult = runMatch(
      ['roster-dwarf-v1', 'imp-v1', 'roster-spin-v1'].map((id) => BOTS.get(id) as LoadedBot),
      { ...CONFIG, seed: 7 },
      2,
    )
    expect(outcome.points).toEqual(result.points)
  })
})
