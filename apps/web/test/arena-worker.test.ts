/**
 * The arena Worker for real: `ArenaClient` drives `arena.worker.ts` in a Worker thread, and the
 * frames come back through `postMessage` with their typed arrays transferred. jsdom has no Worker;
 * Bun has one.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import {
  Battle,
  type BattleConfigInput,
  fnv1a64,
  type LoadedBot,
  resultHash,
  simulate,
} from '@asmbots/engine'
import { runMatch } from '@asmbots/tourney'
import {
  ArenaClient,
  type ArenaState,
  createArenaStore,
  type Schedule,
} from '../src/features/arena/worker/client'
import type { ArenaRequest, FrameMessage } from '../src/features/arena/worker/protocol'

/** Dwarf and Paper at seed 1 fight for 23,823 cycles. */
const DUEL: readonly LoadedBot[] = [fighter('dwarf'), fighter('paper')]
const DUEL_CONFIG: BattleConfigInput = { seed: 1 }

const WORKER_URL = new URL('../src/features/arena/worker/arena.worker.ts', import.meta.url)

/** A display frame that comes only when the test calls `tick`. */
function manualSchedule(): { schedule: Schedule; tick: () => void } {
  let pending: (() => void) | null = null
  return {
    schedule: (callback) => {
      pending = callback
      return () => {
        pending = null
      }
    },
    tick: () => {
      const callback = pending
      pending = null
      callback?.()
    },
  }
}

/** A real Worker whose requests the test can read. */
function watchedWorker(): { worker: Worker; sent: ArenaRequest[] } {
  const worker = new Worker(WORKER_URL, { type: 'module' })
  const sent: ArenaRequest[] = []
  const post = worker.postMessage.bind(worker)
  worker.postMessage = ((request: ArenaRequest) => {
    sent.push(request)
    post(request)
  }) as Worker['postMessage']
  return { worker, sent }
}

const clients: ArenaClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
})

function client(options: ConstructorParameters<typeof ArenaClient>[0] = {}): ArenaClient {
  const made = new ArenaClient({ store: createArenaStore(), ...options })
  clients.push(made)
  return made
}

/** Loads `bots` and waits for the full frame at cycle 0. */
async function load(arena: ArenaClient, bots = DUEL, config = DUEL_CONFIG): Promise<FrameMessage> {
  const frame = arena.once('frame')
  arena.load(bots, config)
  return frame
}

function state(arena: ArenaClient): ArenaState {
  return arena.store.getState()
}

