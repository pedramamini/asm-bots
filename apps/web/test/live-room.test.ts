/**
 * A live room from the page (src/features/live): the reducer (matches kept once, results, each
 * job's progress, endings), the client's socket (its URL, hello, pings, a dead socket dropped,
 * reconnects with a doubling wait, a full room, another protocol, disposal), and the check of a
 * live match against the server's row.
 */
import { describe, expect, it } from 'bun:test'
import { LIVE_PING, type LiveMessage, type Match } from '@asmbots/protocol'
import type { ReplayRun } from '../src/features/arena/battle/verify'
import { liveCheck, liveReplay } from '../src/features/live/check'
import {
  currentMatch,
  FIRST_RETRY_MS,
  FULL_RETRY_MS,
  IDLE_ROOM,
  KEPT_MATCHES,
  LiveRoomClient,
  type LiveRoomState,
  liveUrl,
  MAX_RETRY_MS,
  PING_MS,
  ROOM_FULL,
  reduceLive,
  roomBusy,
  STALE_MS,
} from '../src/features/live/room'
import { FakeSockets, FakeTimers, liveDuel } from './live-fakes'

const JOB = 'hill:main:s1'
const HELLO: LiveMessage = {
  type: 'hello',
  protocol: 1,
  room: { kind: 'hill', id: 'h1' },
  now: '2026-09-24T12:00:00.000Z',
}

const progress = (done: number, status: 'running' | 'finished' = 'running', job = JOB) =>
  ({ type: 'progress', job, status, done, of: 3 }) as const

const reduce = (...messages: LiveMessage[]): LiveRoomState =>
  messages.reduce(reduceLive, { ...IDLE_ROOM, status: 'connecting' })

describe('reduceLive', () => {
  it('goes live on hello, and counts the room', () => {
    const state = reduce(HELLO, { type: 'spectators', count: 3 })
    expect(state.status).toBe('live')
    expect(state.spectators).toBe(3)
  })

  it('keeps each match once, with its result when it finishes', async () => {
    const one = await liveDuel('s1-1')
    const two = await liveDuel('s1-2')
    const started = (m: typeof one) => ({ type: 'matchStarted', job: JOB, match: m.match }) as const
    const finished = (m: typeof one) =>
      ({ type: 'matchFinished', job: JOB, match: m.finished }) as const
    const state = reduce(
      HELLO,
      progress(0),
      started(one),
      finished(one),
      started(two),
      // After a reconnect the backlog comes again: nothing is kept twice.
      HELLO,
      started(one),
      finished(one),
      started(two),
    )
    expect(state.matches.map((m) => [m.match.id, m.result?.id ?? null])).toEqual([
      ['s1-1', 's1-1'],
      ['s1-2', null],
    ])
    expect(currentMatch(state)?.match.id).toBe('s1-2')
    // A match whose start went by before the page came has nothing to run it from.
    const late = reduce(HELLO, finished(one))
    expect(late.matches).toEqual([])
  })

  it(`keeps the last ${KEPT_MATCHES} matches`, async () => {
    const { match } = await liveDuel('m')
    const messages: LiveMessage[] = Array.from({ length: KEPT_MATCHES + 5 }, (_, i) => ({
      type: 'matchStarted',
      job: JOB,
      match: { ...match, id: `m-${i}` },
    }))
    const state = reduce(...messages)
    expect(state.matches).toHaveLength(KEPT_MATCHES)
    expect(state.matches[0]?.match.id).toBe('m-5')
  })

  it("counts a job's end once, and only for a job seen running", () => {
    let state = reduce(HELLO, progress(0), progress(1))
    expect(roomBusy(state)).toBe(true)
    expect(state.endings).toBe(0)
    state = reduce(HELLO, progress(0), progress(1), progress(3, 'finished'))
    expect(state.endings).toBe(1)
    expect(roomBusy(state)).toBe(false)
    // The backlog again: an ended job stays ended, and nothing counts twice.
    state = [HELLO, progress(0), progress(1), progress(3, 'finished')].reduce(reduceLive, state)
    expect(state.endings).toBe(1)
    expect(state.jobs.get(JOB)).toEqual(progress(3, 'finished'))
    // A job first heard of as ended changed nothing this page saw.
    expect(reduce(HELLO, progress(3, 'finished', 'hill:main:s2')).endings).toBe(0)
    // A running job never goes back.
    expect(reduce(HELLO, progress(2), progress(1)).jobs.get(JOB)?.done).toBe(2)
  })

  it('watches no match of a job that has ended', async () => {
    const { match } = await liveDuel('s1-1')
    const state = reduce(HELLO, progress(0), { type: 'matchStarted', job: JOB, match })
    expect(currentMatch(state)?.match.id).toBe('s1-1')
    expect(currentMatch(reduceLive(state, progress(1, 'finished')))).toBeNull()
  })
})

