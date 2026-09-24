/**
 * `GET /api/matches/:id/verify` (ARCHITECTURE §7, verification model): a published match's inputs
 * and its row. What a client does with them is done here too: the inputs, run with
 * `@asmbots/tourney`, give the key the row stores and each round's result hash, for a match the
 * launch seed stored (one hash, no rounds), a melee, and one a `Runner` played. And the 404s.
 */
import { runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import {
  bytesProblem,
  type HillJob,
  type MatchOutcome,
  MatchVerification,
  matchResultHash,
  parse,
  replayBots,
} from '@asmbots/protocol'
import { type MatchResult, runMatch } from '@asmbots/tourney'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed, type SeedHill } from '../src/db/seed'
import { runnerOf } from '../src/do/runner'
import { errorOf, send } from './fake-auth'
import { Jar } from './jar'

const SPIN = '%name "Spin"\n%author "ASM Bots"\nstart: jmp $\n'
const HALT = '%name "Halt"\n%author "ASM Bots"\nstart: hlt ; lint: allow hlt-in-code\n'
const LOOP = '%name "Loop"\nstart: nop\n        jmp start\n'

const CONFIG = {
  coreSize: 0x10000,
  maxCycles: 20_000,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
}
const ROUNDS = 3

const HILLS: SeedHill[] = [
  {
    slug: 'duel',
    name: 'duel',
    description: '',
    size: 4,
    rounds: ROUNDS,
    config: CONFIG,
    scoring: 'duel',
  },
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

beforeAll(async () => {
  await applySeed(
    env,
    await buildSeed(
      [
        { slug: 'spin', source: SPIN, melee: true },
        { slug: 'halt', source: HALT, melee: true },
        { slug: 'loop', source: LOOP, melee: true },
      ],
      { hills: HILLS },
    ),
  )
})

async function verify(id: string): Promise<MatchVerification> {
  const res = await send(new Jar(), `/api/matches/${encodeURIComponent(id)}/verify`)
  expect(res.status).toBe(200)
  return parse(MatchVerification, await res.json(), 'the verification')
}

/** What a client runs: the inputs, as the engine loads them, under their config and seed. */
function rerun({ inputs }: MatchVerification): MatchResult {
  return runMatch(replayBots(inputs), { ...inputs.config, seed: inputs.seed }, inputs.rounds)
}

async function matchIds(hill: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM matches WHERE hill_id = ? ORDER BY finished_at, id',
  )
    .bind(`hill-${hill}`)
    .all<{ id: string }>()
  return results.map((row) => row.id)
}