describe('arena Worker', () => {
  it('loads two roster bots and answers step 10 with a frame at cycle 10', async () => {
    const arena = client()
    const loaded = arena.once('loaded')
    const full = await load(arena)
    expect((await loaded).botMeta.map((b) => b.name)).toEqual(['Dwarf', 'Paper'])
    expect(full.cycle).toBe(0)
    expect(full.ownerDirty).toBeInstanceOf(Uint8Array)
    expect(state(arena)).toMatchObject({ status: 'paused', cycle: 0, alive: 2 })

    const next = arena.once('frame')
    arena.step(10)
    const frame = await next
    expect(frame.cycle).toBe(10)
    expect(frame.ownerDirty).toBeNull()
    expect(frame.writes).toBeInstanceOf(Uint16Array)
    expect(frame.execs.length).toBeGreaterThan(0)
    expect(frame.stats).toBeInstanceOf(Float32Array)
    expect(state(arena)).toMatchObject({ status: 'paused', cycle: 10, alive: 2 })
    expect(state(arena).placements).toEqual(
      new Battle(DUEL, DUEL_CONFIG).bots.map((b) => ({ base: b.base, size: b.size })),
    )
  })

  it('seeks back to 5,000 after running to 6,000: the owner map is a fresh run to 5,000', async () => {
    const arena = client()
    await load(arena)
    const ran = arena.once('frame')
    arena.step(6000)
    expect((await ran).cycle).toBe(6000)

    const sought = arena.once('frame')
    arena.seek(5000)
    const frame = await sought
    const fresh = new Battle(DUEL, DUEL_CONFIG)
    fresh.run(5000)
    expect(frame.cycle).toBe(5000)
    expect(fnv1a64(frame.ownerDirty as Uint8Array)).toBe(fnv1a64(fresh.core.owner))
    expect(fnv1a64(frame.bytesDirty as Uint8Array)).toBe(fnv1a64(fresh.core.bytes))
    expect(state(arena).cycle).toBe(5000)
  })

  it('plays at max to the end, with the engine result and its hash', async () => {
    const arena = client()
    await load(arena)
    arena.speed('max')
    const ended = arena.once('ended')
    arena.play()
    expect(state(arena).status).toBe('playing')
    const { result, hash } = await ended
    const want = simulate(DUEL, DUEL_CONFIG)
    expect(result).toEqual(want)
    expect(hash).toBe(resultHash(want))
    expect(state(arena)).toMatchObject({ status: 'ended', cycle: want.cycles, resultHash: hash })

    // A seek back reopens it.
    const back = arena.once('frame')
    arena.seek(1000)
    await back
    expect(state(arena)).toMatchObject({ status: 'paused', cycle: 1000, result: null })
  })

  it('asks for one frame per display frame, and never while one is owed', async () => {
    const display = manualSchedule()
    const { worker, sent } = watchedWorker()
    const arena = client({ worker, schedule: display.schedule })
    await load(arena)
    arena.speed(50)
    arena.play()
    const requests = () => sent.filter((r) => r.type === 'requestFrame').length
    expect(requests()).toBe(1)
    // The frame is not in yet: more display frames ask for nothing.
    for (let i = 0; i < 5; i++) display.tick()
    expect(requests()).toBe(1)

    await arena.once('frame')
    display.tick()
    expect(requests()).toBe(2)
    expect((await arena.once('frame')).cycle).toBe(100)

    arena.pause()
    display.tick()
    expect(requests()).toBe(2)
    expect(state(arena).status).toBe('paused')
  })

  it('holds seeks while a frame is owed, and sends only the last', async () => {
    const { worker, sent } = watchedWorker()
    const arena = client({ worker })
    await load(arena)
    const frames: number[] = []
    arena.on('frame', (f) => frames.push(f.cycle))
    const settled = new Promise<void>((resolve) => {
      arena.on('frame', (f) => {
        if (f.cycle === 300) resolve()
      })
    })
    arena.step(2000)
    arena.seek(100)
    arena.seek(200)
    arena.seek(300)
    await settled
    expect(sent.filter((r) => r.type === 'seek')).toEqual([{ type: 'seek', cycle: 300 }])
    expect(frames).toEqual([2000, 300])
  })

  it('drops the old battle once a new load is on its way', async () => {
    const arena = client()
    await load(arena)
    const frames: number[] = []
    arena.on('frame', (f) => frames.push(f.cycle))
    arena.step(5000)
    const loaded = arena.once('loaded')
    const full = arena.once('frame')
    arena.load([fighter('imp'), fighter('stone')], { seed: 3 })
    expect((await loaded).botMeta.map((b) => b.name)).toEqual(['Imp', 'Stone'])
    expect((await full).cycle).toBe(0)
    expect(frames).toEqual([0])
    expect(state(arena)).toMatchObject({ status: 'paused', cycle: 0 })
  })

  it('reports a load that fails', async () => {
    const arena = client()
    const errors: (string | null)[] = []
    const both = new Promise<void>((resolve) => {
      arena.on('error', (e) => {
        errors.push(e.request)
        if (errors.length === 2) resolve()
      })
    })
    arena.load(DUEL, { seed: 1, minSpacing: 40_000 })
    // Play goes out while the load is on its way, and fails too: there is no battle.
    arena.play()
    await both
    expect(errors).toEqual(['load', 'play'])
    expect(state(arena).status).toBe('error')
    expect(state(arena).error).toContain('cannot place bot 1')
  })

  it('plays a match: the store holds the round, its order, the match, and the keyframes', async () => {
    const arena = client()
    const bots = [fighter('dwarf'), fighter('imp')]
    const config = { seed: 2, maxCycles: 20_000 }
    const loaded = arena.once('loaded')
    arena.load(bots, config, 2)
    await loaded
    expect(state(arena)).toMatchObject({ round: 0, rounds: 2, order: [0, 1], reached: 0 })
    expect(state(arena).match?.rounds).toEqual([])

    const ended = arena.once('ended')
    arena.seek(20_000)
    const first = await ended
    expect(first.round).toBe(0)
    expect(state(arena)).toMatchObject({ status: 'ended', reached: first.result.cycles })
    expect(state(arena).match).toEqual(first.match)
    expect(first.match.rounds).toEqual(runMatch(bots, config, 2).rounds.slice(0, 1))
    expect(Array.from(state(arena).keyframes)).toEqual([1000, 2000, 3000])

    const next = arena.once('loaded')
    const full = arena.once('frame')
    arena.setRound(1)
    expect(await next).toMatchObject({ round: 1, order: [1, 0] })
    await full
    expect(state(arena)).toMatchObject({ status: 'paused', round: 1, cycle: 0, reached: 0 })
    expect(state(arena).result).toBeNull()
    const last = arena.once('ended')
    arena.seek(20_000)
    expect((await last).match).toEqual(runMatch(bots, config, 2))
    expect(state(arena).match).toEqual(runMatch(bots, config, 2))
  })
})
