/**
 * The `LiveRoom` Durable Object and `GET /api/live/:room`: a socket opens with hello, the count,
 * and the backlog; events fan out to every socket; the last 20 stay, through the room's sleep; the
 * count goes out a moment after joins and leaves; pings get pongs; a socket that talks is closed;
 * the caps turn sockets away; and the route refuses what is not a socket to a watchable room.
 */
import { evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { LIVE_PING, LIVE_PONG, type LiveEvent, liveRoomName } from '@asmbots/protocol'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BACKLOG,
  MAX_PER_CLIENT,
  MAX_SPECTATORS,
  ROOM_FULL,
  refusal,
  SPECTATORS_ONLY,
} from '../src/do/live-room'
import { openLive, type Spectator, spectate } from './live-socket'

/** A hill each: rooms outlive a test, so no two tests share one. */
const HILLS = ['h-open', 'h-fan', 'h-backlog', 'h-sleep', 'h-count', 'h-ping', 'h-talk', 'h-cap']

beforeAll(async () => {
  await env.DB.batch([
    ...HILLS.map((id) =>
      env.DB.prepare(
        "INSERT INTO hills (id, slug, name, size, rounds, config_json) VALUES (?, ?, ?, 8, 1, '{}')",
      ).bind(id, id, id),
    ),
    env.DB.prepare(
      `INSERT INTO tournaments (id, slug, name, kind, status, config_json) VALUES
         ('t-live', 't-live', 'live', 'melee', 'running', '{}'),
         ('t-draft', 't-draft', 'draft', 'melee', 'draft', '{}')`,
    ),
  ])
})

/** The sockets a test opened: closed after it. */
const opened: Spectator[] = []

afterEach(() => {
  for (const s of opened.splice(0)) if (s.closed === null) s.ws.close(1000)
})

async function join(hill: string, ip?: string): Promise<Spectator> {
  const s = await spectate(`hill:${hill}`, ip === undefined ? {} : { ip })
  opened.push(s)
  return s
}

function room(hill: string) {
  return env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(liveRoomName({ kind: 'hill', id: hill })))
}

const progress = (done: number): LiveEvent => ({
  type: 'progress',
  job: 'hill:x:s1',
  status: 'running',
  done,
  of: 30,
})

const STARTED: LiveEvent = {
  type: 'matchStarted',
  job: 'hill:x:s1',
  match: {
    id: 's1-0',
    key: '0123456789abcdef',
    participants: ['v1', 'v2'],
    rounds: 1,
    seed: 1,
    config: {
      coreSize: 0x10000,
      maxCycles: 1000,
      maxProcesses: 64,
      minSpacing: 1024,
      maxBotBytes: 512,
    },
    bots: [
      { name: 'Loop', bytes: '6/4=', sha256: 'a'.repeat(64) },
      { name: 'Dat', bytes: 'AAA=', sha256: 'b'.repeat(64) },
    ],
  },
}

describe('a spectator socket', () => {
  it('opens with hello, the count, and the backlog, oldest first', async () => {
    await room('h-open').publish([progress(1), progress(2)])
    const s = await join('h-open')
    await s.until(4)
    expect(s.heard).toEqual([
      {
        type: 'hello',
        protocol: 1,
        room: { kind: 'hill', id: 'h-open' },
        now: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      },
      { type: 'spectators', count: 1 },
      progress(1),
      progress(2),
    ])
  })

  it('gets each event as it is published, as every other socket does', async () => {
    const a = await join('h-fan')
    const b = await join('h-fan')
    await Promise.all([a.until(2), b.until(2)])
    await room('h-fan').publish([STARTED, progress(1)])
    await Promise.all([a.until(4), b.until(4)])
    for (const s of [a, b]) expect(s.heard.slice(2)).toEqual([STARTED, progress(1)])
    await room('h-fan').publish([progress(2)])
    await Promise.all([a.until(5), b.until(5)])
    for (const s of [a, b]) expect(s.heard.at(-1)).toEqual(progress(2))
  })

  it('refuses an event that is not one, and publishes none of its batch', async () => {
    const a = await join('h-fan')
    await a.until(2)
    const heard = a.heard.length
    const bad = { type: 'hello' } as unknown as LiveEvent
    const why = await room('h-fan')
      .publish([progress(3), bad])
      .then(
        () => 'published',
        (error: Error) => error.message,
      )
    expect(why).toBe('type is not well formed')
    expect((await room('h-fan').recent()).map((e) => e.type === 'progress' && e.done)).toEqual([
      false,
      1,
      2,
    ])
    await room('h-fan').publish([progress(4)])
    await a.until(heard + 1)
    expect(a.heard.slice(heard)).toEqual([progress(4)])
  })
})

