/**
 * `GET /api/ticker`: the latest challenge on any hill (evictions are not challenges), the last
 * championship to finish (a user's tournament is not one) and the next (running before
 * scheduled), the spectators in the rooms a page may have open; and the 30-second cache in KV.
 */
import { env } from 'cloudflare:workers'
import { parse, TICKER_TTL_MS, Ticker } from '@asmbots/protocol'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TICKER_KEY } from '../src/routes/ticker'
import { send } from './fake-auth'
import { Jar } from './jar'
import { type Spectator, spectate } from './live-socket'

const SHA = 'ab'.repeat(32)
const CONFIG = JSON.stringify({ rounds: 1, seed: 1, battle: {} })

beforeAll(async () => {
  const run = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)
  await env.DB.batch([
    run("INSERT INTO users (id, handle) VALUES ('u1', 'pedram')"),
    run(
      `INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES
         ('b1', 'u1', 'dwarf', 'Dwarf', 'public'), ('b2', 'u1', 'imp', 'Imp', 'public')`,
    ),
    run(
      `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, author, isa)
       VALUES ('v1', 'b1', 3, '', ?1, 4, 'Ped', 'x16c-v1'), ('v2', 'b2', 1, '', ?1, 4, NULL, 'x16c-v1')`,
      SHA,
    ),
    run(
      `INSERT INTO hills (id, slug, name, size, rounds, config_json, created_at) VALUES
         ('h-main', 'main', 'Main', 8, 1, '{}', '2026-09-01T00:00:00.000Z'),
         ('h-tiny', 'tiny', 'Tiny', 8, 1, '{}', '2026-09-02T00:00:00.000Z')`,
    ),
  ])
})

afterEach(async () => {
  vi.useRealTimers()
  await env.KV.delete(TICKER_KEY)
})

async function ticker(): Promise<Ticker> {
  const res = await send(new Jar(), '/api/ticker')
  expect(res.status).toBe(200)
  return parse(Ticker, await res.json(), 'the ticker')
}

function event(id: string, hill: string, kind: string, version: string, at: string) {
  return env.DB.prepare(
    `INSERT INTO hill_history (id, hill_id, event, bot_version_id, rank, score, delta, at)
     VALUES (?, ?, ?, ?, ?, 12, ?, ?)`,
  ).bind(id, hill, kind, version, kind === 'rejected' ? null : 1, kind === 'entered' ? 2 : null, at)
}

function tournament(id: string, status: string, owner: string | null, times: object = {}) {
  const {
    startsAt = null,
    finishedAt = null,
    champion = null,
  } = times as {
    startsAt?: string | null
    finishedAt?: string | null
    champion?: string | null
  }
  return env.DB.prepare(
    `INSERT INTO tournaments (id, slug, name, kind, status, config_json, owner_id, starts_at,
       finished_at, champion_id) VALUES (?, ?, ?, 'bracket', ?, ?, ?, ?, ?, ?)`,
  ).bind(id, id, id.replace('-', ' '), status, CONFIG, owner, startsAt, finishedAt, champion)
}

