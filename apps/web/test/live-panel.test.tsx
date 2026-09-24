/**
 * The live panel (src/features/live): the room's `LIVE` chip and count; auto-watch running each
 * match the room starts at max speed, its rounds in turn, and checking it against the server's
 * row (`verifying`, then `verified` or `mismatch`); a match that starts while one plays waits its
 * turn; auto-watch off, a quiet room, and an out-of-date page. And `useLiveRoom`'s socket, open
 * while a page asks for the room.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { LiveMessage } from '@asmbots/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createStore, type StoreApi, useStore } from 'zustand'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { LivePanel } from '../src/features/live/LivePanel'
import { IDLE_ROOM, type LiveRoomState, reduceLive } from '../src/features/live/room'
import { useLiveRoom } from '../src/features/live/useLiveRoom'
import { renderAt } from './api-server'
import { stubCanvas } from './fake-canvas'
import { FakeSockets, FakeTimers, type LiveDuel, liveDuel } from './live-fakes'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

useDom()
window.scrollTo = () => {}

const JOB = 'hill:main:s1'
const HELLO: LiveMessage = {
  type: 'hello',
  protocol: 1,
  room: { kind: 'hill', id: 'h1' },
  now: '2026-09-24T12:00:00.000Z',
}
const running = (done = 0, job = JOB) =>
  ({ type: 'progress', job, status: 'running', done, of: 3 }) as const
const started = (duel: LiveDuel, job = JOB) =>
  ({ type: 'matchStarted', job, match: duel.match }) as const
const finished = (duel: LiveDuel, job = JOB) =>
  ({ type: 'matchFinished', job, match: duel.finished }) as const

const made: { client: ArenaClient; worker: SessionWorker }[] = []
const frames = manualSchedule()
function createClient(): ArenaClient {
  const next = sessionClient(frames.schedule)
  made.push(next)
  return next.client
}

let restore: (() => void)[] = []
beforeAll(() => {
  restore = [
    stubCanvas(window),
    stubLayout('clientWidth', () => 400),
    stubLayout('clientHeight', () => 400),
  ]
})
afterAll(() => {
  for (const undo of restore) undo()
  for (const { client } of made.splice(0)) client.dispose()
})

/** The panel on a room the test tells: `say` puts messages through the page's reducer. */
async function panel(...messages: LiveMessage[]) {
  const room: StoreApi<LiveRoomState> = createStore<LiveRoomState>()(() =>
    messages.reduce(reduceLive, { ...IDLE_ROOM, status: 'connecting' }),
  )
  function Harness() {
    const live = useStore(room)
    return <LivePanel live={live} createClient={createClient} dwell={0} rest={0} />
  }
  await renderAt('/hills/main', () => <Harness />, '/hills/$slug')
  const say = (...more: LiveMessage[]) =>
    act(() => room.setState(more.reduce(reduceLive, room.getState())))
  return { room, say, region: screen.getByRole('region', { name: 'live' }) }
}

/** Plays display frames until the check chip reads `state`: each frame runs to a round's end. */
async function playUntil(state: string) {
  await waitFor(
    () => {
      act(() => frames.tick())
      const chip = document.querySelector('[data-check]')
      expect(chip?.getAttribute('data-check')).toBe(state)
    },
    { timeout: 3000 },
  )
}

const shownMatch = () =>
  document.querySelector('[data-live-match]')?.getAttribute('data-live-match')

