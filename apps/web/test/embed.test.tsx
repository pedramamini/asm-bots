/**
 * The embed (`/embed/arena`, `/embed/arena/$replayId`, PRODUCT_SPEC §10): the arena with no frame
 * for another site's `<iframe>`. The route in the app's own route tree draws no header, ticker, or
 * status bar; the battle an arena link names plays as it loads (a real `ArenaClient` on an
 * `ArenaSession` in the test's thread), or waits for `play` under reduced motion; a replay plays
 * from its link's fragment or the server's store; and what keeps a link from a battle is said.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { encodeSources, type Replay } from '@asmbots/protocol'
import { runMatch } from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import { buildReplay, replayUrl } from '../src/features/arena/battle/replay'
import { assembleCached } from '../src/features/arena/setup/assembly'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { EmbedReplay, EmbedSetup, embedFight } from '../src/features/embed/EmbedArena'
import { stringifySearch } from '../src/router'
import { routeTree } from '../src/routeTree.gen'
import { useSettings } from '../src/store/settings'
import { answer, refuse, testQueryClient, useApiServer, WithQueries } from './api-server'
import { stubCanvas } from './fake-canvas'
import { manualSchedule, SessionWorker, sessionClient } from './session-worker'

useDom()
window.scrollTo = () => {}
const server = useApiServer()

const DUEL = '/embed/arena?b=roster:dwarf,roster:imp&seed=1'

const clients: ArenaClient[] = []
const workers: SessionWorker[] = []

/** A client on a Worker in this thread, whose display frames come when the test ticks. */
function makeClient() {
  const frames = manualSchedule()
  const made = sessionClient(frames.schedule)
  clients.push(made.client)
  workers.push(made.worker)
  return made.client
}

/** The embed routes alone in a memory router at `url`, their clients made by `makeClient`. */
async function renderEmbed(url: string) {
  const root = createRootRoute({ component: Outlet })
  const setup = createRoute({
    getParentRoute: () => root,
    path: 'embed/arena',
    validateSearch: validateArenaSearch,
    component: () => <EmbedSetup createClient={makeClient} />,
  })
  const replay = createRoute({
    getParentRoute: () => root,
    path: 'embed/arena/$replayId',
    component: function Replay() {
      const { replayId } = replay.useParams()
      return <EmbedReplay replayId={replayId} createClient={makeClient} />
    },
  })
  const router = createRouter({
    routeTree: root.addChildren([setup, replay]),
    history: createMemoryHistory({ initialEntries: [url] }),
    stringifySearch,
  })
  render(
    <WithQueries>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </WithQueries>,
  )
  await act(() => router.load())
  return router
}

/** Lets the Worker's answers in, and React draw them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** A replay of Dwarf and Imp at seed 1: Dwarf wins it. */
async function duelReplay(rounds = 1): Promise<Replay> {
  const bots = [fighter('dwarf'), fighter('imp')].map(({ name, bytes, meta }) => ({
    name,
    bytes,
    meta,
  }))
  const config = { maxCycles: 100_000, maxProcesses: 64, minSpacing: 1024, seed: 1 }
  const match = runMatch(bots, config, rounds)
  return buildReplay(bots, [], config, rounds, match)
}

let restore: (() => void)[] = []
beforeAll(() => {
  restore = [
    stubCanvas(window),
    stubLayout('clientWidth', () => 800),
    stubLayout('clientHeight', () => 450),
  ]
})
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
  workers.length = 0
  useSettings.setState({ motion: 'system' })
})
afterAll(() => {
  for (const undo of restore) undo()
})

describe('embedFight', () => {
  it('fights the bots and seed an arena link names', () => {
    const search = validateArenaSearch({ b: 'roster:dwarf,roster:imp', seed: '7' })
    // The roster comes prebuilt: no assembler.
    const read = embedFight(search, '', null)
    if (!('fight' in read)) throw new Error(JSON.stringify(read))
    expect(read.fight.bots.map((bot) => bot.name)).toEqual(['Dwarf', 'Imp'])
    expect(read.fight.config.seed).toBe(7)
    expect(read.fight.rounds).toBe(1)
  })

  it('fights a bot its fragment carries, and says what keeps a link from a battle', () => {
    const search = validateArenaSearch({ b: 'roster:dwarf,local:x1' })
    const carried = encodeSources([{ id: 'x1', source: '%name "Spin"\nstart: jmp $\n' }])
    expect(embedFight(search, carried, null)).toEqual({ pending: true })
    const read = embedFight(search, carried, assembleCached)
    if (!('fight' in read)) throw new Error(JSON.stringify(read))
    expect(read.fight.bots.map((bot) => bot.name)).toEqual(['Dwarf', 'Spin'])
    // A random seed that places them, as the arena draws one.
    expect(Number.isInteger(read.fight.config.seed)).toBe(true)

    expect(embedFight(validateArenaSearch({}), '', assembleCached)).toEqual({
      problem: 'this embed names no battle.',
    })
    expect(embedFight(search, '', assembleCached)).toEqual({
      problem: 'this embed names a bot it does not carry.',
    })
    const broken = encodeSources([{ id: 'x1', source: 'mov ax,' }])
    expect(embedFight(search, broken, assembleCached)).toEqual({
      problem: 'a bot of this embed does not assemble.',
    })
  })
})