describe('liveUrl', () => {
  it("is the room's socket on the page's origin, ws or wss as the page is", () => {
    expect(liveUrl('hill:h1', 'http://localhost:5173')).toBe(
      'ws://localhost:5173/api/live/hill%3Ah1',
    )
    expect(liveUrl('tournament:t 1', 'https://asmbots.example')).toBe(
      'wss://asmbots.example/api/live/tournament%3At%201',
    )
  })
})

/** A client on fake sockets and timers, its waits' jitter at the top (the full wait). */
function client(room = 'hill:h1') {
  const sockets = new FakeSockets()
  const timers = new FakeTimers()
  const live = new LiveRoomClient(room, {
    createSocket: sockets.create,
    timers,
    random: () => 1,
  })
  return { sockets, timers, live, state: () => live.store.getState() }
}

describe('LiveRoomClient', () => {
  it('opens the room, goes live on hello, and reads what the room says', async () => {
    const { sockets, live, state } = client()
    expect(sockets.last.url).toBe('ws://localhost/api/live/hill%3Ah1')
    expect(state().status).toBe('connecting')
    sockets.last.open()
    sockets.last.receive(HELLO)
    sockets.last.receive({ type: 'spectators', count: 2 })
    sockets.last.receive(progress(0))
    expect(state()).toMatchObject({ status: 'live', spectators: 2 })
    expect(state().jobs.get(JOB)).toEqual(progress(0))
    // A message this page cannot read is skipped; the next one still counts.
    sockets.last.receive('{"type":"shout"}')
    sockets.last.receive('not json')
    sockets.last.receive(progress(1))
    expect(state().jobs.get(JOB)?.done).toBe(1)
    live.dispose()
  })

  it('pings the room, and drops a socket that has gone quiet', () => {
    const { sockets, timers, live, state } = client()
    const first = sockets.last
    first.open()
    first.receive(HELLO)
    timers.advance(PING_MS)
    expect(first.sent).toEqual([LIVE_PING])
    first.receive({ type: 'pong' })
    const heard = timers.time
    timers.advance(PING_MS)
    expect(first.sent).toEqual([LIVE_PING, LIVE_PING])
    // Nothing heard past STALE_MS: the socket is dead, and another opens after the first wait.
    while (timers.time - heard <= STALE_MS) timers.advance(PING_MS)
    expect(first.closedWith).toBe(1000)
    expect(state().status).toBe('reconnecting')
    expect(sockets.all).toHaveLength(1)
    expect(timers.pending()).toEqual([FIRST_RETRY_MS])
    timers.advance(FIRST_RETRY_MS)
    expect(sockets.all).toHaveLength(2)
    sockets.last.open()
    sockets.last.receive(HELLO)
    expect(state().status).toBe('live')
    live.dispose()
  })

  it('opens the room again after each drop, waiting twice as long each time, until a hello', () => {
    const { sockets, timers, live, state } = client()
    const waits: number[] = []
    for (let i = 0; i < 7; i++) {
      sockets.last.drop(1006)
      expect(state().status).toBe('reconnecting')
      waits.push(timers.pending()[0] ?? -1)
      timers.advance(waits[i] ?? 0)
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, MAX_RETRY_MS, MAX_RETRY_MS])
    sockets.last.open()
    sockets.last.receive(HELLO)
    sockets.last.drop(1001)
    expect(timers.pending()).toEqual([FIRST_RETRY_MS])
    live.dispose()
  })

  it('waits half to all of each wait, so a crowd does not come back at once', () => {
    const sockets = new FakeSockets()
    const timers = new FakeTimers()
    const live = new LiveRoomClient('hill:h1', {
      createSocket: sockets.create,
      timers,
      random: () => 0,
    })
    sockets.last.drop()
    expect(timers.pending()).toEqual([FIRST_RETRY_MS / 2])
    live.dispose()
  })

  it('counts a socket the browser will not open as a drop', () => {
    const timers = new FakeTimers()
    let tries = 0
    const live = new LiveRoomClient('hill:h1', {
      createSocket: () => {
        tries++
        throw new DOMException('blocked', 'SecurityError')
      },
      timers,
      random: () => 1,
    })
    expect(live.store.getState().status).toBe('reconnecting')
    expect(timers.pending()).toEqual([FIRST_RETRY_MS])
    timers.advance(FIRST_RETRY_MS)
    expect(tries).toBe(2)
    expect(timers.pending()).toEqual([2 * FIRST_RETRY_MS])
    live.dispose()
    expect(timers.pending()).toEqual([])
  })

  it('waits a minute when the room is full', () => {
    const { sockets, timers, live, state } = client()
    sockets.last.drop(ROOM_FULL)
    expect(state().status).toBe('full')
    expect(timers.pending()).toEqual([FULL_RETRY_MS])
    timers.advance(FULL_RETRY_MS)
    expect(sockets.all).toHaveLength(2)
    expect(state().status).toBe('full')
    sockets.last.open()
    sockets.last.receive(HELLO)
    expect(state().status).toBe('live')
    live.dispose()
  })

  it('stops at a room that speaks another protocol: the page is out of date', () => {
    const { sockets, timers, state } = client()
    sockets.last.open()
    sockets.last.receive(JSON.stringify({ ...HELLO, protocol: 2 }))
    expect(state().status).toBe('outdated')
    expect(sockets.last.closedWith).toBe(1000)
    sockets.last.drop(1000)
    timers.advance(FULL_RETRY_MS * 10)
    expect(sockets.all).toHaveLength(1)
  })

  it('closes its socket when disposed, one still connecting once it opens, and opens no other', () => {
    const { sockets, timers, live } = client()
    const connecting = sockets.last
    live.dispose()
    expect(connecting.closedWith).toBeNull()
    connecting.open()
    expect(connecting.closedWith).toBe(1000)
    timers.advance(MAX_RETRY_MS * 10)
    expect(sockets.all).toHaveLength(1)

    const other = client()
    other.sockets.last.open()
    other.sockets.last.drop()
    other.live.dispose()
    other.timers.advance(MAX_RETRY_MS)
    expect(other.sockets.all).toHaveLength(1)
    expect(other.timers.pending()).toEqual([])
  })
})

