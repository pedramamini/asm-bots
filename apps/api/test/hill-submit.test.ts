/**
 * Hill submissions end to end (`POST /api/hills/:slug/submit`, `GET .../submissions/:id`,
 * `GET .../history`): a signed-in user's bot version challenges a hill the launch seed built, its
 * `Runner` stepped by hand (`RUNNER_ALARM_DELAY_MS` is an hour in the tests), then the board, the
 * ratings (a Glicko-2 period per submission), and the history it leaves. And what the route
 * refuses: whose version, which hill, what size, what bytes, how many at a time and an hour.
 */
import { runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { assembleOrThrow } from '@asmbots/asm'
import type { LoadedBot } from '@asmbots/engine'
import {
  AuditList,
  HillDetail,
  HillHistory,
  HillSubmitted,
  type MatchOutcome,
  parse,
  SavedBot,
  SubmissionDetail,
} from '@asmbots/protocol'
import {
  createHill,
  DEFAULT_RATING,
  type HillState,
  hill,
  type Rating,
  rateMatches,
} from '@asmbots/tourney'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed, SEED_MATCH_SEED, type SeedHill } from '../src/db/seed'
import { runnerOf } from '../src/do/runner'
import { botBytesKey } from '../src/storage'
import { errorOf, send, signIn } from './fake-auth'
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
/** Stays on a full hill of the three: pushes Halt off. */
const LOOP = '%name "Loop"\nstart: nop\n        jmp start\n'
/** Dies at once: a full hill of the three turns it away. */
const DUD = '%name "Dud"\nstart: hlt ; lint: allow hlt-in-code\n        nop\n'
const IMP = `%name "Imp"
start:  call .here
.here:  pop bx
        sub bx, .here
        lea si, [bx+imp]
        lea di, [bx+imp+2]
imp:    movsw
        nop
`

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

const duel = (slug: string, size: number, config = CONFIG): SeedHill => ({
  slug,
  name: slug,
  description: '',
  size,
  rounds: ROUNDS,
  config,
  scoring: 'duel',
})

/** A hill per case that changes one: full ones (size 3) turn a weak bot away. */
const HILLS: SeedHill[] = [
  duel('full', 3),
  duel('tight', 3),
  duel('open', 5),
  duel('rated', 5),
  duel('busy', 5),
  duel('other', 5),
  duel('broken', 5),
  duel('exit', 5),
  ...['q1', 'q2', 'q3'].map((slug) => duel(slug, 5)),
  duel('small', 5, { ...CONFIG, maxBotBytes: 4 }),
  { ...duel('crowd', 8), scoring: 'melee' },
]

const loaded = (source: string): LoadedBot => {
  const out = assembleOrThrow(source)
  return { name: out.name, bytes: out.bytes }
}
const BOTS = new Map<string, LoadedBot>()

beforeAll(async () => {
  await applySeed(env, await buildSeed(DEFENDERS, { hills: HILLS }))
  for (const { slug, source } of DEFENDERS) BOTS.set(`roster-${slug}-v1`, loaded(source))
})

/** A signed-in user `as`, with its own IP so no limit counts two users together. */
async function user(as: string): Promise<Jar> {
  const jar = new Jar()
  await signIn(jar, as)
  return jar
}

/** Makes a bot of `source` for the jar's user; its version 1, which the oracle can load. */
async function botOf(jar: Jar, name: string, source: string, visibility = 'private') {
  const res = await send(jar, '/api/bots', {
    method: 'POST',
    body: { name, source, visibility },
  })
  expect(res.status).toBe(201)
  const saved = parse(SavedBot, await res.json(), 'the bot')
  BOTS.set(saved.version.id, { name, bytes: loaded(source).bytes })
  return saved
}

function post(jar: Jar, slug: string, botVersionId: string) {
  return send(jar, `/api/hills/${slug}/submit`, { method: 'POST', body: { botVersionId } })
}