describe('/embed/arena in the app', () => {
  it('draws the arena alone: no header, no ticker, no status bar', async () => {
    // The app's own route tree and root, whose embed makes its client the app's way.
    const real = globalThis.Worker
    globalThis.Worker = function (this: unknown) {
      const worker = new SessionWorker()
      workers.push(worker)
      return worker
    } as unknown as typeof Worker
    try {
      const router = createRouter({
        routeTree,
        context: { queryClient: testQueryClient() },
        history: createMemoryHistory({ initialEntries: [DUEL] }),
        stringifySearch,
      })
      render(
        <QueryClientProvider client={router.options.context.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
      await act(() => router.load())
      const main = await screen.findByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
      expect(screen.queryByRole('banner')).toBeNull()
      expect(screen.queryByRole('navigation')).toBeNull()
      expect(document.querySelector('header')).toBeNull()
      expect(document.body.textContent).not.toContain('made with maestro')
      expect(
        within(main).getByRole('img', { name: 'ASM BOTS: Dwarf vs Imp: the arena' }),
      ).toBeTruthy()
      await waitFor(() => expect(document.title).toBe('ASM BOTS // EMBED'))
      await waitFor(() => expect(workers[0]?.sent.map((request) => request.type)).toContain('play'))
    } finally {
      globalThis.Worker = real
      for (const worker of workers) worker.terminate()
    }
  })
})

describe('the embed', () => {
  it('plays the battle as it loads, names its bots, and links the arena at the same battle', async () => {
    await renderEmbed(DUEL)
    const main = await screen.findByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
    await waitFor(() => expect(clients[0]?.store.getState().status).toBe('playing'))
    expect(workers[0]?.sent[0]).toMatchObject({ type: 'load', config: { seed: 1 } })
    const legend = within(main).getByRole('list', { name: 'bots' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Dwarf', 'Imp'])
    const watch = within(main).getByRole('link', { name: 'watch on asmbots' })
    expect(watch.getAttribute('href')).toBe(
      'http://localhost/arena?b=roster:dwarf,roster:imp&seed=1',
    )
    expect(watch.getAttribute('target')).toBe('_blank')
    expect(within(main).getByRole('button', { name: 'pause' })).toBeTruthy()
  })

  it('pauses, plays, restarts, and says who won at the end', async () => {
    await renderEmbed(DUEL)
    const main = await screen.findByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
    const client = await waitFor(() => {
      const made = clients[0]
      expect(made?.store.getState().status).toBe('playing')
      return made as ArenaClient
    })
    fireEvent.click(within(main).getByRole('button', { name: 'pause' }))
    await waitFor(() => expect(client.store.getState().status).toBe('paused'))
    fireEvent.click(within(main).getByRole('button', { name: 'play' }))
    await waitFor(() => expect(client.store.getState().status).toBe('playing'))

    client.seek(100_000)
    await settle()
    await waitFor(() => expect(client.store.getState().status).toBe('ended'))
    expect(within(main).getByText('winner · Dwarf')).toBeTruthy()
    expect(within(main).getByRole('button', { name: 'play' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(main).getByRole('button', { name: 'restart' }))
    await waitFor(() =>
      expect(client.store.getState()).toMatchObject({ status: 'playing', cycle: 0 }),
    )
    expect(within(main).queryByText('winner · Dwarf')).toBeNull()
  })

  it('waits for play under reduced motion', async () => {
    useSettings.setState({ motion: 'reduce' })
    await renderEmbed(DUEL)
    const main = await screen.findByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
    await waitFor(() => expect(clients[0]?.store.getState().status).toBe('paused'))
    expect(workers[0]?.sent.map((request) => request.type)).not.toContain('play')
    fireEvent.click(within(main).getByRole('button', { name: 'play' }))
    await waitFor(() => expect(clients[0]?.store.getState().status).toBe('playing'))
  })

  it('says what keeps a link from a battle, and still links the arena', async () => {
    await renderEmbed('/embed/arena?b=roster:dwarf,local:gone')
    const main = await screen.findByRole('main', { name: 'ASM BOTS embed' })
    expect(main.textContent).toContain('this embed names a bot it does not carry.')
    expect(within(main).getByRole('link', { name: 'watch on asmbots' })).toBeTruthy()
    expect(clients).toEqual([])
  })
})

describe('a replay’s embed', () => {
  it('plays the replay its link carries', async () => {
    const replay = await duelReplay()
    const link = new URL(replayUrl('http://localhost', replay))
    await renderEmbed(`/embed${link.pathname}${link.hash}`)
    await screen.findByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
    await waitFor(() => expect(clients[0]?.store.getState().status).toBe('playing'))
    expect(workers[0]?.sent[0]).toMatchObject({ type: 'load', rounds: 1 })
  })

  it('plays a replay the server stores', async () => {
    const replay = await duelReplay()
    const key = 'a'.repeat(64)
    server.use(answer(`/replays/${key}`, replay))
    await renderEmbed(`/embed/arena/${key}`)
    await screen.findByRole('main', { name: 'ASM BOTS: Dwarf vs Imp' })
    await waitFor(() => expect(clients[0]?.store.getState().status).toBe('playing'))
  })

  it('says when the server has no replay by that key, or the link carries none', async () => {
    const key = 'b'.repeat(64)
    server.use(refuse(`/replays/${key}`, 404, 'not_found', `no replay ${key}`))
    await renderEmbed(`/embed/arena/${key}`)
    expect(await screen.findByText('the server has no replay with this key.')).toBeTruthy()
  })

  it('says so when the link carries no replay and its id is not a key', async () => {
    await renderEmbed('/embed/arena/not-a-key')
    expect(await screen.findByText('this embed carries no replay.')).toBeTruthy()
  })
})
