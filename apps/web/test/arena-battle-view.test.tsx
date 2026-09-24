/**
 * `ArenaBattle` in jsdom (PRODUCT_SPEC §2), driven by a real `ArenaClient` whose Worker is an
 * `ArenaSession` in the same thread: the HUD, the transport, the keys of the app's registry, the
 * rail (isolation, the events log and its click-to-seek, the standings), the round between rounds
 * of a match, and the victory overlay's actions. The canvas has a fake 2D context: the pixels are
 * `e2e/arena-render.spec.ts`'s, the battle in Chromium `e2e/arena.spec.ts`'s.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { Battle, type LoadedBot, NullSink } from '@asmbots/engine'
import type { MatchResult } from '@asmbots/tourney'
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
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import { useKeymapListener } from '../src/app/keys'
import { ArenaBattle } from '../src/features/arena/ArenaBattle'
import { BattleLog } from '../src/features/arena/battle/log'
import { readReplayFragment } from '../src/features/arena/battle/replay'
import { useArenaView } from '../src/features/arena/battle/view'
import type { ArenaFight } from '../src/features/arena/setup/bots'
import { DEFAULT_ARENA_CONFIG } from '../src/features/arena/setup/config'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { stringifySearch } from '../src/router'
import { stubCanvas } from './fake-canvas'
import { manualSchedule, sessionClient } from './session-worker'

useDom()
window.scrollTo = () => {}

/** Dwarf beats Imp at seed 1 in cycle 16,140. */
const DUEL: readonly LoadedBot[] = [fighter('dwarf'), fighter('imp')]

function fightOf(rounds = 1, seed = 1): ArenaFight {
  return {
    bots: DUEL.map(({ name, bytes, meta }) => ({ name, bytes, meta })),
    config: { maxCycles: 100_000, maxProcesses: 64, minSpacing: 1024, seed },
    rounds,
    spec: {
      bots: [
        { kind: 'roster', slug: 'dwarf' },
        { kind: 'roster', slug: 'imp' },
      ],
      config: { ...DEFAULT_ARENA_CONFIG, rounds, seed: null },
    },
    sources: ['; dwarf', '; imp'],
    shared: [],
  }
}

function Keys() {
  useKeymapListener()
  return null
}

const clients: ArenaClient[] = []

/** The battle of `fight` on `/arena`, loaded, with the app's key listener. */
async function renderBattle(fight = fightOf()) {
  const frames = manualSchedule()
  const { client } = sessionClient(frames.schedule)
  clients.push(client)
  const log = new BattleLog()
  log.attach(client)
  const actions = { onExit: mock(() => {}), onRematch: mock(() => {}), onNewSeed: mock(() => {}) }
  const root = createRootRoute({
    component: () => (
      <>
        <Keys />
        <Outlet />
      </>
    ),
  })
  const arena = createRoute({
    getParentRoute: () => root,
    path: 'arena',
    component: () => (
      <ArenaBattle client={client} log={log} fight={fight} roundPause={10} {...actions} />
    ),
  })
  const editor = createRoute({
    getParentRoute: () => root,
    path: 'editor',
    validateSearch: validateArenaSearch,
    component: () => <p>the editor</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([arena, editor]),
    history: createMemoryHistory({ initialEntries: ['/arena'] }),
    stringifySearch,
  })
  client.load(fight.bots, fight.config, fight.rounds)
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
  await screen.findByRole('application', { name: 'arena' })
  await waitFor(() => expect(client.store.getState().status).toBe('paused'))
  return { client, log, router, frames, ...actions }
}

