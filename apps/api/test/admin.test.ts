/**
 * `GET /api/admin/stats`: for the handles in `ADMIN_HANDLES` only (401 signed out, 403 to anyone
 * else, nobody when it is empty); the counts by status, the job queue with each `Runner`'s
 * report, the Durable Object counts, and the rooms with spectators.
 */
import { env } from 'cloudflare:workers'
import { assembleOrThrow } from '@asmbots/asm'
import { AdminStats, type HillJob, ISA, parse, sha256Hex } from '@asmbots/protocol'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySeed, buildSeed, type SeedHill } from '../src/db/seed'
import { runnerOf } from '../src/do/runner'
import type { Env } from '../src/env'
import { adminHandles } from '../src/routes/admin'
import { botBytesKey } from '../src/storage'
import { errorOf, FAKE, send, signIn } from './fake-auth'
import { Jar } from './jar'
import { type Spectator, spectate } from './live-socket'

const SPIN = '%name "Spin"\nstart: jmp $\n'
const HALT = '%name "Halt"\nstart: hlt ; lint: allow hlt-in-code\n'
const LOOP = '%name "Loop"\nstart: nop\n        jmp start\n'
/** A challenger the hill has not seen. */
const PAD = '%name "Pad"\nstart: nop\n        nop\n        jmp start\n'

const HILL: SeedHill = {
  slug: 'duel',
  name: 'duel',
  description: '',
  size: 4,
  rounds: 2,
  config: {
    coreSize: 0x10000,
    maxCycles: 5000,
    maxProcesses: 64,
    minSpacing: 1024,
    maxBotBytes: 512,
  },
  scoring: 'duel',
}

const ADMINS: Env = { ...FAKE, ADMIN_HANDLES: ' Boss,ops-lead ' }

