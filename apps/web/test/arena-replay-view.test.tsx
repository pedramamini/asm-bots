/**
 * `/arena/$replayId` in jsdom (PRODUCT_SPEC §2): `ReplayPage` reads the replay from the link's
 * fragment and plays it in the battle view on a real `ArenaClient`, whose Worker is an
 * `ArenaSession` in the same thread. The chip says `verifying`, then `verified` or `mismatch`;
 * `share`, `download replay`, and `setup` do the replay's own things.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fighter } from '@asmbots/bots'
import type { BattleConfigInput } from '@asmbots/engine'
import { type Replay, replayConfig, replayKey } from '@asmbots/protocol'
import { runMatch } from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import {
  buildReplay,
  readReplayFragment,
  replayFragment,
  replayUrl,
} from '../src/features/arena/battle/replay'
import { useArenaView } from '../src/features/arena/battle/view'
import { ReplayPage } from '../src/features/arena/ReplayPage'
import type { ArenaClient } from '../src/features/arena/worker/client'
import type { ArenaBot } from '../src/features/arena/worker/protocol'
import { answer, answerPost, refuse, useApiServer, WithQueries } from './api-server'
import { stubCanvas } from './fake-canvas'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'
import { pickShare } from './share-menu'

useDom()
window.scrollTo = () => {}
const server = useApiServer()

/** Dwarf beats Imp at seed 1 in cycle 16,140. */
const BOTS: readonly ArenaBot[] = ['dwarf', 'imp'].map((slug) => {
  const { name, bytes, meta } = fighter(slug)
  return { name, bytes, meta }
})
const CONFIG: BattleConfigInput = {
  maxCycles: 100_000,
  maxProcesses: 64,
  minSpacing: 1024,
  seed: 1,
}

/** The replay of `rounds` rounds of Dwarf vs Imp from seed 1, as a link carries it. */
async function duel(rounds = 1): Promise<Replay> {
  const match = runMatch(BOTS, CONFIG, rounds)
  return buildReplay(BOTS, [], CONFIG, rounds, match, new Date(0))
}

interface Made {
  client: ArenaClient
  worker: SessionWorker
}

const made: Made[] = []