describe('GET /api/matches/:id/verify', () => {
  it("gives a seeded duel's inputs, which run to its key and its one result hash", async () => {
    const [id] = await matchIds('duel')
    const answer = await verify(id as string)
    const { match, inputs } = answer
    expect(match.id).toBe(id)
    // The launch seed stored no key and no rounds: the key is its replay's.
    expect(match.key).toBeNull()
    expect(match.result?.rounds).toBeUndefined()
    expect(inputs).toMatchObject({
      id,
      participants: match.participants,
      rounds: match.rounds,
      seed: match.seed,
      config: CONFIG,
    })
    expect(inputs.bots.map((b) => Object.keys(b).sort())).toEqual([
      ['bytes', 'name', 'sha256'],
      ['bytes', 'name', 'sha256'],
    ])
    expect(await bytesProblem(inputs)).toBeNull()
    const run = rerun(answer)
    expect(run.key).toBe(inputs.key)
    expect(matchResultHash(run.rounds)).toBe(match.result?.resultHash)
    expect(run.points).toEqual(match.result?.points)
  })

  it('gives a seeded melee its bots, all of them, in entrant order', async () => {
    const [id] = await matchIds('crowd')
    const answer = await verify(id as string)
    expect(answer.inputs.participants).toHaveLength(3)
    expect(answer.inputs.bots.map((b) => b.name)).toEqual(['Spin', 'Halt', 'Loop'])
    const run = rerun(answer)
    expect(run.key).toBe(answer.inputs.key)
    expect(matchResultHash(run.rounds)).toBe(answer.match.result?.resultHash)
  })

  it("gives a Runner's match its stored key, and each round's hash to check", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, handle) VALUES ('u1', 'tester')"),
      env.DB.prepare(
        `INSERT INTO bots (id, owner_id, slug, name, visibility)
         SELECT 'mine', 'u1', 'mine', 'Mine', 'private'`,
      ),
      // Loop's bytes under a private bot of the tester's: already in R2.
      env.DB.prepare(
        `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
         SELECT 'mine-v1', 'mine', 1, source, bytes_sha256, size, isa FROM bot_versions
         WHERE id = 'roster-loop-v1'`,
      ),
      env.DB.prepare(
        `INSERT INTO hill_submissions (id, hill_id, bot_version_id, user_id)
         VALUES ('s1', 'hill-duel', 'mine-v1', 'u1')`,
      ),
    ])
    const job: HillJob = { kind: 'hill', hill: 'duel', submissionId: 's1', botVersionId: 'mine-v1' }
    const runner = runnerOf(env, job)
    await runner.start(job)
    while (await runDurableObjectAlarm(runner)) {}
    expect(await runner.status()).toMatchObject({ status: 'finished' })

    // A hill job's match ids end in the defender's bot index: 1 on.
    const played = await env.DB.prepare(
      "SELECT id FROM matches WHERE id LIKE 's1-%' ORDER BY id",
    ).all<{ id: string }>()
    expect(played.results.length).toBeGreaterThan(0)
    const answer = await verify(played.results[0]?.id as string)
    const { match, inputs } = answer
    const outcome = match.result as MatchOutcome
    expect(match.key).not.toBeNull()
    expect(inputs.key).toBe(match.key)
    expect(inputs.participants[0]).toBe('mine-v1')
    // A private bot's bytes: public once its match is, as in its replay; its name as it fought.
    expect(inputs.bots[0]?.name).toBe('Mine')
    const run = rerun(answer)
    expect(run.key).toBe(match.key)
    expect(run.rounds.map((r) => r.resultHash)).toEqual(outcome.rounds?.map((r) => r.resultHash))
    expect(matchResultHash(run.rounds)).toBe(outcome.resultHash)
  })

  it('is a 404 for no match, one not finished, and one whose replay is gone; 400 for a bad id', async () => {
    const [id] = await matchIds('duel')
    const row = await env.DB.prepare('SELECT * FROM matches WHERE id = ?')
      .bind(id as string)
      .first<{ participants_json: string; replay_key: string }>()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO matches (id, hill_id, participants_json, rounds, seed)
         VALUES ('unplayed', 'hill-duel', ?, 3, 1)`,
      ).bind(row?.participants_json),
      env.DB.prepare(
        `INSERT INTO matches (id, hill_id, participants_json, rounds, seed, result_json, replay_key,
           finished_at)
         VALUES ('lost', 'hill-duel', ?, 3, 1, ?, ?, '2026-09-24T00:00:00.000Z')`,
      ).bind(
        row?.participants_json,
        JSON.stringify({ points: [3, 0], survivors: [0], resultHash: '0123456789abcdef' }),
        'f'.repeat(64),
      ),
    ])
    const jar = new Jar()
    expect(await errorOf(await send(jar, '/api/matches/nope/verify'))).toEqual({
      status: 404,
      code: 'not_found',
      message: 'no match nope',
    })
    expect(await errorOf(await send(jar, '/api/matches/unplayed/verify'))).toEqual({
      status: 404,
      code: 'not_found',
      message: 'match unplayed has not finished: nothing to verify',
    })
    expect(await errorOf(await send(jar, '/api/matches/lost/verify'))).toEqual({
      status: 404,
      code: 'not_found',
      message: 'the inputs of match lost are not stored',
    })
    expect((await send(jar, `/api/matches/${'x'.repeat(65)}/verify`)).status).toBe(400)
    expect((await send(jar, '/api/matches/unplayed')).status).toBe(404)
  })
})
