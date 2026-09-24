/**
 * Server tournaments (`POST /api/tournaments`, `.../enter`, `.../start`) and the weekly
 * championship (the cron, `GET /api/championships`): what a signed-in user may make, enter, and
 * start, an open tournament's deadline, a 5-bot bracket played to its champion by the `Runner`
 * (stepped by hand: `RUNNER_ALARM_DELAY_MS` is an hour in the tests), and the cron that starts
 * the championship due, seeded by rating, and makes next week's.
 */
import { createScheduledController, runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { assembleOrThrow } from '@asmbots/asm'
import type { LoadedBot } from '@asmbots/engine'
import {
  AuditList,
  ChampionshipList,
  CreatedTournament,
  type CreateTournament,
  parse,
  SavedBot,
  type Tournament,
  TournamentDetail,
  TournamentEntered,
  TournamentList,
  TournamentStarted,
  UserDetail,
} from '@asmbots/protocol'
import { type Bracket, bracket, champion } from '@asmbots/tourney'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  CHAMPIONSHIP_ROUNDS,
  CHAMPIONSHIP_RULES,
  championshipInsert,
  nextChampionshipStart,
  weeklyChampionship,
} from '../src/championship'
import { applySeed, buildSeed, SEED_HILLS, type SeedHill, sqlScript } from '../src/db/seed'
import { runnerOf } from '../src/do/runner'
import worker from '../src/index'
import { errorOf, me, send, signIn } from './fake-auth'
import { Jar } from './jar'

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
const LOOP = '%name "Loop"\nstart: nop\n        jmp start\n'
const IMP = `%name "Imp"
start:  call .here
.here:  pop bx
        sub bx, .here
        lea si, [bx+imp]
        lea di, [bx+imp+2]
imp:    movsw
        nop
`
const PAD = '%name "Pad"\nstart: nop\n        nop\n        jmp start\n'

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
/** A hill whose seed rates the defenders, for rating seeds. */
const HILLS: SeedHill[] = [
  {
    slug: 'ladder',
    name: 'ladder',
    description: '',
    size: 5,
    rounds: 3,
    config: CONFIG,
    scoring: 'duel',
  },
]

const HOUR = 60 * 60 * 1000
const loaded = (source: string): LoadedBot => {
  const out = assembleOrThrow(source)
  return { name: out.name, bytes: out.bytes }
}
const BOTS = new Map<string, LoadedBot>()

beforeAll(async () => {
  await applySeed(env, await buildSeed(DEFENDERS, { hills: HILLS }))
  for (const { slug, source } of DEFENDERS) BOTS.set(`roster-${slug}-v1`, loaded(source))
})

afterEach(() => {
  vi.useRealTimers()
})

/** A signed-in user `as`, with its own IP so no limit counts two users together. */
async function user(as: string): Promise<Jar> {
  const jar = new Jar()
  await signIn(jar, as)
  return jar
}

/** A bot of the jar's user; its version 1's id. */
async function botOf(jar: Jar, name: string, source: string, visibility = 'private') {
  const res = await send(jar, '/api/bots', { method: 'POST', body: { name, source, visibility } })
  expect(res.status).toBe(201)
  const { version } = parse(SavedBot, await res.json(), 'the bot')
  BOTS.set(version.id, { name, bytes: loaded(source).bytes })
  return version.id
}

type NewTournament = CreateTournament
const invite = (botVersionIds: string[], change: Partial<NewTournament> = {}): NewTournament => ({
  name: 'spring cup',
  kind: 'bracket',
  entrants: { entry: 'invite', botVersionIds },
  config: { rounds: 3, seed: 11, battle: CONFIG },
  ...change,
})
const open = (closesAt: string, change: Partial<NewTournament> = {}): NewTournament => ({
  ...invite([], change),
  entrants: { entry: 'open', closesAt },
  ...(change.entrants === undefined ? {} : { entrants: change.entrants }),
})