describe('the backlog', () => {
  it(`keeps the last ${BACKLOG} events for a late joiner`, async () => {
    const all = Array.from({ length: 25 }, (_, i) => progress(i + 1))
    await room('h-backlog').publish(all.slice(0, 10))
    await room('h-backlog').publish(all.slice(10, 11))
    await room('h-backlog').publish(all.slice(11))
    expect(await room('h-backlog').recent()).toEqual(all.slice(-BACKLOG))
    const late = await join('h-backlog')
    await late.until(2 + BACKLOG)
    expect(late.heard.slice(2)).toEqual(all.slice(-BACKLOG))
  })

  it('outlives the room going to sleep, and so do its sockets', async () => {
    const s = await join('h-sleep')
    await s.until(2)
    await room('h-sleep').publish([progress(1)])
    await s.until(3)
    await evictDurableObject(room('h-sleep'))
    expect(await room('h-sleep').recent()).toEqual([progress(1)])
    await room('h-sleep').publish([progress(2)])
    await s.until(4)
    expect(s.heard.slice(2)).toEqual([progress(1), progress(2)])
  })
})

describe('the count', () => {
  it('goes to every socket a moment after joins and leaves', async () => {
    const a = await join('h-count')
    const b = await join('h-count')
    await Promise.all([a.until(2), b.until(2)])
    expect(a.of('spectators')[0]).toEqual({ type: 'spectators', count: 1 })
    expect(b.of('spectators')[0]).toEqual({ type: 'spectators', count: 2 })
    expect(await room('h-count').spectators()).toBe(2)
    // The alarm is a second off; it may fire by itself first, which says the same.
    await runDurableObjectAlarm(room('h-count'))
    await vi.waitFor(() => expect(a.of('spectators').at(-1)?.count).toBe(2))

    b.ws.close(1000, 'leaving')
    await vi.waitFor(async () => expect(await room('h-count').spectators()).toBe(1))
    await runDurableObjectAlarm(room('h-count'))
    await vi.waitFor(() => expect(a.of('spectators').at(-1)?.count).toBe(1))
  })
})

describe('keepalives', () => {
  it('answer a ping with a pong, and a ping written another way too', async () => {
    const s = await join('h-ping')
    await s.until(2)
    s.ws.send(LIVE_PING)
    await s.until(3)
    expect(s.texts.at(-1)).toBe(LIVE_PONG)
    s.ws.send('{ "type": "ping" }')
    await s.until(4)
    expect(s.texts.at(-1)).toBe(LIVE_PONG)
    expect(s.closed).toBeNull()
  })

  it('close a socket that says anything else: spectators only listen', async () => {
    const s = await join('h-talk')
    await s.until(2)
    s.ws.send('{"type":"shout"}')
    expect(await s.untilClosed()).toEqual({
      code: SPECTATORS_ONLY,
      reason: 'spectators only send pings',
    })
  })
})

describe('the caps', () => {
  it(`turn away a socket past ${MAX_PER_CLIENT} from one address, not one from another`, async () => {
    const mine = await Promise.all(
      Array.from({ length: MAX_PER_CLIENT }, () => join('h-cap', '10.9.9.9')),
    )
    await Promise.all(mine.map((s) => s.until(1)))
    const turned = await join('h-cap', '10.9.9.9')
    expect(await turned.untilClosed()).toEqual({
      code: ROOM_FULL,
      reason: 'too many sockets from one address',
    })
    expect(turned.heard).toEqual([])
    const other = await join('h-cap', '10.9.9.8')
    await other.until(2)
    expect(other.of('spectators')[0]?.count).toBe(MAX_PER_CLIENT + 1)
  })

  it(`fill a room at ${MAX_SPECTATORS}`, () => {
    expect(refusal(MAX_SPECTATORS - 1, 0)).toBeNull()
    expect(refusal(MAX_SPECTATORS, 0)).toBe('the room is full')
    expect(refusal(10, MAX_PER_CLIENT - 1)).toBeNull()
    expect(refusal(10, MAX_PER_CLIENT)).toBe('too many sockets from one address')
  })
})

describe('GET /api/live/:room', () => {
  it('opens a socket on a hill, or a tournament past its draft', async () => {
    for (const name of ['hill:h-open', 'tournament:t-live']) {
      const res = await openLive(name)
      expect(res.status).toBe(101)
      res.webSocket?.accept()
      res.webSocket?.close(1000)
    }
  })

  it('lets this site and the app origin in, and no other page', async () => {
    for (const origin of ['https://asmbots.test', 'http://localhost:5173']) {
      const res = await openLive('hill:h-open', { origin })
      expect(res.status).toBe(101)
      res.webSocket?.accept()
      res.webSocket?.close(1000)
    }
    const res = await openLive('hill:h-open', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: {
        code: 'forbidden',
        message: 'a live socket from https://evil.example is not allowed',
      },
    })
  })

  it('answers 404 for a room of nothing, and 400 for a request that is not a socket', async () => {
    for (const name of ['hill:nope', 'tournament:t-draft', 'tournament:nope', 'melee:x', 'nope']) {
      const res = await openLive(name)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({
        error: { code: 'not_found', message: `no live room ${name}` },
      })
    }
    const plain = await exports.default.fetch(
      new Request('https://asmbots.test/api/live/hill%3Ah-open'),
    )
    expect(plain.status).toBe(400)
    expect(await plain.json()).toMatchObject({ error: { code: 'bad_request' } })
  })
})