describe('GET /api/ticker', () => {
  it('is quiet before anything happens', async () => {
    const empty = await ticker()
    expect(empty).toEqual({
      at: expect.any(String),
      hill: null,
      lastChampionship: null,
      nextChampionship: null,
      spectators: 0,
    })
  })

  it('names the latest challenge, the last and next championships, and who is watching', async () => {
    await env.DB.batch([
      event('e1', 'h-main', 'entered', 'v1', '2026-09-20T10:00:00.000Z'),
      // Tiny's rejection is the latest challenge: Main's eviction after it is not a challenge.
      event('e2', 'h-tiny', 'rejected', 'v2', '2026-09-21T10:00:00.000Z'),
      event('e3', 'h-main', 'evicted', 'v2', '2026-09-22T10:00:00.000Z'),
      tournament('weekly-1', 'finished', null, {
        startsAt: '2026-09-12T18:00:00.000Z',
        finishedAt: '2026-09-12T19:00:00.000Z',
        champion: 'v2',
      }),
      tournament('weekly-2', 'finished', null, {
        startsAt: '2026-09-19T18:00:00.000Z',
        finishedAt: '2026-09-19T19:00:00.000Z',
        champion: 'v1',
      }),
      // A user's tournament, finished later, is not a championship.
      tournament('cup-1', 'finished', 'u1', {
        finishedAt: '2026-09-23T00:00:00.000Z',
        champion: 'v2',
      }),
      tournament('weekly-4', 'scheduled', null, { startsAt: '2026-10-03T18:00:00.000Z' }),
      tournament('weekly-3', 'scheduled', null, { startsAt: '2026-09-26T18:00:00.000Z' }),
      env.DB.prepare(
        `INSERT INTO tournament_entries (tournament_id, bot_version_id, user_id)
         VALUES ('weekly-3', 'v1', 'u1'), ('weekly-3', 'v2', NULL)`,
      ),
    ])
    const feed = await ticker()
    expect(feed.hill).toEqual({
      hill: { slug: 'tiny', name: 'Tiny' },
      event: {
        id: 'e2',
        hillId: 'h-tiny',
        submissionId: null,
        kind: 'rejected',
        botVersionId: 'v2',
        rank: null,
        score: 12,
        delta: null,
        at: '2026-09-21T10:00:00.000Z',
      },
      bot: {
        botId: 'b2',
        versionId: 'v2',
        slug: 'imp',
        name: 'Imp',
        version: 1,
        owner: 'pedram',
        author: null,
      },
    })
    expect(feed.lastChampionship).toEqual({
      id: 'weekly-2',
      name: 'weekly 2',
      status: 'finished',
      startsAt: '2026-09-19T18:00:00.000Z',
      finishedAt: '2026-09-19T19:00:00.000Z',
      entrants: 0,
      champion: expect.objectContaining({ versionId: 'v1', name: 'Dwarf', version: 3 }),
    })
    expect(feed.nextChampionship).toEqual({
      id: 'weekly-3',
      name: 'weekly 3',
      status: 'scheduled',
      startsAt: '2026-09-26T18:00:00.000Z',
      finishedAt: null,
      entrants: 2,
      champion: null,
    })

    // A running championship comes before any scheduled one.
    await tournament('weekly-live', 'running', null, { startsAt: '2026-10-10T18:00:00.000Z' }).run()
    await env.KV.delete(TICKER_KEY)
    expect((await ticker()).nextChampionship).toMatchObject({
      id: 'weekly-live',
      status: 'running',
    })
  })

  it("counts the sockets on hills' rooms and on tournaments' still to end", async () => {
    await env.DB.batch([
      tournament('t-open', 'scheduled', 'u1'),
      tournament('t-over', 'finished', 'u1', { finishedAt: '2026-09-20T00:00:00.000Z' }),
    ])
    const sockets: Spectator[] = []
    try {
      for (const room of ['hill:h-main', 'hill:h-main', 'hill:h-tiny', 'tournament:t-open']) {
        sockets.push(await spectate(room))
      }
      // A finished tournament's page opens no socket; one that does is not asked for.
      sockets.push(await spectate('tournament:t-over'))
      expect((await ticker()).spectators).toBe(4)
    } finally {
      for (const socket of sockets) socket.ws.close(1000)
    }
  })

  it('answers from KV for 30 s, then reads the feed again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'))
    const first = await ticker()
    expect(first.at).toBe('2026-09-24T12:00:00.000Z')
    const kept = await env.KV.getWithMetadata(TICKER_KEY, 'json')
    expect(kept.value).toEqual({ at: Date.parse(first.at), ticker: first })

    // A new challenge lands: the cache still answers until it is 30 s old.
    await event('e9', 'h-main', 'entered', 'v1', '2026-09-24T12:00:01.000Z').run()
    vi.setSystemTime(new Date(Date.parse(first.at) + TICKER_TTL_MS - 1))
    expect(await ticker()).toEqual(first)
    vi.setSystemTime(new Date(Date.parse(first.at) + TICKER_TTL_MS))
    const fresh = await ticker()
    expect(fresh.at).toBe('2026-09-24T12:00:30.000Z')
    expect(fresh.hill?.event.id).toBe('e9')
  })
})