function post(jar: Jar, path: string, body: unknown = {}) {
  return send(jar, path, { method: 'POST', body })
}

/** Makes `body` and expects the 201: the tournament. */
async function made(jar: Jar, body: NewTournament): Promise<Tournament> {
  const res = await post(jar, '/api/tournaments', body)
  expect(res.status).toBe(201)
  return parse(CreatedTournament, await res.json(), 'the tournament').tournament
}

async function detail(id: string): Promise<TournamentDetail> {
  const res = await send(new Jar(), `/api/tournaments/${id}`)
  expect(res.status).toBe(200)
  return parse(TournamentDetail, await res.json(), 'the tournament')
}

async function drain(id: string): Promise<number> {
  const runner = runnerOf(env, { kind: 'tournament', tournamentId: id })
  let alarms = 0
  while (await runDurableObjectAlarm(runner)) {
    if (++alarms > 100) throw new Error('the job does not end')
  }
  return alarms
}

async function row(id: string) {
  return env.DB.prepare('SELECT * FROM tournaments WHERE id = ?')
    .bind(id)
    .first<{ status: string; starts_at: string | null; champion_id: string | null }>()
}

/** The seeds of tournament `id`, by bot version, 1 first. */
async function seeds(id: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT bot_version_id FROM tournament_entries WHERE tournament_id = ? ORDER BY seed',
  )
    .bind(id)
    .all<{ bot_version_id: string }>()
  return results.map((r) => r.bot_version_id)
}

/** The champion's bot version of a bracket of `ids` in that order, played here. */
function oracle(ids: string[], seed: number, rounds: number, battle = CONFIG): string {
  const played: Bracket = bracket(
    ids.map((id) => BOTS.get(id) as LoadedBot),
    { ...battle, seed },
    { seeding: 'given', thirdPlace: true, rounds },
  )
  return ids[champion(played) as number] as string
}