beforeAll(async () => {
  await applySeed(
    env,
    await buildSeed(
      [
        { slug: 'spin', source: SPIN, melee: false },
        { slug: 'halt', source: HALT, melee: false },
        { slug: 'loop', source: LOOP, melee: false },
      ],
      { hills: [HILL] },
    ),
  )
  // Pad, a bot of the tester's at version 1, its bytes in R2 as `POST /api/bots` keeps them.
  const pad = assembleOrThrow(PAD).bytes
  const sha = await sha256Hex(pad)
  await env.REPLAYS.put(botBytesKey(sha), pad)
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, handle) VALUES ('u1', 'tester'), ('u2', 'rival')"),
    env.DB.prepare(
      "INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES ('pad', 'u1', 'pad', 'Pad', 'public')",
    ),
    env.DB.prepare(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, isa)
       VALUES ('pad-v1', 'pad', 1, ?, ?, ?, ?)`,
    ).bind(PAD, sha, pad.length, ISA),
  ])
})

async function user(as: string): Promise<Jar> {
  const jar = new Jar()
  await signIn(jar, as)
  return jar
}

function stats(jar: Jar, vars: Env = ADMINS) {
  return send(jar, '/api/admin/stats', { vars })
}

describe('adminHandles', () => {
  it('splits on commas and spaces, in lowercase, and names nobody when empty', () => {
    expect([...adminHandles(' Boss,ops-lead  x ')]).toEqual(['boss', 'ops-lead', 'x'])
    expect(adminHandles('').size).toBe(0)
    expect(adminHandles(undefined).size).toBe(0)
    expect(adminHandles(' , ').size).toBe(0)
  })
})

describe('GET /api/admin/stats', () => {
  it('is for the admins: 401 signed out, 403 to others and when nobody is named', async () => {
    expect(await errorOf(await stats(new Jar()))).toMatchObject({
      status: 401,
      code: 'unauthorized',
    })
    expect(await errorOf(await stats(await user('someone')))).toEqual({
      status: 403,
      code: 'forbidden',
      message: 'the stats are for admins',
    })
    const boss = await user('boss')
    expect((await stats(boss)).status).toBe(200)
    expect((await stats(boss, { ...FAKE, ADMIN_HANDLES: '' })).status).toBe(403)
    const { ADMIN_HANDLES: _, ...unset } = FAKE
    expect((await stats(boss, unset)).status).toBe(403)
  })

  it('counts jobs by status, lists the queue with each Runner, and counts the rooms', async () => {
    const boss = await user('boss')
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO hill_submissions (id, hill_id, bot_version_id, user_id, status, created_at)
         VALUES ('s-run', 'hill-duel', 'pad-v1', 'u1', 'queued', '2026-09-24T10:00:00.000Z'),
                ('s-wait', 'hill-duel', 'roster-spin-v1', 'u2', 'queued', '2026-09-24T11:00:00.000Z'),
                ('s-done', 'hill-duel', 'roster-halt-v1', 'u2', 'finished', '2026-09-23T00:00:00.000Z'),
                ('s-bad', 'hill-duel', 'roster-halt-v1', 'u1', 'failed', '2026-09-23T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO tournaments (id, slug, name, kind, status, config_json, starts_at) VALUES
           ('t-run', 't-run', 'run', 'melee', 'running', '{}', '2026-09-24T09:00:00.000Z'),
           ('t-soon', 't-soon', 'soon', 'melee', 'scheduled', '{}', NULL),
           ('t-old', 't-old', 'old', 'melee', 'finished', '{}', '2026-09-01T00:00:00.000Z'),
           ('t-draft', 't-draft', 'draft', 'melee', 'draft', '{}', NULL)`,
      ),
    ])
    // One submission's Runner has started (its 3 matches known); the other waits for its own.
    const job: HillJob = {
      kind: 'hill',
      hill: 'duel',
      submissionId: 's-run',
      botVersionId: 'pad-v1',
    }
    await runnerOf(env, job).start(job)
    const sockets: Spectator[] = []
    try {
      sockets.push(await spectate('hill:hill-duel'), await spectate('hill:hill-duel'))
      sockets.push(await spectate('tournament:t-soon'))
      const res = await stats(boss)
      expect(res.status).toBe(200)
      const body = parse(AdminStats, await res.json(), 'the stats')
      expect(body.submissions).toEqual({
        queued: 1,
        running: 1,
        finished: 1,
        cancelled: 0,
        failed: 1,
      })
      expect(body.tournaments).toEqual({
        draft: 1,
        scheduled: 1,
        running: 1,
        finished: 1,
        cancelled: 0,
      })
      // Oldest first: the tournament started at 9:00, then the submissions.
      expect(body.queue).toEqual([
        {
          job: 'tournament:t-run',
          kind: 'tournament',
          status: 'running',
          since: '2026-09-24T09:00:00.000Z',
          // Its runner never started: this test made the row by hand.
          runner: null,
        },
        {
          job: 'hill:duel:s-run',
          kind: 'hill',
          status: 'running',
          since: '2026-09-24T10:00:00.000Z',
          runner: { status: 'running', done: 0, of: 3, alarms: 0, error: null },
        },
        {
          job: 'hill:duel:s-wait',
          kind: 'hill',
          status: 'queued',
          since: '2026-09-24T11:00:00.000Z',
          runner: null,
        },
      ])
      expect(body.durableObjects).toEqual({
        // 4 submissions, 2 tournaments that started.
        runners: 6,
        activeRunners: 3,
        // The hill, and the 3 tournaments past their draft.
        liveRooms: 4,
        // The hill, the running tournament, the scheduled one.
        askedRooms: 3,
      })
      expect(body.rooms).toEqual([
        { room: 'hill:hill-duel', spectators: 2 },
        { room: 'tournament:t-soon', spectators: 1 },
      ])
      expect(body.spectators).toBe(3)
    } finally {
      for (const socket of sockets) socket.ws.close(1000)
    }
  })
})