/** The replay page at `path` in a memory router, with `/arena` beside it. */
async function renderAt(path: string) {
  const frames = manualSchedule()
  const createClient = () => {
    const next = sessionClient(frames.schedule)
    made.push(next)
    return next.client
  }
  const root = createRootRoute({ component: Outlet })
  const replay = createRoute({
    getParentRoute: () => root,
    path: 'arena/$replayId',
    component: function Replay() {
      const { replayId } = replay.useParams()
      return <ReplayPage replayId={replayId} createClient={createClient} />
    },
  })
  const setup = createRoute({
    getParentRoute: () => root,
    path: 'arena',
    component: () => <p>the setup</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([replay, setup]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <WithQueries>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </WithQueries>,
  )
  await act(() => router.load())
  return { router, frames }
}

/** The replay page of `replay`'s link, loaded: its client and its Worker. */
async function renderReplay(replay: Replay) {
  const link = new URL(replayUrl('http://localhost', replay))
  const page = await renderAt(`${link.pathname}${link.hash}`)
  await screen.findByRole('application', { name: 'arena' })
  const last = made[made.length - 1] as Made
  await waitFor(() => expect(last.client.store.getState().status).toBe('playing'))
  return { ...page, ...last }
}

/** Lets the Worker's answers in, the digests finish, and React draw them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The chip in the arena's header. */
function chip(): HTMLElement {
  const found = screen
    .getByRole('region', { name: 'arena' })
    .querySelector<HTMLElement>('header [data-check]')
  if (found === null) throw new Error('no chip in the arena header')
  expect(found.getAttribute('role')).toBe('status')
  return found
}

let restore: (() => void)[] = []
beforeAll(() => {
  restore = [
    stubCanvas(window),
    stubLayout('clientWidth', () => 800),
    stubLayout('clientHeight', () => 600),
  ]
})
afterAll(() => {
  for (const undo of restore) undo()
  for (const { client } of made.splice(0)) client.dispose()
})
beforeEach(() => {
  useArenaView.setState({ isolated: [], minimap: true, autoplay: false, events: 'all' })
})

describe('a replay link', () => {
  it('plays at once, and verifies at the end with the replay’s own actions', async () => {
    const replay = await duel()
    const { client, worker } = await renderReplay(replay)
    expect(worker.sent[0]).toMatchObject({ type: 'load', rounds: 1, config: replayConfig(replay) })
    await settle()
    expect(chip().textContent).toBe('verifying')
    expect(chip().dataset.check).toBe('pending')
    expect(screen.getByRole('region', { name: 'arena' }).textContent).toContain('seed 1')

    client.seek(100_000)
    await settle()
    const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
    await waitFor(() => expect(chip().textContent).toBe('verified'))
    expect(chip().title).toBe('the result hash matches the recorded one')
    expect(within(victory).getByText('verified').dataset.check).toBe('verified')
    expect(victory.dataset.resultHash).toBe(replay.result.rounds[0]?.resultHash ?? '')
    for (const name of ['rematch', 'share ▾', 'download replay']) {
      expect(within(victory).getByRole('button', { name })).toBeTruthy()
    }
    // A replay's seed is its own, it names no setup, and its link is `share`'s.
    for (const name of ['new seed', 'open in debugger', 'replay link']) {
      expect(within(victory).queryByRole('button', { name })).toBeNull()
    }

    // Watch it again: it stays verified, and plays from the start.
    fireEvent.click(within(victory).getByRole('button', { name: 'rematch' }))
    await settle()
    expect(client.store.getState()).toMatchObject({ cycle: 0, status: 'playing' })
    expect(chip().textContent).toBe('verified')
  })

  it('shares its link as the server stores it, or its own when the server does not', async () => {
    const writeText = mock((_text: string) => Promise.resolve())
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    try {
      const replay = await duel()
      const key = await replayKey(replay)
      const seen: unknown[] = []
      const url = `http://localhost/arena/${key}`
      server.use(answerPost('/replays', { key, url }, 201, seen))
      const { client } = await renderReplay(replay)
      client.seek(100_000)
      await settle()
      const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
      await pickShare(victory, 'copy link')
      await screen.findByText('replay link copied.')
      expect(seen).toEqual([{ replay }])
      expect(writeText).toHaveBeenLastCalledWith(url)

      const refusal = { error: { code: 'unprocessable', message: 'no' } }
      server.use(answerPost('/replays', refusal, 422))
      await pickShare(victory, 'copy link')
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
      expect(writeText).toHaveBeenLastCalledWith(replayUrl('http://localhost', replay))
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })

  it('shares its own link, and saves the replay as it came', async () => {
    const writeText = mock((_text: string) => Promise.resolve())
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const created: Blob[] = []
    const saved: string[] = []
    const url = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob)
      return 'blob:replay'
    }
    URL.revokeObjectURL = () => {}
    const click = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download)
    }
    try {
      const replay = await duel()
      server.use(answerPost('/replays', { error: { code: 'internal', message: 'down' } }, 500))
      const { client } = await renderReplay(replay)
      client.seek(100_000)
      await settle()
      const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
      await pickShare(victory, 'copy link')
      await screen.findByText('replay link copied.')
      expect(writeText).toHaveBeenCalledWith(replayUrl('http://localhost', replay))
      fireEvent.click(within(victory).getByRole('button', { name: 'download replay' }))
      expect(saved).toEqual(['asmbots-dwarf-imp-1.asmreplay.json'])
      expect(JSON.parse(await (created[0] as Blob).text())).toEqual(replay)
    } finally {
      URL.createObjectURL = url.create
      URL.revokeObjectURL = url.revoke
      window.HTMLAnchorElement.prototype.click = click
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })

  it('says mismatch when the battle ends on another result hash', async () => {
    const replay = await duel()
    const round = replay.result.rounds[0] as Replay['result']['rounds'][0]
    const tampered: Replay = {
      ...replay,
      result: { ...replay.result, rounds: [{ ...round, resultHash: 'ffffffffffffffff' }] },
    }
    const { client } = await renderReplay(tampered)
    await settle()
    expect(chip().textContent).toBe('verifying')
    client.seek(100_000)
    await settle()
    const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
    await waitFor(() => expect(chip().textContent).toBe('mismatch'))
    const reason = `result ${round.resultHash}, recorded ffffffffffffffff`
    expect(chip().title).toBe(reason)
    expect(within(victory).getByText(reason).className).toContain('text-danger')
  })

  it('says mismatch at once when a bot’s bytes are not what its SHA-256 names', async () => {
    const replay = await duel()
    const [dwarf, imp] = replay.bots as [Replay['bots'][0], Replay['bots'][0]]
    const tampered = { ...replay, bots: [dwarf, { ...imp, sha256: '0'.repeat(64) }] }
    await renderReplay(tampered)
    await settle()
    await waitFor(() => expect(chip().textContent).toBe('mismatch'))
    expect(chip().title).toBe("Imp's bytes do not match their SHA-256")
  })

  it('verifies a match round by round', async () => {
    const replay = await duel(2)
    const { client } = await renderReplay(replay)
    client.seek(100_000)
    await settle()
    const between = await screen.findByRole('region', { name: 'round 1 over' })
    await waitFor(() => expect(chip().textContent).toBe('verified 1/2'))
    fireEvent.click(within(between).getByRole('button', { name: 'next round' }))
    await settle()
    expect(client.store.getState()).toMatchObject({ round: 1, status: 'playing' })
    client.seek(100_000)
    await settle()
    await screen.findByRole('region', { name: /^(winner|draw) · / })
    await waitFor(() => expect(chip().textContent).toBe('verified'))
    expect(chip().title).toBe('all 2 rounds match their recorded result hash')
  })

  it('goes to the setup with setup, and its Worker ends', async () => {
    const replay = await duel()
    const { router, worker } = await renderReplay(replay)
    fireEvent.click(screen.getByRole('button', { name: 'setup' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/arena'))
    await screen.findByText('the setup')
    expect(worker.terminated).toBe(true)
  })
})

describe('a stored replay', () => {
  it('loads from the server by its key, plays, verifies, and shares its short link', async () => {
    const writeText = mock((_text: string) => Promise.resolve())
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    try {
      const replay = await duel()
      const key = await replayKey(replay)
      server.use(answer(`/replays/${key}`, replay))
      await renderAt(`/arena/${key}`)
      await screen.findByRole('application', { name: 'arena' })
      const { client, worker } = made[made.length - 1] as Made
      await waitFor(() => expect(client.store.getState().status).toBe('playing'))
      expect(worker.sent[0]).toMatchObject({ type: 'load', config: replayConfig(replay) })
      client.seek(100_000)
      await settle()
      const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
      await waitFor(() => expect(chip().textContent).toBe('verified'))
      await pickShare(victory, 'copy link')
      await screen.findByText('replay link copied.')
      expect(writeText).toHaveBeenCalledWith(`http://localhost/arena/${key}`)
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })

  it('says the server has none for a key it does not know', async () => {
    const key = 'ef'.repeat(32)
    server.use(refuse(`/replays/${key}`, 404, 'not_found', `no replay ${key}`))
    const clients = made.length
    await renderAt(`/arena/${key}`)
    const panel = await screen.findByText('the server has no replay with this key.')
    expect(panel).toBeTruthy()
    expect(made).toHaveLength(clients)
  })

  it('says why a stored replay does not load, and asks again on retry', async () => {
    const key = '12'.repeat(32)
    let asked = 0
    server.use(
      http.get(`*/api/replays/${key}`, () => {
        asked++
        return HttpResponse.json({ isa: 'x16c-v1' })
      }),
    )
    await renderAt(`/arena/${key}`)
    expect(await screen.findByText(/^could not load this replay: /)).toBeTruthy()
    expect(asked).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(asked).toBe(2))
    expect(await screen.findByText(/^could not load this replay: /)).toBeTruthy()
  })
})

describe('a link with no replay', () => {
  it('says there is none, and offers the arena', async () => {
    const clients = made.length
    const { router } = await renderAt('/arena/0123456789abcdef')
    const panel = screen.getByRole('region', { name: 'replay' })
    expect(panel.textContent).toContain('0123456789abcdef')
    expect(panel.textContent).toContain('this link carries no replay.')
    // No Worker for nothing to play.
    expect(made).toHaveLength(clients)
    fireEvent.click(within(panel).getByRole('link', { name: /open the arena/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/arena'))
  })

  it('says why a broken one does not load', async () => {
    const replay = await duel()
    const cut = replayFragment(replay).slice(0, -40)
    expect(readReplayFragment(cut).kind).toBe('broken')
    await renderAt(`/arena/${replay.result.key}#${cut}`)
    expect(screen.getByRole('region', { name: 'replay' }).textContent).toContain(
      'this replay link is broken: it does not decode, so the link may be cut short.',
    )
  })
})