describe('POST /api/tournaments', () => {
  it('makes an invite tournament, its entries seeded in the list order, and its audit row', async () => {
    const owner = await user('maker')
    const loop = await botOf(owner, 'Loop', LOOP)
    const listed = ['roster-dwarf-v1', loop, 'roster-spin-v1']
    const t = await made(owner, invite(listed))
    expect(t).toMatchObject({
      name: 'spring cup',
      kind: 'bracket',
      status: 'scheduled',
      entry: 'invite',
      entryClosesAt: null,
      ownerId: (await me(owner)).user.id,
      startsAt: null,
      championId: null,
      finishedAt: null,
    })
    expect(t.slug).toMatch(/^spring-cup-[0-9a-f]{8}$/)
    expect((await detail(t.id)).entrants.map((e) => e.versionId)).toEqual(listed)
    const audit = parse(AuditList, await (await send(owner, '/api/me/audit')).json(), 'it')
    expect(audit.entries[0]).toMatchObject({ action: 'tournament.create', target: t.id })
  })

  it('refuses a tournament it would not run, and makes none', async () => {
    const owner = await user('refused')
    const other = await user('other')
    const secret = await botOf(other, 'Secret', PAD)
    const unlisted = await botOf(other, 'Unlisted', IMP, 'unlisted')
    const mine = await botOf(owner, 'Loop', LOOP)
    const refusal = async (body: unknown) =>
      errorOf(await post(owner, '/api/tournaments', body)).then(({ status, message }) => [
        status,
        message,
      ])
    const dwarf = 'roster-dwarf-v1'
    const soon = new Date(Date.now() + HOUR).toISOString()
    expect(
      await errorOf(await post(new Jar(), '/api/tournaments', invite([dwarf, mine]))),
    ).toMatchObject({ status: 401 })
    expect(await refusal(invite([dwarf, dwarf]))).toEqual([
      400,
      `bot version ${dwarf} is named twice`,
    ])
    expect(await refusal(invite([dwarf, secret]))).toEqual([404, `no bot version ${secret}`])
    expect(await refusal(invite([dwarf, unlisted]))).toEqual([
      403,
      `bot version ${unlisted} is not yours, and not public`,
    ])
    const small = { rounds: 3, seed: 1, battle: { ...CONFIG, maxBotBytes: 8 } }
    expect(await refusal(invite([dwarf, mine], { config: small }))).toEqual([
      422,
      expect.stringMatching(/^Dwarf v1 is \d+ bytes, over 8$/),
    ])
    const config = (change: object) => ({ rounds: 3, seed: 1, battle: { ...CONFIG, ...change } })
    expect(await refusal(invite([dwarf, mine], { config: { ...config({}), rounds: 11 } }))).toEqual(
      [422, 'a tournament plays 10 rounds a match at most'],
    )
    expect(
      await refusal(invite([dwarf, mine], { config: config({ maxCycles: 300_000 }) })),
    ).toEqual([422, 'a tournament plays 200,000 cycles a round at most'])
    expect(await refusal(invite([dwarf, mine], { config: config({ coreSize: 4096 }) }))).toEqual([
      422,
      'the core is 65536 bytes in x16c v1, not 4096',
    ])
    const crowd = Array.from({ length: 17 }, (_, i) => `v${i}`)
    expect(await refusal(invite(crowd, { kind: 'melee' }))).toEqual([
      422,
      'a melee takes 16 bots at most',
    ])
    const past = new Date(Date.now() - 1000).toISOString()
    expect(await refusal(open(past))).toEqual([422, 'the entry deadline has passed'])
    const far = new Date(Date.now() + 31 * 24 * HOUR).toISOString()
    expect(await refusal(open(far))).toEqual([422, 'the entry deadline is 30 days away at most'])
    expect(await refusal(open('friday'))).toEqual([400, 'entrants.closesAt is not a time'])
    expect(await refusal({ ...open(soon), kind: 'swiss' })).toEqual([
      400,
      'kind is not well formed',
    ])
    const { n } = (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM tournaments WHERE owner_id = (SELECT id FROM users WHERE handle = 'refused')",
    ).first<{ n: number }>()) ?? { n: -1 }
    expect(n).toBe(0)
  })
})