/** Submits and expects the 201: the submission id, and a stub of its runner. */
async function submitted(jar: Jar, slug: string, botVersionId: string) {
  const res = await post(jar, slug, botVersionId)
  expect(res.status).toBe(201)
  const body = parse(HillSubmitted, await res.json(), 'the answer')
  const runner = runnerOf(env, {
    kind: 'hill',
    hill: slug,
    submissionId: body.submissionId,
    botVersionId,
  })
  return { ...body, runner }
}

async function drain(runner: ReturnType<typeof runnerOf>): Promise<void> {
  for (let alarms = 0; await runDurableObjectAlarm(runner); alarms++) {
    if (alarms > 100) throw new Error('the job does not end')
  }
}

async function detail(slug: string, id: string) {
  const res = await send(new Jar(), `/api/hills/${slug}/submissions/${id}`)
  expect(res.status).toBe(200)
  return parse(SubmissionDetail, await res.json(), 'the submission')
}

async function standings(slug: string): Promise<HillDetail['standings']> {
  const res = await send(new Jar(), `/api/hills/${slug}`)
  return parse(HillDetail, await res.json(), 'the hill').standings
}

/** The seeded hill, played again here: the defenders take it in order. */
function seededHill(size: number): HillState {
  let state = createHill({ size, rounds: ROUNDS, battle: { ...CONFIG, seed: SEED_MATCH_SEED } })
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

function challenge(state: HillState, id: string) {
  return hill(state, { id, bot: BOTS.get(id) as LoadedBot }, (e) => BOTS.get(e.id) as LoadedBot)
}

/** Hill `slug`'s ratings in D1, by bot version. */
async function ratings(slug: string): Promise<Map<string, Rating>> {
  const { results } = await env.DB.prepare(
    'SELECT bot_version_id, rating, rd, volatility FROM ratings WHERE hill_id = ?',
  )
    .bind(`hill-${slug}`)
    .all<{ bot_version_id: string } & Rating>()
  return new Map(results.map(({ bot_version_id, ...r }) => [bot_version_id, r]))
}

/**
 * The rating period of submission `id` on hill `slug`, from its matches in D1: every player from
 * `before` (the default when it has none).
 */
async function period(
  slug: string,
  id: string,
  before: ReadonlyMap<string, Rating>,
): Promise<Map<string, Rating>> {
  const { matches, submission } = await detail(slug, id)
  const players = [submission.botVersionId, ...matches.map((m) => m.match.participants[1] ?? '')]
  const after = rateMatches(
    players.map((p) => before.get(p) ?? DEFAULT_RATING),
    matches.map((m, i) => ({
      entrants: [0, i + 1],
      result: { points: (m.match.result as MatchOutcome).points },
    })),
  )
  return new Map(players.map((p, i) => [p, after[i] as Rating]))
}

function expectRatings(actual: ReadonlyMap<string, Rating>, expected: ReadonlyMap<string, Rating>) {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort())
  for (const [id, r] of expected) {
    const got = actual.get(id) as Rating
    expect(got.rating).toBeCloseTo(r.rating, 9)
    expect(got.rd).toBeCloseTo(r.rd, 9)
    expect(got.volatility).toBeCloseTo(r.volatility, 9)
  }
}

describe('the launch seed', () => {
  it('rates each challenge it plays as a period, and stands each entry at its rating', async () => {
    // The seed's challenges again, each rated from where the last left its players.
    let state = createHill({
      size: 3,
      rounds: ROUNDS,
      battle: { ...CONFIG, seed: SEED_MATCH_SEED },
    })
    let expected = new Map<string, Rating>()
    for (const { slug } of DEFENDERS) {
      const id = `roster-${slug}-v1`
      const result = challenge(state, id)
      const players = [id, ...state.entries.map((e) => e.id)]
      const after = rateMatches(
        players.map((p) => expected.get(p) ?? DEFAULT_RATING),
        result.matches.map((m, i) => ({ entrants: [0, i + 1], result: m })),
      )
      expected = new Map([...expected, ...players.map((p, i) => [p, after[i] as Rating] as const)])
      state = result.state
    }
    const seeded = await ratings('full')
    expectRatings(seeded, expected)
    for (const s of await standings('full')) {
      expect(s.entry.rating).toBeCloseTo(expected.get(s.entry.botVersionId)?.rating ?? 0, 9)
      expect(s.rd).toBeCloseTo(expected.get(s.entry.botVersionId)?.rd ?? 0, 9)
    }
  })
})

