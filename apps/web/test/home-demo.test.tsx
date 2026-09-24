/**
 * The home page's demo battle (PRODUCT_SPEC §1): its bots and seeds, `DemoLoop`'s battles one
 * after another at 400 cycles a frame, paused out of sight, the reduced-motion still, and
 * `HomeDemo` in jsdom on a real `ArenaClient` whose Worker is an `ArenaSession` in the same thread.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { DEFAULT_CONFIG, Pcg32, PlacementError, place } from '@asmbots/engine'
import { parseHex } from '@asmbots/ui'
import { BOT_HUES } from '@asmbots/ui/themes'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import {
  DEMO_SLUGS,
  DemoLoop,
  demoBots,
  demoSeed,
  paintStill,
  STILL_CYCLE,
  STILL_SEED,
  stillFrame,
} from '../src/features/arena/demo/demo'
import { HomeDemo } from '../src/features/arena/demo/HomeDemo'
import { OWNED, OWNED_ZERO, SIDE } from '../src/features/arena/render/scene'
import type { ArenaBot } from '../src/features/arena/worker/protocol'
import { useSettings } from '../src/store/settings'
import { fakeContext, stubCanvas } from './fake-canvas'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

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

describe('the demo’s bots and seeds', () => {
  it('fights the painters, Dwarf, and Paper, as the roster assembles them', () => {
    const bots = demoBots()
    expect(bots.map((bot) => bot.name)).toEqual(['LCG Painter', 'Spiral Painter', 'Dwarf', 'Paper'])
    expect(bots.map((bot) => [...bot.bytes])).toEqual(
      DEMO_SLUGS.map((slug) => [...fighter(slug).bytes]),
    )
  })

  it('draws a seed the bots place with, and falls back to the still’s', () => {
    expect(demoSeed(demoBots(), draws(7))).toBe(7)
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
    // Four never fit: 32 draws, then the still's seed.
    expect(demoSeed(big(4), () => 1)).toBe(STILL_SEED)
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
      bots: demoBots(),
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

describe('the still', () => {
  it('is battle 62 at cycle 24,000, all four alive, painted as the 2D renderer paints', async () => {
    const { client } = sessionClient(manualSchedule().schedule)
    clients.push(client)
    const frame = await stillFrame(client, demoBots())
    expect(frame).toMatchObject({ cycle: STILL_CYCLE, alive: 4, over: false })
    expect(client.store.getState().config?.seed).toBe(STILL_SEED)
    const owner = frame.ownerDirty as Uint8Array
    const bytes = frame.bytesDirty as Uint8Array

    let painted: ImageData | null = null
    const context = fakeContext()
    context.putImageData = (image: ImageData) => {
      painted = image
    }
    const canvas = { getContext: () => context } as unknown as HTMLCanvasElement
    paintStill(canvas, frame, 'sentinel')
    const image = painted as ImageData | null
    if (image === null) throw new Error('nothing painted')
    expect([image.width, image.height]).toEqual([SIDE, SIDE])
    const tags = new Set<number>()
    for (let a = 0; a < SIDE * SIDE; a += 97) {
      const tag = owner[a] as number
      tags.add(tag)
      const [r, g, b] = [0, 1, 2].map((k) => image.data[a * 4 + k] as number)
      if (tag === 0) {
        expect([r, g, b]).toEqual([0, 0, 0])
        continue
      }
      const hue = parseHex(BOT_HUES.sentinel[tag - 1] as string)
      const share = bytes[a] === 0 ? OWNED_ZERO : OWNED
      ;[r, g, b].forEach((got, k) => {
        expect(Math.abs(got - (hue[k] as number) * share)).toBeLessThanOrEqual(1)
      })
    }
    // Every bot owns some of what the still shows, and so does nobody.
    expect([...tags].sort()).toEqual([0, 1, 2, 3, 4])
  })
})

describe('HomeDemo', () => {
  let restore: (() => void)[] = []
  beforeAll(() => {
    restore = [
      stubCanvas(window),
      stubLayout('clientWidth', () => 800),
      stubLayout('clientHeight', () => 320),
    ]
  })
  afterAll(() => {
    for (const undo of restore) undo()
    // Once the last demo is gone: a demo still up would switch between battle and still.
    useSettings.setState({ motion: 'system' })
  })

  function renderDemo() {
    const frames = manualSchedule()
    const made: ReturnType<typeof sessionClient>[] = []
    const onStatus = mock((_status: string) => {})
    const view = render(
      <div className="relative">
        <HomeDemo
          onStatus={onStatus}
          createClient={() => {
            const next = sessionClient(frames.schedule)
            made.push(next)
            clients.push(next.client)
            return next.client
          }}
        />
      </div>,
    )
    return { ...view, frames, made, onStatus }
  }

  it('plays the battle as a picture with no controls, and names its bots', async () => {
    useSettings.setState({ motion: 'full' })
    const { made, frames, onStatus, container } = renderDemo()
    const arena = await screen.findByRole('img', {
      name: 'demo battle: LCG Painter, Spiral Painter, Dwarf, Paper',
    })
    expect(container.querySelector('[data-demo]')?.getAttribute('data-demo')).toBe('live')
    expect(arena.getAttribute('tabindex')).toBeNull()
    expect(screen.queryByRole('application')).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
    const { client, worker } = made[made.length - 1] as (typeof made)[number]
    const seed = loadedSeeds(worker)[0] as number
    expect(onStatus).toHaveBeenCalledWith(`4 bots · seed ${seed}`)
    await settle()
    expect(client.store.getState()).toMatchObject({ status: 'playing', speed: 400 })
    frames.tick()
    await settle()
    expect(client.store.getState().cycle).toBe(400)
    const legend = screen.getByRole('list', { name: "the demo's bots" })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['LCG Painter', 'Spiral Painter', 'Dwarf', 'Paper'])
  })

  it('pauses while the tab is hidden, and its Worker ends with it', async () => {
    useSettings.setState({ motion: 'full' })
    const { made, unmount } = renderDemo()
    await screen.findByRole('img', { name: /^demo battle:/ })
    await settle()
    const { client, worker } = made[made.length - 1] as (typeof made)[number]
    expect(client.store.getState().status).toBe('playing')
    const visibility = Object.getOwnPropertyDescriptor(window.document, 'visibilityState')
    const set = (state: string) =>
      act(() => {
        Object.defineProperty(window.document, 'visibilityState', {
          configurable: true,
          get: () => state,
        })
        window.document.dispatchEvent(new window.Event('visibilitychange'))
      })
    try {
      set('hidden')
      expect(client.store.getState().status).toBe('paused')
      set('visible')
      expect(client.store.getState().status).toBe('playing')
    } finally {
      if (visibility === undefined) Reflect.deleteProperty(window.document, 'visibilityState')
      else Object.defineProperty(window.document, 'visibilityState', visibility)
    }
    unmount()
    expect(worker.terminated).toBe(true)
  })

  it('shows the still under reduced motion, and lets its Worker go', async () => {
    useSettings.setState({ motion: 'reduce' })
    const { made, onStatus, container } = renderDemo()
    const still = await screen.findByRole('img', {
      name: 'demo battle at cycle 24,000: the core as LCG Painter, Spiral Painter, Dwarf, Paper own it',
    })
    expect(still.tagName).toBe('CANVAS')
    expect([still.getAttribute('width'), still.getAttribute('height')]).toEqual(['256', '256'])
    expect(container.querySelector('[data-demo]')?.getAttribute('data-demo')).toBe('still')
    expect(onStatus).toHaveBeenCalledWith('4 bots · seed 62 · cycle 24,000')
    const { worker } = made[made.length - 1] as (typeof made)[number]
    expect(worker.sent.map((request) => request.type)).toEqual(['load', 'seek'])
    await waitFor(() => expect(worker.terminated).toBe(true))
    expect(screen.getAllByRole('listitem').map((item) => item.dataset.alive)).toEqual([
      'true',
      'true',
      'true',
      'true',
    ])
  })
})