/** Lets the Worker's answers in, and React draw them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

const arena = () => screen.getByRole('application', { name: 'arena' })
const bots = () => screen.getByRole('table', { name: 'bots' })
const events = () => screen.getByRole('table', { name: 'events' })

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
  for (const client of clients.splice(0)) client.dispose()
})
beforeEach(() => {
  useArenaView.setState({ isolated: [], minimap: true, autoplay: false, events: 'all' })
})

describe('the battle', () => {
  it('shows the HUD, the bots, and the round’s first line', async () => {
    await renderBattle()
    expect(arena().textContent).toContain('cycle 0 / 100,000')
    expect(arena().textContent).toContain('100/f')
    expect(arena().textContent).toContain('zoom 1x')
    // jsdom has no WebGL2: the HUD says the arena draws in 2D.
    expect(within(arena()).getByText('2D').title).toContain('no WebGL2')
    expect(
      within(bots())
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual([
      'botprocsbyteswritesstatus',
      expect.stringMatching(/^Dwarf.*alive$/),
      expect.stringMatching(/^Imp.*alive$/),
    ])
    expect(events().textContent).toContain('seed 1')
    expect(screen.getByRole('region', { name: 'arena' }).textContent).toContain('seed 1')
  })

  it('steps with the transport and the keys, and back with , and step back', async () => {
    const { client } = await renderBattle()
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await settle()
    expect(client.store.getState().cycle).toBe(1)
    press('.')
    await settle()
    expect(client.store.getState().cycle).toBe(2)
    press(',')
    await settle()
    expect(client.store.getState().cycle).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'step back' }))
    await settle()
    expect(client.store.getState().cycle).toBe(0)
    expect(screen.getByRole('button', { name: 'step back' }).hasAttribute('disabled')).toBe(true)
  })

  it('plays and pauses with space, and steps the speed with [ and ]', async () => {
    const { client, frames } = await renderBattle()
    press(' ')
    expect(client.store.getState().status).toBe('playing')
    frames.tick()
    await settle()
    expect(client.store.getState().cycle).toBe(100)
    press(' ')
    expect(client.store.getState().status).toBe('paused')
    press(']')
    expect(client.store.getState().speed).toBe(200)
    press('[')
    press('[')
    expect(client.store.getState().speed).toBe(50)
    fireEvent.click(screen.getByRole('button', { name: 'max speed' }))
    expect(client.store.getState().speed).toBe('max')
    await settle()
    expect(arena().textContent).toContain('max')
    fireEvent.click(screen.getByRole('button', { name: 'back to 50/f' }))
    expect(client.store.getState().speed).toBe(50)
  })

  it('leaves space to a focused button', async () => {
    const { client } = await renderBattle()
    const step = screen.getByRole('button', { name: 'step' })
    step.focus()
    press(' ')
    expect(client.store.getState().status).toBe('paused')
  })

  it('isolates with 1..9, a row click, and a shift-click', async () => {
    await renderBattle()
    press('1')
    expect(useArenaView.getState().isolated).toEqual([0])
    await settle()
    expect(arena().dataset.isolated).toBe('0')
    expect(
      within(bots()).getByRole('button', { name: 'isolate Dwarf' }).getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(within(bots()).getByText('Imp'))
    expect(useArenaView.getState().isolated).toEqual([1])
    fireEvent.click(within(bots()).getByText('Dwarf'), { shiftKey: true })
    expect(useArenaView.getState().isolated).toEqual([0, 1])
    press('2')
    press('2')
    await settle()
    expect(arena().dataset.isolated).toBeUndefined()
    // Only as many digits as bots.
    press('3')
    expect(useArenaView.getState().isolated).toEqual([])
  })

  it('logs the round and takes a click on a line to its cycle', async () => {
    const { client } = await renderBattle()
    client.seek(100_000)
    await settle()
    await waitFor(() => expect(events().textContent).toContain('battle over · Dwarf wins'))
    const blood = within(events()).getByText('first blood · Dwarf → Imp')
    fireEvent.click(blood)
    await settle()
    expect(client.store.getState().cycle).toBe(16_140)
    expect(client.store.getState().status).toBe('paused')
    // The lines past the playhead dim.
    await waitFor(() =>
      expect(
        within(events()).getByText('battle over · Dwarf wins').closest('tr')?.className,
      ).toContain('opacity-45'),
    )
    fireEvent.click(within(events()).getByRole('button', { name: 'go to cycle 0' }))
    await settle()
    expect(client.store.getState().cycle).toBe(0)
  })

  it('shows the byte under a resting pointer, and nothing over the HUD', async () => {
    const { client } = await renderBattle()
    const { placements } = client.store.getState()
    const dwarf = placements[0]?.base as number
    const canvas = arena().querySelector('canvas') as HTMLCanvasElement
    // 800 x 600, less the 36 px band and the 44 px ruler: 2.2 px a cell, the core centered.
    const cell = (600 - 36) / 256
    const x = 44 + (800 - 44 - 256 * cell) / 2 + ((dwarf & 0xff) + 0.5) * cell
    const y = 36 + ((dwarf >> 8) + 0.5) * cell
    fireEvent.pointerMove(canvas, { clientX: x, clientY: y, pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain(`0x${dwarf.toString(16).toUpperCase().padStart(4, '0')}`)
    // The scene takes the load's frame at the next display frame, and the tooltip with it.
    await waitFor(() => expect(tip.textContent).toContain('owned by Dwarf · loaded at cycle 0'))

    // The byte Dwarf writes first, under a pointer that rests there while a step writes it.
    const battle = new Battle(DUEL, { seed: 1 })
    let first: { cycle: number; address: number } | null = null
    battle.events = new (class extends NullSink {
      override write(cycle: number, _bot: number, address: number): void {
        first ??= { cycle, address }
      }
    })()
    while (first === null) battle.step()
    const { cycle, address } = first as { cycle: number; address: number }
    fireEvent.pointerMove(canvas, {
      clientX: 44 + (800 - 44 - 256 * cell) / 2 + ((address & 0xff) + 0.5) * cell,
      clientY: 36 + ((address >> 8) + 0.5) * cell,
      pointerType: 'mouse',
    })
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('empty core'))
    act(() => client.step(cycle + 1))
    await waitFor(() =>
      expect(screen.getByRole('tooltip').textContent).toContain(
        'owned by Dwarf · written 1 cycle ago',
      ),
    )
    fireEvent.pointerMove(screen.getByRole('toolbar', { name: 'arena view' }), {
      clientX: 790,
      clientY: 10,
      pointerType: 'mouse',
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('the end', () => {
  it('shows the winner, the bots, the result hash, and the five actions', async () => {
    const { client, router, onRematch, onNewSeed } = await renderBattle()
    client.seek(100_000)
    await settle()
    const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
    expect(victory.textContent).toContain('last bot standing · cycle 16,141')
    expect(victory.dataset.resultHash).toBe(client.store.getState().resultHash ?? '')
    expect(
      within(victory).getByRole('table', { name: 'the bots at the end' }).textContent,
    ).toContain('dead @ 16,140 · dat')
    fireEvent.click(within(victory).getByRole('button', { name: 'rematch' }))
    fireEvent.click(within(victory).getByRole('button', { name: 'new seed' }))
    expect(onRematch).toHaveBeenCalledTimes(1)
    expect(onNewSeed).toHaveBeenCalledTimes(1)

    // Hidden, and back from the arena's header.
    fireEvent.click(within(victory).getByRole('button', { name: 'hide' }))
    expect(screen.queryByRole('region', { name: 'winner · Dwarf' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'result' }))
    const again = screen.getByRole('region', { name: 'winner · Dwarf' })

    fireEvent.click(within(again).getByRole('button', { name: 'open in debugger' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor'))
    expect(router.state.location.searchStr).toBe(
      '?b=roster:dwarf,roster:imp&seed=1&cycles=100000&rounds=1&procs=64&spacing=1024',
    )
  })

  it('copies a share link with the seed written in, and downloads the replay', async () => {
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
      const { client } = await renderBattle()
      client.seek(100_000)
      await settle()
      const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
      fireEvent.click(within(victory).getByRole('button', { name: 'share' }))
      await screen.findByText('link copied.')
      expect(writeText).toHaveBeenCalledWith(
        'http://localhost/arena?b=roster:dwarf,roster:imp&seed=1&cycles=100000&rounds=1&procs=64&spacing=1024',
      )
      fireEvent.click(within(victory).getByRole('button', { name: 'download replay' }))
      await waitFor(() => expect(saved).toEqual(['asmbots-dwarf-imp-1.asmreplay.json']))
      const replay = JSON.parse(await (created[0] as Blob).text())
      expect(replay).toMatchObject({
        format: 'asmbots-replay-local/1',
        rounds: 1,
        config: { seed: 1, maxCycles: 100_000 },
        match: { of: 1, rounds: [{ resultHash: client.store.getState().resultHash }] },
      })
      expect(replay.bots.map((bot: { name: string }) => bot.name)).toEqual(['Dwarf', 'Imp'])
    } finally {
      URL.createObjectURL = url.create
      URL.revokeObjectURL = url.revoke
      window.HTMLAnchorElement.prototype.click = click
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })
})

describe('the replay link', () => {
  it('copies a link to the match’s replay: the bots’ bytes, the config, and the match', async () => {
    const writeText = mock((_text: string) => Promise.resolve())
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    try {
      const { client } = await renderBattle()
      client.seek(100_000)
      await settle()
      const victory = await screen.findByRole('region', { name: 'winner · Dwarf' })
      fireEvent.click(within(victory).getByRole('button', { name: 'replay link' }))
      await screen.findByText('replay link copied.')
      const link = new URL(writeText.mock.calls[0]?.[0] as string)
      const { match } = client.store.getState()
      expect(link.pathname).toBe(`/arena/${match?.key}`)
      const read = readReplayFragment(link.hash)
      if (read.kind !== 'ok') throw new Error(read.kind)
      expect(read.replay.match).toEqual(match as MatchResult)
      expect(read.replay.config).toMatchObject({ seed: 1, maxCycles: 100_000, maxProcesses: 64 })
      // A link carries bytes, not sources (PRODUCT_SPEC §10).
      expect(read.replay.bots.map((bot) => [bot.name, bot.source])).toEqual([
        ['Dwarf', undefined],
        ['Imp', undefined],
      ])
      expect(read.bots.map((bot) => [...bot.bytes])).toEqual(DUEL.map((bot) => [...bot.bytes]))
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })
})

describe('a match', () => {
  it('stops between rounds, goes on with next round, and keeps the standings', async () => {
    const { client } = await renderBattle(fightOf(3))
    expect(screen.getByRole('region', { name: 'standings' }).textContent).toContain('round 1/3')
    client.seek(100_000)
    await settle()
    const between = await screen.findByRole('region', { name: 'round 1 over' })
    expect(between.textContent).toContain('winner · Dwarf')
    expect(screen.queryByRole('region', { name: /winner/ })).toBeNull()
    const standings = screen.getByRole('table', { name: 'standings' })
    expect(within(standings).getAllByRole('row')[1]?.textContent).toMatch(/^1Dwarf1\/0\/03$/)
    fireEvent.click(within(between).getByRole('button', { name: 'next round' }))
    await settle()
    expect(client.store.getState()).toMatchObject({ round: 1, status: 'playing', order: [1, 0] })
    // The rail redraws at the log's pace, not at once.
    await waitFor(() => expect(events().textContent).toContain('round 2 of 3 · seed 2'))
    expect(screen.getByRole('region', { name: 'arena' }).textContent).toContain(
      'round 2/3 · seed 2',
    )
  })

  it('goes on by itself with autoplay, to the victory of the match', async () => {
    const { client } = await renderBattle(fightOf(2))
    useArenaView.getState().setAutoplay(true)
    client.seek(100_000)
    await settle()
    await waitFor(() => expect(client.store.getState().round).toBe(1))
    client.seek(100_000)
    await settle()
    const victory = await screen.findByRole('region', { name: /^(winner|draw) · / })
    expect(victory.textContent).toContain('2 rounds')
    expect(within(victory).getByRole('table', { name: 'standings at the end' })).toBeTruthy()
    expect(client.store.getState().match?.rounds).toHaveLength(2)
  })
})