describe('POST /api/hills/:slug/submit', () => {
  it('starts a job for my version, reports it match by match, and lands it on the board', async () => {
    const jar = await user('climber')
    const { version } = await botOf(jar, 'Loop', LOOP)
    // The seed rated its own challenges: the defenders start where those left them.
    const seeded = await ratings('full')
    expect([...seeded.keys()].sort()).toEqual(
      seededHill(3)
        .entries.map((e) => e.id)
        .sort(),
    )
    const { submissionId, liveRoom, runner } = await submitted(jar, 'full', version.id)
    expect(submissionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(liveRoom).toBe('hill:hill-full')

    // The audit row, in the same batch as the submission.
    const audit = parse(AuditList, await (await send(jar, '/api/me/audit')).json(), 'the audit')
    expect(audit.entries[0]).toMatchObject({ action: 'hill.submit', target: submissionId })

    // Started: running, nothing played, the king its first opponent.
    const board = seededHill(3).entries.map((e) => e.id)
    const started = await detail('full', submissionId)
    expect(started.submission).toMatchObject({ status: 'running', score: null, rank: null })
    expect(started.bot).toMatchObject({ versionId: version.id, name: 'Loop', owner: 'climber' })
    expect(started.progress).toMatchObject({ done: 0, of: 3 })
    expect(started.progress?.next?.map((b) => b?.versionId)).toEqual([version.id, board[0]])
    expect([started.matches, started.events]).toEqual([[], []])

    // One alarm, one match: its row, labeled, and the next opponent.
    expect(await runDurableObjectAlarm(runner)).toBe(true)
    const one = await detail('full', submissionId)
    expect(one.progress).toMatchObject({ done: 1, of: 3 })
    expect(one.progress?.next?.[1]?.versionId).toBe(board[1])
    expect(one.matches.map((m) => m.match.participants)).toEqual([[version.id, board[0]]])
    expect(one.matches[0]?.bots.map((b) => b?.name)).toEqual(['Loop', 'Dwarf'])

    await drain(runner)
    const expected = challenge(seededHill(3), version.id)
    expect(expected.accepted).toBe(true)
    const done = await detail('full', submissionId)
    expect(done.submission).toMatchObject({
      status: 'finished',
      score: expected.challenger.points,
      rank: expected.rank,
      needed: null,
    })
    expect(done.progress).toBeNull()
    expect(done.matches.map((m) => m.match.participants[1])).toEqual(board)
    // It entered; the lowest went, from its old place.
    expect(done.events.map(({ event, bot }) => [event.kind, bot?.name, event.rank])).toEqual([
      ['entered', 'Loop', expected.rank],
      ['evicted', 'Halt', 3],
    ])
    expect(done.events[0]?.event).toMatchObject({ score: expected.challenger.points, delta: null })
    expect(done.events[1]?.event.score).toBe(expected.evicted?.points)

    // The board: the oracle's, each entry that stayed a challenge older.
    const after = await standings('full')
    expect(
      after.map((s) => [s.entry.botVersionId, s.entry.rank, s.entry.score, s.entry.age]),
    ).toEqual(expected.board.map((r) => [r.entry.id, r.rank, r.entry.points, r.entry.age]))
    expect(after.find((s) => s.entry.botVersionId === 'roster-dwarf-v1')?.entry.age).toBe(
      (seededHill(3).entries.find((e) => e.id === 'roster-dwarf-v1')?.age ?? 0) + 1,
    )

    // The feed, newest first: the same two events.
    const res = await send(new Jar(), '/api/hills/full/history')
    const history = parse(HillHistory, await res.json(), 'the history')
    expect(history.events.map((e) => e.event.kind)).toEqual(['entered', 'evicted'])
    expect(history.events.every((e) => e.event.submissionId === submissionId)).toBe(true)

    // One rating period: the challenger (from the default) and the three it fought.
    const rated = await ratings('full')
    expectRatings(rated, await period('full', submissionId, seeded))
    for (const s of after) {
      const r = rated.get(s.entry.botVersionId) as Rating
      expect(s.entry.rating).toBeCloseTo(r.rating, 9)
      expect(s.rd).toBeCloseTo(r.rd, 9)
      expect(s.rd).toBeLessThan(DEFAULT_RATING.rd)
    }
  })

  it('turns away a bot below the lowest entry: rejected, with the score it had to beat', async () => {
    const jar = await user('hopeful')
    const { version } = await botOf(jar, 'Dud', DUD)
    const { submissionId, runner } = await submitted(jar, 'tight', version.id)
    await drain(runner)
    const expected = challenge(seededHill(3), version.id)
    expect(expected.accepted).toBe(false)
    const needed = expected.field.at(-2)?.points
    const done = await detail('tight', submissionId)
    expect(done.submission).toMatchObject({
      status: 'finished',
      score: expected.challenger.points,
      rank: null,
      needed,
    })
    expect(done.events.map(({ event }) => [event.kind, event.rank, event.score])).toEqual([
      ['rejected', null, expected.challenger.points],
    ])
    expect((await standings('tight')).map((s) => [s.entry.botVersionId, s.entry.age])).toEqual(
      expected.board.map((r) => [r.entry.id, r.entry.age]),
    )
    // Rated all the same: it played.
    expect((await ratings('tight')).has(version.id)).toBe(true)
  })

  it('rates each submission as a period of its own, from the ratings the last one left', async () => {
    const first = await user('rater-a')
    const second = await user('rater-b')
    const { version: loop } = await botOf(first, 'Loop', LOOP)
    const { version: imp } = await botOf(second, 'Imp', IMP)
    const seeded = await ratings('rated')
    const a = await submitted(first, 'rated', loop.id)
    await drain(a.runner)
    const afterA = await ratings('rated')
    expectRatings(afterA, await period('rated', a.submissionId, seeded))
    const b = await submitted(second, 'rated', imp.id)
    await drain(b.runner)
    // B fought the three seeded entries and Loop, each from where A's period left it.
    const expected = new Map([...afterA, ...(await period('rated', b.submissionId, afterA))])
    expectRatings(await ratings('rated'), expected)
    // Loop's bot had no place before; nor had Imp's.
    const { events } = await detail('rated', b.submissionId)
    expect(events[0]?.event).toMatchObject({ kind: 'entered', delta: null })
  })

  it('says how many places a new version of a bot gained over its best before', async () => {
    const jar = await user('improver')
    const { bot, version: v1 } = await botOf(jar, 'Loop', LOOP)
    const first = await submitted(jar, 'open', v1.id)
    await drain(first.runner)
    const old = (await detail('open', first.submissionId)).submission.rank as number
    // v2 of the same bot: an imp, which the oracle ranks against the board with v1 on it.
    const res = await send(jar, `/api/bots/${bot.id}/versions`, {
      method: 'POST',
      body: { source: IMP.replace('"Imp"', '"Loop"') },
    })
    expect(res.status).toBe(201)
    const v2 = (await res.json()) as { version: { id: string } }
    BOTS.set(v2.version.id, { name: 'Loop', bytes: loaded(IMP).bytes })
    const second = await submitted(jar, 'open', v2.version.id)
    await drain(second.runner)
    const { submission, events } = await detail('open', second.submissionId)
    expect(submission.rank).not.toBeNull()
    expect(events[0]?.event).toMatchObject({
      kind: 'entered',
      delta: old - (submission.rank as number),
    })
  })

  it('refuses a submission it cannot take, and says why', async () => {
    const jar = await user('refused')
    const stranger = await user('stranger')
    const { version: mine } = await botOf(jar, 'Loop', LOOP)
    const { version: big } = await botOf(jar, 'Big', DWARF)
    const { version: copy } = await botOf(jar, 'Copy', SPIN.replace('"Spin"', '"Copy"'))
    const { version: theirs } = await botOf(stranger, 'Theirs', LOOP, 'public')
    const { version: hidden } = await botOf(stranger, 'Hidden', LOOP)
    const refusal = async (res: Response) => {
      const { status, code, message } = await errorOf(res)
      return [status, code, message]
    }

    expect((await post(new Jar(), 'open', mine.id)).status).toBe(401)
    expect(await refusal(await post(jar, 'nowhere', mine.id))).toEqual([
      404,
      'not_found',
      'no hill nowhere',
    ])
    const bad = await send(jar, '/api/hills/open/submit', { method: 'POST', body: {} })
    expect(await refusal(bad)).toEqual([400, 'bad_request', 'botVersionId is missing'])
    expect(await refusal(await post(jar, 'open', 'no-such-version'))).toEqual([
      404,
      'not_found',
      'no bot version no-such-version',
    ])
    expect((await post(jar, 'open', hidden.id)).status).toBe(404)
    expect(await refusal(await post(jar, 'open', theirs.id))).toEqual([
      403,
      'forbidden',
      `bot version ${theirs.id} is not yours`,
    ])
    expect(await refusal(await post(jar, 'crowd', mine.id))).toEqual([
      409,
      'conflict',
      'the crowd hill scores melees, and takes no submissions yet',
    ])
    expect(await refusal(await post(jar, 'small', big.id))).toEqual([
      422,
      'unprocessable',
      `Big v1 is ${big.size} bytes, and the small hill takes 4`,
    ])
    // Spin's bytes under another name: it would take Spin's place and age.
    expect(await refusal(await post(jar, 'open', copy.id))).toEqual([
      409,
      'conflict',
      'the open hill has these bytes already, as Spin: change the code to challenge it',
    ])
    // None of them made a submission.
    const { n } = (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM hill_submissions WHERE user_id = (SELECT id FROM users WHERE handle = 'refused')",
    ).first<{ n: number }>()) as { n: number }
    expect(n).toBe(0)
  })

  it('refuses a version on the hill already', async () => {
    const jar = await user('repeater')
    const { version } = await botOf(jar, 'Loop', LOOP)
    const first = await submitted(jar, 'other', version.id)
    await drain(first.runner)
    expect((await detail('other', first.submissionId)).submission.rank).not.toBeNull()
    const again = await errorOf(await post(jar, 'other', version.id))
    expect(again).toMatchObject({
      status: 409,
      message: 'Loop v1 is on the other hill already',
    })
  })

  it('holds a user to one running submission a hill, and five submissions an hour', async () => {
    const jar = await user('eager')
    const { version: a } = await botOf(jar, 'Loop', LOOP)
    const { version: b } = await botOf(jar, 'Imp', IMP)
    const first = await submitted(jar, 'busy', a.id)
    const second = await post(jar, 'busy', b.id)
    expect(await errorOf(second)).toMatchObject({
      status: 409,
      message: `your submission ${first.submissionId} is still running on the busy hill: one at a time`,
    })
    // A refused one does not count against the five.
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('4')
    // Another hill is another queue.
    await submitted(jar, 'broken', b.id)
    // Once the first has ended, the hill takes the next.
    await drain(first.runner)
    const third = await post(jar, 'busy', b.id)
    expect([third.status, third.headers.get('X-RateLimit-Remaining')]).toEqual([201, '2'])
    await submitted(jar, 'q1', b.id)
    await submitted(jar, 'q2', b.id)
    // Five an hour: the sixth waits for the window.
    const sixth = await post(jar, 'q3', b.id)
    expect(await errorOf(sixth)).toMatchObject({ status: 429, code: 'rate_limited' })
    expect(Number(sixth.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Another user is counted apart.
    const other = await user('patient')
    const { version: c } = await botOf(other, 'Dud', DUD)
    expect((await post(other, 'q3', c.id)).status).toBe(201)
  })

  it('marks a job its runner refuses failed, and the hill takes the next', async () => {
    const jar = await user('unlucky')
    const { version: lost } = await botOf(jar, 'Lost', LOOP.replace('nop', 'nop\n        nop'))
    // The bytes the runner loads are gone from R2.
    await env.REPLAYS.delete(botBytesKey(lost.bytesSha256))
    const res = await post(jar, 'broken', lost.id)
    expect(await errorOf(res)).toMatchObject({
      status: 409,
      message: `the broken hill could not take it: the bytes of bot version ${lost.id} are missing`,
    })
    const row = await env.DB.prepare('SELECT status FROM hill_submissions WHERE bot_version_id = ?')
      .bind(lost.id)
      .first()
    expect(row).toEqual({ status: 'failed' })
    const { version: next } = await botOf(jar, 'Dud', DUD)
    expect((await post(jar, 'broken', next.id)).status).toBe(201)
  })
})

describe('GET /api/hills/:slug/submissions/:id', () => {
  it('is 404 for a submission of another hill, and for none', async () => {
    const jar = await user('lookup')
    const { version } = await botOf(jar, 'Dud', DUD)
    const { submissionId } = await submitted(jar, 'other', version.id)
    expect((await send(new Jar(), `/api/hills/open/submissions/${submissionId}`)).status).toBe(404)
    const none = await send(new Jar(), '/api/hills/other/submissions/nope')
    expect(await errorOf(none)).toMatchObject({
      status: 404,
      message: 'the other hill has no submission nope',
    })
    expect((await send(new Jar(), '/api/hills/nowhere/history')).status).toBe(404)
    expect((await send(new Jar(), '/api/hills/other/history?limit=0')).status).toBe(400)
  })

  it('shows how far a cancelled job got', async () => {
    const jar = await user('quitter')
    const { version } = await botOf(jar, 'Imp', IMP)
    const { submissionId, runner } = await submitted(jar, 'tight', version.id)
    expect(await runDurableObjectAlarm(runner)).toBe(true)
    await runner.cancel()
    const { submission, progress, matches } = await detail('tight', submissionId)
    expect(submission.status).toBe('cancelled')
    expect(progress).toEqual({ done: 1, of: 3, next: null })
    expect(matches).toHaveLength(1)
  })
})

describe('DELETE /api/me', () => {
  it('passes the running submissions of two accounts on one hill to deleted', async () => {
    const leave = async (as: string, source: string) => {
      const jar = await user(as)
      const { version: kept } = await botOf(jar, 'Loop', source)
      // A version of the bot stands on a hill, so the bot stays when the account goes.
      await env.DB.prepare(
        "INSERT INTO hill_entries (hill_id, bot_version_id, rank) VALUES ('hill-crowd', ?, 9)",
      )
        .bind(kept.id)
        .run()
      const { submissionId } = await submitted(jar, 'exit', kept.id)
      return { jar, submissionId }
    }
    const one = await leave('leaver-one', LOOP)
    const two = await leave('leaver-two', DUD)
    for (const { jar } of [one, two]) {
      expect((await send(jar, '/api/me', { method: 'DELETE' })).status).toBe(204)
    }
    const { results } = await env.DB.prepare(
      'SELECT user_id FROM hill_submissions WHERE id IN (?, ?)',
    )
      .bind(one.submissionId, two.submissionId)
      .all()
    expect(results).toEqual([{ user_id: 'deleted' }, { user_id: 'deleted' }])
  })
})