describe('LivePanel', () => {
  it("runs the room's match at max speed, and verifies it when the server's row comes", async () => {
    const duel = await liveDuel('s1-1', 2)
    const { say, region } = await panel(
      HELLO,
      { type: 'spectators', count: 2 },
      running(0),
      started(duel),
    )
    const chip = region.querySelector('[data-status]')
    expect(chip?.getAttribute('data-status')).toBe('live')
    expect(chip?.getAttribute('data-live')).toBe('true')
    expect(within(region).getByText('2 watching')).toBeDefined()
    expect(region.textContent).toContain('match 1 of 3')

    await waitFor(() => expect(shownMatch()).toBe('s1-1'))
    const worker = (made.at(-1) as (typeof made)[0]).worker
    expect(worker.sent.find((r) => r.type === 'speed')).toMatchObject({ cyclesPerFrame: 'max' })
    const load = worker.sent.find((r) => r.type === 'load')
    expect(load).toMatchObject({ rounds: 2, config: { maxCycles: 200, seed: 1 } })
    expect(within(region).getByRole('list', { name: 'bots' }).textContent).toBe('LoopDat')

    // Both rounds played here, one after the other; the server has not said yet.
    const arena = (made.at(-1) as (typeof made)[0]).client
    await waitFor(() => {
      act(() => frames.tick())
      expect(arena.store.getState()).toMatchObject({ status: 'ended', round: 1 })
    })
    expect(worker.sent.filter((r) => r.type === 'setRound')).toEqual([
      { type: 'setRound', round: 1 },
    ])
    expect(region.querySelector('[data-check]')?.textContent).toBe('verifying')

    say(finished(duel), running(1))
    await playUntil('verified')
    expect(within(region).getByRole('link', { name: 'watch' }).getAttribute('href')).toBe(
      `/arena/${'c'.repeat(64)}`,
    )
  })

  it("says mismatch when the server's row differs from the run here", async () => {
    const duel = await liveDuel('s2-1', 2)
    const rounds = duel.finished.result?.rounds ?? []
    const forged: LiveDuel = {
      ...duel,
      finished: {
        ...duel.finished,
        result: duel.finished.result && {
          ...duel.finished.result,
          rounds: rounds.map((r, i) => (i === 1 ? { ...r, resultHash: '0000000000000000' } : r)),
        },
      },
    }
    await panel(HELLO, running(0), started(forged), finished(forged))
    await playUntil('mismatch')
    expect(document.querySelector('[data-check]')?.getAttribute('title')).toContain(
      'round 2: result',
    )
  })

  it('lets a match that starts while one plays wait, then shows the latest', async () => {
    const one = await liveDuel('s3-1', 1)
    const two = await liveDuel('s3-2', 1)
    const { say } = await panel(HELLO, running(0), started(one))
    await waitFor(() => expect(shownMatch()).toBe('s3-1'))
    say(finished(one), running(1), started(two))
    expect(shownMatch()).toBe('s3-1')
    await playUntil('verified')
    // Rested (0 ms here): the room's latest comes on.
    await waitFor(() => expect(shownMatch()).toBe('s3-2'))
  })

  it('shows the match in words with auto-watch off, and ends the arena', async () => {
    const duel = await liveDuel('s4-1', 1)
    const { region } = await panel(HELLO, running(0), started(duel))
    await waitFor(() => expect(shownMatch()).toBe('s4-1'))
    const worker = (made.at(-1) as (typeof made)[0]).worker
    fireEvent.click(within(region).getByRole('button', { name: 'auto-watch' }))
    expect(shownMatch()).toBeUndefined()
    expect(worker.terminated).toBe(true)
    expect(region.textContent).toContain('fighting: Loop v Dat')
  })

  it('says the room is quiet with no job running, and asks an old page to reload', async () => {
    const { room, region } = await panel(HELLO)
    expect(region.textContent).toContain('quiet: no match is running')
    const chip = () => region.querySelector('[data-status]')
    expect(chip()?.getAttribute('data-status')).toBe('live')
    expect(chip()?.getAttribute('data-live')).toBeNull()
    act(() => room.setState({ status: 'outdated' }))
    expect(chip()?.getAttribute('data-status')).toBe('outdated')
    expect(within(region).getByRole('button', { name: 'reload' })).toBeDefined()
  })
})

describe('useLiveRoom', () => {
  function Probe({ room, sockets }: { room: string | null; sockets: FakeSockets }) {
    const live = useLiveRoom(room, { createSocket: sockets.create, timers: new FakeTimers() })
    return <p data-testid="probe">{live.status}</p>
  }

  it("opens the room's socket while asked, and closes it after", () => {
    const sockets = new FakeSockets()
    const view = render(<Probe room="hill:h1" sockets={sockets} />)
    expect(sockets.all).toHaveLength(1)
    expect(sockets.last.url).toBe('ws://localhost/api/live/hill%3Ah1')
    act(() => {
      sockets.last.open()
      sockets.last.receive(HELLO)
    })
    expect(screen.getByTestId('probe').textContent).toBe('live')
    view.rerender(<Probe room={null} sockets={sockets} />)
    expect(sockets.last.closedWith).toBe(1000)
    expect(screen.getByTestId('probe').textContent).toBe('idle')
    view.unmount()
    expect(sockets.all).toHaveLength(1)
  })
})
