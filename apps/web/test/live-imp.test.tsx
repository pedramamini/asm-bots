/**
 * The 404 page's live imp: where it lives (0x0404), how the view follows it, and `LiveImp` in
 * jsdom on a real `ArenaClient` whose Worker is an `ArenaSession` in the same thread.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { DEFAULT_CONFIG, Pcg32, place } from '@asmbots/engine'
import { act, render, screen } from '@testing-library/react'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import {
  followImp,
  IMP_ADDRESS,
  IMP_LAP,
  IMP_SEED,
  IMP_SPEED,
  IMP_STILL_CYCLE,
  impBot,
  impZoom,
  LiveImp,
} from '../src/features/arena/demo/LiveImp'
import { Camera, COLUMN_RULER, RULER_MARGIN } from '../src/features/arena/render/camera'
import { SIDE } from '../src/features/arena/render/scene'
import { useSettings } from '../src/store/settings'
import { stubCanvas } from './fake-canvas'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

useDom()

/** Lets the Worker's answers in, and React draw them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const clients: { dispose(): void }[] = []
afterAll(() => {
  for (const client of clients.splice(0)) client.dispose()
})

describe('where the imp lives', () => {
  it('is the roster’s imp, placed by its seed at 0x0404: the page’s address', () => {
    const imp = impBot()
    expect(imp.name).toBe('Imp')
    expect([...imp.bytes]).toEqual([...fighter('imp').bytes])
    expect(place([imp.bytes.length], DEFAULT_CONFIG.minSpacing, new Pcg32(IMP_SEED))).toEqual([
      IMP_ADDRESS,
    ])
  })
})

describe('the view', () => {
  it('zooms until the core’s 256 columns fill the width, 1x to 16x', () => {
    expect(impZoom(856, 160)).toBe(5)
    expect(impZoom(316, 160)).toBe(1)
    expect(impZoom(8000, 100)).toBe(16)
    expect(impZoom(0, 0)).toBe(1)
  })

  it('shows every column, and the imp’s row wherever it walks', () => {
    const camera = new Camera()
    expect(followImp(camera, IMP_ADDRESS)).toBe(false)
    camera.resize(900, 160)
    expect(followImp(camera, IMP_ADDRESS)).toBe(true)
    expect(camera.zoom).toBe(impZoom(900 - RULER_MARGIN, 160))
    const top = camera.visible()
    expect([top.left, top.right]).toEqual([0, SIDE])
    // The start: the core's first rows, the imp's among them, under the column ruler.
    expect(top.top).toBe(0)
    expect(top.bottom).toBeGreaterThan(IMP_ADDRESS >> 8)
    expect(camera.originY).toBe(COLUMN_RULER)
    for (const ip of [0x8000, 0xffff]) {
      followImp(camera, ip)
      const view = camera.visible()
      expect(view.top).toBeLessThanOrEqual(ip >> 8)
      expect(view.bottom).toBeGreaterThan(ip >> 8)
      expect([view.left, view.right]).toEqual([0, SIDE])
    }
  })
})

describe('LiveImp', () => {
  let restore: (() => void)[] = []
  beforeAll(() => {
    restore = [
      stubCanvas(window),
      stubLayout('clientWidth', () => 900),
      stubLayout('clientHeight', () => 160),
    ]
  })
  afterAll(() => {
    for (const undo of restore) undo()
    useSettings.setState({ motion: 'system' })
  })

  function renderImp() {
    const frames = manualSchedule()
    const made: { worker: SessionWorker; client: ReturnType<typeof sessionClient>['client'] }[] = []
    const view = render(
      <div className="relative h-40">
        <LiveImp
          createClient={() => {
            const next = sessionClient(frames.schedule)
            made.push(next)
            clients.push(next.client)
            return next.client
          }}
        />
      </div>,
    )
    return { ...view, frames, made }
  }

  it('walks the imp from 0x0404 as a picture, 2 cycles a frame, a lap of the core a battle', async () => {
    useSettings.setState({ motion: 'full' })
    const { made, frames, container, unmount } = renderImp()
    const arena = await screen.findByRole('img', { name: /^a live imp: it moved in at 0x0404/ })
    expect(container.querySelector('[data-imp]')?.getAttribute('data-imp')).toBe('live')
    expect(arena.getAttribute('tabindex')).toBeNull()
    const { client, worker } = made[made.length - 1] as (typeof made)[number]
    const load = worker.sent.find((request) => request.type === 'load')
    expect(load).toMatchObject({ config: { seed: IMP_SEED, maxCycles: IMP_LAP } })
    await settle()
    expect(client.store.getState()).toMatchObject({ status: 'playing', speed: IMP_SPEED })
    frames.tick()
    await settle()
    expect(client.store.getState().cycle).toBe(IMP_SPEED)
    unmount()
    expect(worker.terminated).toBe(true)
  })

  it('stands still under reduced motion: the imp 400 cycles in, and nothing plays', async () => {
    useSettings.setState({ motion: 'reduce' })
    const { made, container } = renderImp()
    const still = await screen.findByRole('img', {
      name: `an imp at cycle ${IMP_STILL_CYCLE}: it moved in at 0x0404, and copies itself one word ahead`,
    })
    expect(still.getAttribute('tabindex')).toBeNull()
    expect(container.querySelector('[data-imp]')?.getAttribute('data-imp')).toBe('still')
    const { client, worker } = made[made.length - 1] as (typeof made)[number]
    expect(worker.sent.find((request) => request.type === 'load')).toMatchObject({
      config: { seed: IMP_SEED },
    })
    await settle()
    expect(worker.sent.find((request) => request.type === 'seek')).toMatchObject({
      cycle: IMP_STILL_CYCLE,
    })
    expect(client.store.getState()).toMatchObject({ status: 'paused', cycle: IMP_STILL_CYCLE })
    expect(worker.sent.some((request) => request.type === 'play')).toBe(false)
  })
})