describe('liveCheck', () => {
  /** A run that ended each round with the hashes the server recorded. */
  function runOf(finished: Match, key: string): ReplayRun {
    const hashes = new Map((finished.result?.rounds ?? []).map((r) => [r.round, r.resultHash]))
    return { key, hashes, error: null }
  }

  it('verifies once the server row comes and every round of the run matches it', async () => {
    const { match, finished } = await liveDuel('s1-1', 2)
    const run = runOf(finished, match.key)
    expect(liveCheck(match, null, run, 'ok')).toEqual({ state: 'pending', verified: 0, of: 2 })
    expect(liveCheck(match, finished, run, 'ok')).toEqual({ state: 'verified', of: 2 })
    const half = { ...run, hashes: new Map([...run.hashes].slice(0, 1)) }
    expect(liveCheck(match, finished, half, 'ok')).toEqual({ state: 'pending', verified: 1, of: 2 })
    expect(liveReplay(match, finished)?.result.key).toBe(match.key)
  })

  it('says mismatch for a round that differs, other inputs, a failed run, or bad bytes', async () => {
    const { match, finished } = await liveDuel('s1-1', 2)
    const run = runOf(finished, match.key)
    const wrong = { ...run, hashes: new Map(run.hashes).set(1, '0000000000000000') }
    expect(liveCheck(match, finished, wrong, 'ok')).toMatchObject({
      state: 'mismatch',
      reason: expect.stringContaining('round 2: result 0000000000000000'),
    })
    expect(liveCheck(match, finished, { ...run, key: 'ffffffffffffffff' }, 'ok')).toMatchObject({
      state: 'mismatch',
    })
    // Before the row comes, the run itself can already fail the check.
    expect(liveCheck(match, null, { ...run, key: 'ffffffffffffffff' }, 'ok')).toEqual({
      state: 'mismatch',
      reason: 'the match the room sent is of other bots or another config',
    })
    expect(liveCheck(match, null, { ...run, error: 'no worker' }, 'ok')).toEqual({
      state: 'mismatch',
      reason: 'the match did not run: no worker',
    })
    expect(liveCheck(match, null, run, { problem: "Loop's bytes do not match" })).toEqual({
      state: 'mismatch',
      reason: "Loop's bytes do not match",
    })
  })

  it("checks a row without rounds by the match's one hash", async () => {
    const { match, finished } = await liveDuel('s1-1', 2)
    const run = runOf(finished, match.key)
    const bare: Match = {
      ...finished,
      result: finished.result && { ...finished.result, rounds: undefined },
    }
    expect(liveReplay(match, bare)).toBeNull()
    expect(liveCheck(match, bare, run, 'ok')).toEqual({ state: 'verified', of: 2 })
    const off = { ...run, hashes: new Map(run.hashes).set(0, '0000000000000000') }
    expect(liveCheck(match, bare, off, 'ok')).toMatchObject({ state: 'mismatch' })
  })
})