describe('open entry', () => {
  it('takes one entry a user until the deadline, then closes', async () => {
    const owner = await user('host')
    const alice = await user('alice')
    const bob = await user('bob')
    const [a1, a2] = [await botOf(alice, 'Loop', LOOP), await botOf(alice, 'Imp', IMP)]
    const b1 = await botOf(bob, 'Pad', PAD)
    const closesAt = new Date(Date.now() + HOUR).toISOString()
    const t = await made(owner, open(closesAt))
    expect(t).toMatchObject({ entry: 'open', entryClosesAt: closesAt })
    const enter = (jar: Jar, botVersionId: string) =>
      post(jar, `/api/tournaments/${t.id}/enter`, { botVersionId })
    const entered = async (res: Response, status: number) => {
      expect(res.status).toBe(status)
      return parse(TournamentEntered, await res.json(), 'the entry')
    }
    expect(await entered(await enter(alice, a1), 201)).toEqual({
      tournamentId: t.id,
      botVersionId: a1,
      replaced: null,
    })
    // One entry a user: a second replaces the first, the same one changes nothing.
    expect((await entered(await enter(alice, a2), 200)).replaced).toBe(a1)
    expect((await entered(await enter(alice, a2), 200)).replaced).toBeNull()
    expect((await entered(await enter(bob, b1), 201)).replaced).toBeNull()
    expect(await errorOf(await enter(bob, a1))).toMatchObject({ status: 404 })
    expect((await detail(t.id)).entrants.map((e) => e.versionId).sort()).toEqual([a2, b1].sort())
    const audit = parse(AuditList, await (await send(alice, '/api/me/audit')).json(), 'it')
    expect(audit.entries.filter((e) => e.action === 'tournament.enter')).toHaveLength(2)

    // Its owner may not start it while it takes entries.
    const start = () => post(owner, `/api/tournaments/${t.id}/start`)
    expect(await errorOf(await start())).toEqual({
      status: 409,
      code: 'conflict',
      message: `spring cup takes entries until ${closesAt}: start it then`,
    })

    // A millisecond before the deadline it takes an entry; at the deadline it takes none.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(closesAt) - 1)
    expect((await entered(await enter(bob, await botOf(bob, 'Late', HALT)), 200)).replaced).toBe(b1)
    vi.setSystemTime(Date.parse(closesAt))
    expect(await errorOf(await enter(bob, b1))).toEqual({
      status: 409,
      code: 'conflict',
      message: `entry to spring cup closed at ${closesAt}`,
    })
    expect((await start()).status).toBe(200)
    expect(await errorOf(await enter(alice, a1))).toMatchObject({
      status: 409,
      message: 'spring cup is running: entry is closed',
    })
  })

  it('refuses entry to an invite tournament and to a full one', async () => {
    const owner = await user('crowded')
    const carol = await user('carol')
    const mine = await botOf(carol, 'Loop', LOOP)
    const invited = await made(owner, invite(['roster-dwarf-v1', 'roster-spin-v1']))
    expect(
      await errorOf(
        await post(carol, `/api/tournaments/${invited.id}/enter`, { botVersionId: mine }),
      ),
    ).toMatchObject({
      status: 409,
      message: 'spring cup takes the bots its owner invited, no entries',
    })
    // A melee holds 16: fill one with 16 versions of a filler's bots.
    const soon = new Date(Date.now() + HOUR).toISOString()
    const melee = await made(owner, open(soon, { kind: 'melee' }))
    await env.DB.prepare("INSERT INTO users (id, handle) VALUES ('filler', 'filler')").run()
    await env.DB.batch(
      Array.from({ length: 16 }, (_, i) => [
        env.DB.prepare(
          "INSERT INTO bots (id, owner_id, slug, name) VALUES (?1, 'filler', ?1, ?1)",
        ).bind(`fill${i}`),
        env.DB.prepare(
          `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
           VALUES (?1 || '-v1', ?1, 1, 'nop', ?2, 1, 'x16c-v1')`,
        ).bind(`fill${i}`, 'ab'.repeat(32)),
        env.DB.prepare(
          `INSERT INTO tournament_entries (tournament_id, bot_version_id, user_id, entered_at)
           VALUES (?, ?, NULL, ?)`,
        ).bind(melee.id, `fill${i}-v1`, soon),
      ]).flat(),
    )
    expect(
      await errorOf(
        await post(carol, `/api/tournaments/${melee.id}/enter`, { botVersionId: mine }),
      ),
    ).toMatchObject({ status: 409, message: 'spring cup is full: it takes 16 bots' })
  })
})

