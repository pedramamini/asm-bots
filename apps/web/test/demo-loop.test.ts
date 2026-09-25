/**
 * `DemoLoop` (the 404 page's imp plays on it): battles one after another at 400 cycles a frame,
 * each on a fresh seed that places its bots, paused out of sight, on a real `ArenaClient` whose
 * Worker is an `ArenaSession` in the same thread.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { DEFAULT_CONFIG, Pcg32, PlacementError, place } from '@asmbots/engine'
import { act } from '@testing-library/react'
import { useDom } from '../../../packages/ui/test/dom'
import { DemoLoop, demoSeed, FALLBACK_SEED } from '../src/features/arena/demo/demo'
import type { ArenaBot } from '../src/features/arena/worker/protocol'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

/** Four roster bots: two painters, a bomber, and a replicator. */
function bots(): ArenaBot[] {
  return ['painter-lcg', 'painter-spiral', 'dwarf', 'paper'].map((slug) => ({
    name: slug,
    bytes: fighter(slug).bytes,
  }))
}

useDom()

/** Draws `seeds` in order, then fails the test. */
function draws(...seeds: number[]): () => number {
  return () => {
    const seed = seeds.shift()
    if (seed === undefined) throw new Error('drew one seed too many')
    return seed
  }
}

/**
 * How long a test loop holds a battle's end, ms: longer than a seek to the end takes, so a test
 * sees the end before the next battle.
 */
const HOLD = 200

/** Lets the Worker's answers in, and React draw them. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The load requests `worker` got: their seeds. */
function loadedSeeds(worker: SessionWorker): number[] {
  return worker.sent.flatMap((request) =>
    request.type === 'load' ? [request.config.seed as number] : [],
  )
}

const clients: { dispose(): void }[] = []
afterAll(() => {
  for (const client of clients.splice(0)) client.dispose()
})

describe('demoSeed', () => {
  it('draws a seed the bots place with, and falls back to its own', () => {
    expect(demoSeed(bots(), draws(7))).toBe(7)
    // Three 20 KB images barely fit: some seeds place them and some do not.
    const big = (n: number): ArenaBot[] =>
      Array.from({ length: n }, (_, i) => ({ name: `big ${i}`, bytes: new Uint8Array(20_000) }))
    const places = (seed: number) => {
      try {
        place([20_000, 20_000, 20_000], DEFAULT_CONFIG.minSpacing, new Pcg32(seed))
        return true
      } catch (error) {
        if (error instanceof PlacementError) return false
        throw error
      }
    }
    const seeds = Array.from({ length: 200 }, (_, i) => i)
    const fails = seeds.find((seed) => !places(seed)) as number
    const fits = seeds.find((seed) => places(seed)) as number
    expect(demoSeed(big(3), draws(fails, fits))).toBe(fits)
    // Four never fit: 32 draws, then the fallback.
    expect(demoSeed(big(4), () => 1)).toBe(FALLBACK_SEED)
  })
})

describe('DemoLoop', () => {
  /** A loop on a session client: its display frames and its Worker. */
  function loopOf(options: { seeds: number[]; holdMs?: number }) {
    const frames = manualSchedule()
    const { client, worker } = sessionClient(frames.schedule)
    clients.push(client)
    const onBattle = mock((_seed: number) => {})
    const loop = new DemoLoop(client, {
      bots: bots(),
      random: draws(...options.seeds),
      holdMs: options.holdMs ?? HOLD,
      onBattle,
    })
    return { client, worker, frames, loop, onBattle }
  }

  it('plays each battle at 400 cycles a frame, holds its end, then the next seed', async () => {
    const { client, worker, frames, loop, onBattle } = loopOf({ seeds: [11, 22] })
    loop.start()
    expect(worker.sent.slice(0, 3).map((request) => request.type)).toEqual([
      'speed',
      'load',
      'play',
    ])
    expect(worker.sent[0]).toEqual({ type: 'speed', cyclesPerFrame: 400 })
    expect(onBattle).toHaveBeenCalledWith(11)
    await settle()
    expect(client.store.getState().status).toBe('playing')
    frames.tick()
    await settle()
    expect(client.store.getState().cycle).toBe(400)

    client.seek(DEFAULT_CONFIG.maxCycles)
    await settle()
    expect(client.store.getState().status).toBe('ended')
    expect(loadedSeeds(worker)).toEqual([11])
    // The end holds, then the next battle loads and plays.
    await settle(HOLD + 50)
    expect(loadedSeeds(worker)).toEqual([11, 22])
    expect(onBattle).toHaveBeenLastCalledWith(22)
    expect(client.store.getState()).toMatchObject({ status: 'playing', cycle: 0 })
    loop.dispose()
  })

  it('pauses out of sight, and plays on when seen again', async () => {
    const { client, worker, frames, loop } = loopOf({ seeds: [11] })
    loop.start()
    await settle()
    loop.setVisible(false)
    expect(client.store.getState().status).toBe('paused')
    // Nothing runs while paused: a display frame asks the Worker for nothing.
    const sent = worker.sent.length
    frames.tick()
    expect(worker.sent.slice(sent).map((request) => request.type)).toEqual([])
    loop.setVisible(true)
    expect(client.store.getState().status).toBe('playing')
    loop.dispose()
  })

  it('waits out of sight for the next battle, and starts it when seen', async () => {
    const { client, worker, loop } = loopOf({ seeds: [11, 22] })
    loop.start()
    await settle()
    client.seek(DEFAULT_CONFIG.maxCycles)
    await settle()
    loop.setVisible(false)
    await settle(HOLD + 50)
    expect(loadedSeeds(worker)).toEqual([11])
    loop.setVisible(true)
    expect(loadedSeeds(worker)).toEqual([11, 22])
    await settle()
    expect(client.store.getState().status).toBe('playing')
    loop.dispose()
  })

  it('starts nothing once disposed', async () => {
    const { client, worker, loop } = loopOf({ seeds: [11] })
    loop.start()
    await settle()
    client.seek(DEFAULT_CONFIG.maxCycles)
    await settle()
    loop.dispose()
    await settle(HOLD + 50)
    expect(loadedSeeds(worker)).toEqual([11])
  })
})