describe('POST /api/tournaments/:id/start', () => {
  it('is its owner’s, for a tournament of 2 bots or more, once', async () => {
    const owner = await user('starter')
    const stranger = await user('stranger')
    const mine = await botOf(owner, 'Loop', LOOP)
    const t = await made(owner, invite(['roster-halt-v1', mine], { kind: 'roundrobin' }))
    const start = (jar: Jar, id = t.id) => post(jar, `/api/tournaments/${id}/start`)
    expect(await errorOf(await start(stranger))).toMatchObject({
      status: 403,
      message: 'spring cup is not yours',
    })
    const empty = await made(owner, open(new Date(Date.now() + HOUR).toISOString()))
    await env.DB.prepare('UPDATE tournaments SET entry_closes_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), empty.id)
      .run()
    expect(await errorOf(await start(owner, empty.id))).toMatchObject({
      status: 409,
      message: 'spring cup has 0 bots: it needs 2 to start',
    })
    const res = await start(owner)
    expect(res.status).toBe(200)
    expect(parse(TournamentStarted, await res.json(), 'the start')).toEqual({
      tournamentId: t.id,
      liveRoom: `tournament:${t.id}`,
    })
    expect(await row(t.id)).toMatchObject({ status: 'running', starts_at: expect.any(String) })
    expect(await errorOf(await start(owner))).toMatchObject({
      status: 409,
      message: 'spring cup is running',
    })
    await drain(t.id)
    // Halt dies on its first instruction: the loop tops the round robin's standings.
    expect(await row(t.id)).toMatchObject({ status: 'finished', champion_id: mine })
  })

  it('plays a bracket of 5 to its champion through the Runner', async () => {
    const owner = await user('bracketeer')
    const loop = await botOf(owner, 'Loop', LOOP)
    const imp = await botOf(owner, 'Imp', IMP)
    const listed = ['roster-dwarf-v1', imp, 'roster-spin-v1', loop, 'roster-halt-v1']
    const t = await made(
      owner,
      invite(listed, { config: { rounds: 3, seed: 11, battle: CONFIG, thirdPlace: true } }),
    )
    expect((await post(owner, `/api/tournaments/${t.id}/start`)).status).toBe(200)
    // One match an alarm, a final and a third-place match among them, then the end.
    expect(await drain(t.id)).toBe(5)
    const expected = oracle(listed, 11, 3)
    const done = await detail(t.id)
    expect(done.tournament).toMatchObject({
      status: 'finished',
      championId: expected,
      finishedAt: expect.any(String),
    })
    expect(done.entrants.map((e) => e.versionId)).toEqual(listed)
    expect(await seeds(t.id)).toEqual(listed)
    expect(done.matches).toHaveLength(5)
    expect(done.matches.every((m) => m.key !== null && m.result !== null)).toBe(true)
    const final = done.tournament.bracket as Bracket
    expect(final.matches[final.final]).toMatchObject({ status: 'done' })
    expect(final.thirdPlace).not.toBeNull()
    expect(listed[champion(final) as number]).toBe(expected)
    const list = parse(
      TournamentList,
      await (await send(new Jar(), '/api/tournaments')).json(),
      'it',
    )
    expect(list.tournaments.find((s) => s.tournament.id === t.id)).toMatchObject({
      entrants: 5,
      done: 5,
      of: 5,
      champion: { versionId: expected },
    })
    // A user's tournament is not a championship.
    const feed = parse(
      ChampionshipList,
      await (await send(new Jar(), '/api/championships')).json(),
      'it',
    )
    expect(feed.championships.map((s) => s.tournament.id)).not.toContain(t.id)
  })
})

describe('a deleted account', () => {
  it('leaves the tournaments not started, and passes to `deleted` in the others', async () => {
    const host = await user('host2')
    const quitter = await user('quitter')
    const soon = new Date(Date.now() + HOUR).toISOString()
    const waiting = await made(host, open(soon))
    const played = await made(host, open(soon, { kind: 'roundrobin' }))
    const idle = await botOf(quitter, 'Idle', PAD)
    const fought = await botOf(quitter, 'Fought', LOOP)
    const theirs = await made(quitter, invite([idle, 'roster-dwarf-v1']))
    const enter = (jar: Jar, id: string, botVersionId: string) =>
      post(jar, `/api/tournaments/${id}/enter`, { botVersionId })
    expect((await enter(quitter, waiting.id, idle)).status).toBe(201)
    expect((await enter(quitter, played.id, fought)).status).toBe(201)
    expect((await enter(host, played.id, await botOf(host, 'Halt', HALT))).status).toBe(201)
    await env.DB.prepare('UPDATE tournaments SET entry_closes_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), played.id)
      .run()
    expect((await post(host, `/api/tournaments/${played.id}/start`)).status).toBe(200)
    await drain(played.id)

    expect((await send(quitter, '/api/me', { method: 'DELETE' })).status).toBe(204)
    // Not started: their tournament goes, and so do their entries; their idle bot goes whole.
    expect((await send(new Jar(), `/api/tournaments/${theirs.id}`)).status).toBe(404)
    expect((await detail(waiting.id)).entrants).toEqual([])
    expect(
      await env.DB.prepare('SELECT 1 FROM bot_versions WHERE id = ?').bind(idle).first(),
    ).toBeNull()
    // Played: the entry stays, the deleted user's, and its bot stays, named `[deleted]`.
    const entry = await env.DB.prepare(
      'SELECT user_id FROM tournament_entries WHERE tournament_id = ? AND bot_version_id = ?',
    )
      .bind(played.id, fought)
      .first<{ user_id: string }>()
    expect(entry?.user_id).toBe('deleted')
    expect((await detail(played.id)).entrants.map((e) => e.name)).toContain('[deleted]')
  })
})

describe('the cron', () => {
  const saturday = Date.parse('2026-09-26T18:00:00.000Z')
  const week = 7 * 24 * HOUR
  const cron = async (at: number) => {
    const controller = createScheduledController({ scheduledTime: at, cron: '0 18 * * 6' })
    await worker.scheduled(controller, env)
  }
  const championships = async () => {
    const { results } = await env.DB.prepare(
      'SELECT id, status, starts_at, entry_closes_at FROM tournaments WHERE owner_id IS NULL ORDER BY starts_at',
    ).all<{ id: string; status: string; starts_at: string; entry_closes_at: string }>()
    return results
  }

  it('makes next week’s championship, open six days, and only once', async () => {
    expect(nextChampionshipStart(new Date(saturday)).toISOString()).toBe('2026-10-03T18:00:00.000Z')
    expect(nextChampionshipStart(new Date(saturday - 1)).toISOString()).toBe(
      '2026-09-26T18:00:00.000Z',
    )
    await cron(saturday)
    await cron(saturday)
    await cron(saturday + 15 * HOUR)
    expect(await championships()).toEqual([
      {
        id: 'weekly-2026-10-03',
        status: 'scheduled',
        starts_at: '2026-10-03T18:00:00.000Z',
        entry_closes_at: '2026-10-02T18:00:00.000Z',
      },
    ])
    const t = (await detail('weekly-2026-10-03')).tournament
    expect(t).toMatchObject({
      name: 'weekly 2026-10-03',
      kind: 'bracket',
      entry: 'open',
      ownerId: null,
      config: {
        rounds: CHAMPIONSHIP_ROUNDS,
        seed: 20261003,
        battle: CHAMPIONSHIP_RULES,
        seeding: 'rating',
        thirdPlace: true,
      },
    })
    // Six days of entries: from the cron that made it to the day before it starts.
    expect(Date.parse(t.entryClosesAt as string) - saturday).toBe(6 * 24 * HOUR)
    // The main hill's rules.
    expect(CHAMPIONSHIP_RULES).toEqual(SEED_HILLS.find((h) => h.slug === 'main')?.config)
    expect(weeklyChampionship(new Date(saturday)).id).toBe('weekly-2026-09-26')
  })

  it('starts the championship due, seeded by rating, and its champion lands in the feed', async () => {
    // Five entrants, two rated above the rest: they get seeds 1 and 2.
    const entrants = ['roster-halt-v1', 'roster-spin-v1', 'roster-dwarf-v1']
    const dave = await user('dave')
    const erin = await user('erin')
    const loop = await botOf(dave, 'Loop', LOOP)
    const imp = await botOf(erin, 'Imp', IMP)
    entrants.push(loop, imp)
    await env.DB.batch([
      ...entrants.map((v, i) =>
        env.DB.prepare(
          `INSERT INTO tournament_entries (tournament_id, bot_version_id, entered_at)
           VALUES ('weekly-2026-10-03', ?, ?)`,
        ).bind(v, new Date(saturday + i * HOUR).toISOString()),
      ),
      env.DB.prepare(
        `INSERT INTO ratings (bot_version_id, hill_id, rating, rd, volatility) VALUES
         (?1, 'hill-ladder', 1900, 60, 0.06), (?2, 'hill-ladder', 1800, 60, 0.06)
         ON CONFLICT (bot_version_id, hill_id) DO UPDATE SET rating = excluded.rating`,
      ).bind(imp, loop),
    ])
    const rated = await env.DB.prepare(
      `SELECT v.id, (SELECT MAX(rating) FROM ratings r WHERE r.bot_version_id = v.id) AS rating
       FROM bot_versions v WHERE v.id IN (SELECT value FROM json_each(?))`,
    )
      .bind(JSON.stringify(entrants))
      .all<{ id: string; rating: number | null }>()
    const rating = new Map(rated.results.map((r) => [r.id, r.rating ?? 1500]))
    const bySeed = [...entrants].sort((a, b) => (rating.get(b) ?? 0) - (rating.get(a) ?? 0))
    expect(bySeed.slice(0, 2)).toEqual([imp, loop])

    await cron(saturday + week)
    const [due, next] = await championships()
    expect(due).toMatchObject({ id: 'weekly-2026-10-03', status: 'running' })
    expect(next).toMatchObject({ id: 'weekly-2026-10-10', status: 'scheduled' })
    expect(await seeds('weekly-2026-10-03')).toEqual(bySeed)

    await drain('weekly-2026-10-03')
    const expected = oracle(bySeed, 20261003, CHAMPIONSHIP_ROUNDS, CHAMPIONSHIP_RULES)
    expect((await row('weekly-2026-10-03'))?.champion_id).toBe(expected)
    const feed = parse(
      ChampionshipList,
      await (await send(new Jar(), '/api/championships')).json(),
      'it',
    )
    expect(feed.championships).toHaveLength(1)
    expect(feed.championships[0]).toMatchObject({
      tournament: { id: 'weekly-2026-10-03', status: 'finished' },
      entrants: 5,
      done: 5,
      of: 5,
      champion: { versionId: expected },
    })
    // The champion's owner's profile says so.
    const owner = expected === loop ? 'dave' : expected === imp ? 'erin' : 'system'
    const profile = parse(
      UserDetail,
      await (await send(new Jar(), `/api/users/${owner}`)).json(),
      'it',
    )
    expect(
      profile.championships.find(
        (r) => r.bot.versionId === expected && r.tournament.id === 'weekly-2026-10-03',
      ),
    ).toMatchObject({ champion: true })
  })

  it('cancels a championship due with fewer than 2 bots, and makes the next', async () => {
    await cron(saturday + 2 * week)
    const byId = new Map((await championships()).map((c) => [c.id, c.status]))
    expect(byId.get('weekly-2026-10-10')).toBe('cancelled')
    expect(byId.get('weekly-2026-10-17')).toBe('scheduled')
    // A user may not start a championship: the cron does.
    const jar = await user('eager')
    expect(
      await errorOf(await post(jar, '/api/tournaments/weekly-2026-10-17/start')),
    ).toMatchObject({
      status: 403,
      message: 'weekly 2026-10-17 is a championship: the cron starts it',
    })
  })

  it('makes the same championship from the seed script’s inlined statement', async () => {
    const first = weeklyChampionship(nextChampionshipStart(new Date('2027-01-01T00:00:00.000Z')))
    await env.DB.prepare(sqlScript([championshipInsert(first)])).run()
    const t = (await detail(first.id)).tournament
    expect(t).toMatchObject({
      id: 'weekly-2027-01-02',
      slug: 'weekly-2027-01-02',
      status: 'scheduled',
      entry: 'open',
      startsAt: '2027-01-02T18:00:00.000Z',
      entryClosesAt: '2027-01-01T18:00:00.000Z',
      config: first.config,
    })
  })
})
