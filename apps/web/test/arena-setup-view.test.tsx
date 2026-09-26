/**
 * `/arena` before and at the fight, in jsdom: `ArenaPage` in a memory router with the real route
 * search, the local bot store on fake-indexeddb, and a fake `ArenaClient`. The setup restores from
 * the URL and writes each change back; bots come from the roster, the local store, a paste, a
 * drop, or a share link; the fight button narrates and loads the Worker. `e2e/arena-setup.spec.ts`
 * runs the same flows in Chromium.
 */
import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { loadRoster } from '@asmbots/bots'
import { ToastProvider } from '@asmbots/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { ArenaPage } from '../src/features/arena/ArenaPage'
import { PRESETS } from '../src/features/arena/setup/config'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import { sharedBots, sharedFragment } from '../src/features/arena/setup/url'
import { type ArenaClient, createArenaStore } from '../src/features/arena/worker/client'
import { stringifySearch } from '../src/router'
import {
  clearLocalBots,
  LOCAL_BOTS_KEY,
  listLocalBots,
  saveLocalBot,
} from '../src/store/local-bots'
import { DEFAULT_SETTINGS, useSettings } from '../src/store/settings'

useDom()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}

const source = (slug: string) => loadRoster().get(slug)?.source ?? ''
const IMP = source('imp')
const DWARF = source('dwarf')
const BROKEN = '%name "Broken"\n        jmp nowhere\n'

let restoreCanvas = () => {}
beforeAll(() => {
  // No canvas here: the battle's renderers draw nothing, and jsdom prints nothing about it.
  const proto = window.HTMLCanvasElement.prototype
  const getContext = proto.getContext
  proto.getContext = (() => null) as typeof proto.getContext
  restoreCanvas = () => {
    proto.getContext = getContext
  }
})
afterAll(() => restoreCanvas())

beforeEach(async () => {
  await clearLocalBots()
  useSettings.setState({ ...structuredClone(DEFAULT_SETTINGS), theme: 'sentinel' })
})

/** A client that records what the page asks of it. */
function fakeClient() {
  const store = createArenaStore()
  return {
    store,
    load: mock((_bots: unknown, _config: unknown, _rounds?: number) =>
      store.setState({ status: 'loading' }),
    ),
    play: mock(() => {}),
    pause: mock(() => {}),
    seek: mock((_cycle: number) => {}),
    speed: mock((_speed: unknown) => {}),
    dispose: mock(() => {}),
    on: () => () => {},
  }
}

/** Renders `/arena` (with `path`'s query and fragment) the way the app routes it. */
async function renderArena(
  path = '/arena',
  client = fakeClient(),
  /** What shows once the page is up: the setup's config, unless the page starts in a battle. */
  ready = () => screen.findByRole('region', { name: 'config' }),
) {
  const root = createRootRoute({ component: Outlet })
  const arena = createRoute({
    getParentRoute: () => root,
    path: 'arena',
    validateSearch: validateArenaSearch,
    component: () => (
      <ArenaPage createClient={() => client as unknown as ArenaClient} urlDelay={0} />
    ),
  })
  const editor = createRoute({
    getParentRoute: () => root,
    path: 'editor',
    component: () => <p>the editor</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([arena, editor]),
    history: createMemoryHistory({ initialEntries: [path] }),
    stringifySearch,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  await ready()
  // The local store answers after a few ticks: let it, inside act, before the test goes on.
  await waitFor(() => expect(queryClient.getQueryState(LOCAL_BOTS_KEY)?.status).toBe('success'))
  return { router, client }
}

/** Lets the page's last URL write and the router's answer to it land, inside act. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)))

const picked = () =>
  within(screen.getByRole('list', { name: 'bots picked' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label'))
const fightButton = () =>
  document.querySelector<HTMLButtonElement>('button[name="fight"]') as HTMLButtonElement
/** The query the router holds, once the page has written it. */
const search = (router: { state: { location: { searchStr: string } } }) =>
  router.state.location.searchStr

/** Files dropped on the setup, as a browser delivers them. */
function drop(files: File[]) {
  const target = screen.getByText(/drop \.asm files anywhere here/)
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' }
  fireEvent.dragEnter(target, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

describe('arena setup', () => {
  it('restores the setup from the URL', async () => {
    await renderArena('/arena?b=roster:dwarf,roster:paper&seed=42&cycles=100000&rounds=3&procs=64')
    expect(picked()).toEqual(['Dwarf', 'Paper'])
    expect(fightButton().textContent).toBe('fight · 2 bots · 3 rounds')
    expect((screen.getByLabelText('seed') as HTMLInputElement).value).toBe('42')
    expect(screen.getByRole('button', { name: 'random' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.getByLabelText('rounds').getAttribute('aria-valuetext')).toBe('3')
    expect(screen.getByLabelText('cycles').getAttribute('aria-valuetext')).toBe('100,000')
    const config = screen.getByRole('region', { name: 'config' })
    expect(within(config).getByText('custom')).toBeTruthy()
  })

  it('lists the roster as cards: identicon, name, author, size, tier, and +', async () => {
    await renderArena()
    const cards = within(screen.getByRole('list', { name: 'bots to add' })).getAllByRole('listitem')
    expect(cards).toHaveLength(22)
    const dwarf = screen.getByRole('listitem', { name: 'Dwarf' })
    expect(dwarf.textContent).toContain('ASM Bots · 23 B')
    expect(dwarf.textContent).toContain('showcase')
    expect(dwarf.querySelector('svg rect')).toBeTruthy()
    expect(within(dwarf).getByRole('button', { name: 'add Dwarf' })).toBeTruthy()
  })

  it('narrates the fight button as bots come, and the URL follows', async () => {
    const { router } = await renderArena()
    expect(fightButton().textContent).toBe('add 2 bots')
    expect((fightButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'add Dwarf' }))
    expect(fightButton().textContent).toBe('add 1 more bot')
    fireEvent.click(screen.getByRole('button', { name: 'add Dwarf' }))
    expect(picked()).toEqual(['Dwarf', 'Dwarf 2'])
    expect(fightButton().textContent).toBe('fight · 2 bots · 1 round')
    expect((fightButton() as HTMLButtonElement).disabled).toBe(false)
    const cards = screen.getByRole('list', { name: 'bots to add' })
    expect(within(cards).getByRole('listitem', { name: 'Dwarf' }).textContent).toContain('×2')
    await waitFor(() =>
      expect(search(router)).toBe(
        '?b=roster:dwarf,roster:dwarf&cycles=100000&rounds=1&procs=64&spacing=1024',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'remove Dwarf' }))
    expect(picked()).toEqual(['Dwarf'])
    await waitFor(() => expect(search(router)).toStartWith('?b=roster:dwarf&'))
  })

  it('starts a first visit with dwarf vs paper', async () => {
    await renderArena()
    fireEvent.click(screen.getByRole('button', { name: /try dwarf vs paper/ }))
    expect(picked()).toEqual(['Dwarf', 'Paper'])
  })

  it('fills to 16 with random bots from the list, and then goes off', async () => {
    await renderArena()
    fireEvent.change(screen.getByRole('textbox', { name: 'search bots' }), {
      target: { value: 'painter' },
    })
    fireEvent.click(screen.getByRole('button', { name: /random fill/ }))
    expect(picked()).toHaveLength(16)
    expect(new Set(picked().map((name) => name?.replace(/ \d+$/, '')))).toEqual(
      new Set(['LCG Painter', 'Spiral Painter']),
    )
    expect(
      (screen.getByRole('button', { name: /random fill/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('filters the cards by the search', async () => {
    await renderArena()
    fireEvent.change(screen.getByRole('textbox', { name: 'search bots' }), {
      target: { value: 'painter' },
    })
    const names = within(screen.getByRole('list', { name: 'bots to add' }))
      .getAllByRole('listitem')
      .map((card) => card.getAttribute('aria-label'))
    expect(names).toEqual(['LCG Painter', 'Spiral Painter'])
    fireEvent.change(screen.getByRole('textbox', { name: 'search bots' }), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText('no roster bot matches "zzz".')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'clear the search' }))
    expect((screen.getByRole('textbox', { name: 'search bots' }) as HTMLInputElement).value).toBe(
      '',
    )
    expect(
      within(screen.getByRole('list', { name: 'bots to add' })).getAllByRole('listitem').length,
    ).toBeGreaterThan(10)
  })

  it('applies a preset, and lights its chip while the values are its own', async () => {
    const { router } = await renderArena('/arena?b=roster:imp,roster:dwarf')
    const hill = screen.getByRole('radio', { name: 'hill rules' })
    fireEvent.click(hill)
    expect(hill.getAttribute('aria-checked')).toBe('true')
    expect(fightButton().textContent).toBe('fight · 2 bots · 10 rounds')
    await waitFor(() => expect(search(router)).toContain('&cycles=80000&rounds=10&'))
    fireEvent.change(screen.getByLabelText('rounds'), { target: { value: '3' } })
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false'))
    expect(within(screen.getByRole('region', { name: 'config' })).getByText('custom')).toBeTruthy()
  })

  it('fixes a seed, or draws one each battle', async () => {
    const { router } = await renderArena('/arena?b=roster:imp,roster:dwarf')
    const seed = screen.getByLabelText('seed') as HTMLInputElement
    expect(seed.disabled).toBe(true)
    expect(seed.placeholder).toBe('random')
    fireEvent.click(screen.getByRole('button', { name: 'random' }))
    expect(seed.disabled).toBe(false)
    expect(seed.value).toMatch(/^\d+$/)
    fireEvent.change(seed, { target: { value: '12a3' } })
    expect(seed.value).toBe('123')
    await waitFor(() => expect(search(router)).toContain('&seed=123&'))
    fireEvent.change(seed, { target: { value: '99999999999' } })
    await waitFor(() => expect(search(router)).toContain('&seed=4294967295&'))
    fireEvent.click(screen.getByRole('button', { name: 'random' }))
    await waitFor(() => expect(search(router)).not.toContain('seed='))
  })

  it('starts a visit with no query from the config last fought with', async () => {
    useSettings.setState({
      lastArenaConfig: { ...PRESETS['hill rules'], seed: 9, preset: 'hill rules' },
    })
    await renderArena('/arena')
    expect(screen.getByRole('radio', { name: 'hill rules' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect((screen.getByLabelText('seed') as HTMLInputElement).value).toBe('9')
  })

  it('takes a change of the URL from outside, such as the back button', async () => {
    const { router } = await renderArena('/arena?b=roster:dwarf')
    await act(() => router.navigate({ to: '/arena', search: { b: 'roster:imp,roster:paper' } }))
    await waitFor(() => expect(picked()).toEqual(['Imp', 'Paper']))
  })
})

describe('bots from files, the store, a paste, and a share link', () => {
  it('assembles dropped .asm files, saves them to my bots, and picks them', async () => {
    const { router } = await renderArena()
    drop([new File([DWARF], 'dwarf.asm'), new File([IMP], 'imp.asm')])
    await waitFor(() => expect(fightButton().textContent).toBe('fight · 2 bots · 1 round'))
    expect(picked()).toEqual(['Dwarf', 'Imp'])
    expect(await screen.findByText('added 2 bots.')).toBeTruthy()
    const stored = await listLocalBots()
    expect(stored.map((bot) => bot.name).sort()).toEqual(['Dwarf', 'Imp'])
    const ids = stored.map((bot) => bot.id)
    await waitFor(() => {
      const refs = new URLSearchParams(search(router)).get('b')?.split(',') ?? []
      expect(refs.map((ref) => ref.slice('local:'.length)).sort()).toEqual([...ids].sort())
    })
    // The same file again is the same bot: picked twice, stored once.
    drop([new File([IMP], 'imp-copy.asm')])
    await waitFor(() => expect(picked()).toEqual(['Dwarf', 'Imp', 'Imp 2']))
    expect(await listLocalBots()).toHaveLength(2)
  })

  it('shows why a dropped file does not load, in a modal', async () => {
    await renderArena()
    drop([new File([BROKEN], 'broken.asm'), new File(['hello'], 'notes.txt')])
    const dialog = await screen.findByRole('dialog', { name: '2 files did not assemble' })
    expect(within(dialog).getByText('broken.asm')).toBeTruthy()
    expect(dialog.textContent).toContain('2:13 error')
    expect(dialog.textContent).toContain('jmp nowhere')
    expect(within(dialog).getByText('not an .asm file')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await listLocalBots()).toEqual([])
  })

  it('lists my bots, and shows the errors of one that does not assemble', async () => {
    await saveLocalBot({ id: 'mine-1', name: 'my imp', source: IMP })
    await saveLocalBot({ id: 'mine-2', name: 'wip', source: BROKEN })
    await renderArena()
    fireEvent.click(screen.getByRole('radio', { name: 'my bots' }))
    const cards = await screen.findByRole('list', { name: 'bots to add' })
    const names = within(cards)
      .getAllByRole('listitem')
      .map((card) => card.getAttribute('aria-label'))
    expect(names.sort()).toEqual(['Broken', 'Imp'])
    fireEvent.click(within(cards).getByRole('button', { name: 'add Imp' }))
    expect(picked()).toEqual(['Imp'])
    fireEvent.click(within(cards).getByText('errors'))
    expect(await screen.findByRole('dialog', { name: 'Broken does not assemble' })).toBeTruthy()
  })

  it('says there are no local bots, and points to the editor', async () => {
    const { router } = await renderArena()
    fireEvent.click(screen.getByRole('radio', { name: 'my bots' }))
    fireEvent.click(await screen.findByRole('link', { name: /write a bot/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor'))
  })

  it('assembles a paste as it is typed, and adds it once it assembles', async () => {
    await renderArena('/arena?b=roster:dwarf')
    fireEvent.click(screen.getByRole('radio', { name: 'paste' }))
    const box = screen.getByRole('textbox', { name: 'bot source' })
    const add = () => screen.getByRole('button', { name: 'add' }) as HTMLButtonElement
    fireEvent.change(box, { target: { value: BROKEN } })
    expect(await screen.findByText('1 error')).toBeTruthy()
    expect(add().disabled).toBe(true)
    fireEvent.change(box, { target: { value: IMP } })
    expect(await screen.findByText('Imp · 15 B')).toBeTruthy()
    fireEvent.click(add())
    await waitFor(() => expect(picked()).toEqual(['Dwarf', 'Imp']))
    expect((box as HTMLTextAreaElement).value).toBe('')
    expect((await listLocalBots()).map((bot) => bot.name)).toEqual(['Imp'])
    await settle()
  })

  it('loads the bots a share link carries, and saves one on request', async () => {
    const fragment = sharedFragment([{ id: 'friend-1', source: IMP }])
    const { router } = await renderArena(`/arena?b=local:friend-1,roster:dwarf#${fragment}`)
    const imp = await within(screen.getByRole('list', { name: 'bots picked' })).findByRole(
      'listitem',
      { name: 'Imp' },
    )
    expect(within(imp).getByText('shared')).toBeTruthy()
    expect(fightButton().textContent).toBe('fight · 2 bots · 1 round')
    // A change keeps the fragment while the shared bot is picked and not saved here.
    fireEvent.click(screen.getByRole('button', { name: 'add Paper' }))
    await waitFor(() => expect(search(router)).toContain('roster:paper'))
    expect(router.state.location.hash).toBe(fragment)
    fireEvent.click(within(imp).getByRole('button', { name: 'save Imp to my bots' }))
    await waitFor(() => expect(within(imp).getByText('local')).toBeTruthy())
    expect((await listLocalBots()).map((bot) => [bot.id, bot.name])).toEqual([['friend-1', 'Imp']])
    // Saved, the bot needs the fragment no more: the next change drops it.
    fireEvent.click(screen.getByRole('button', { name: 'remove Paper' }))
    await waitFor(() => expect(router.state.location.hash).toBe(''))
  })

  it('names a local bot this browser does not have, and the fix', async () => {
    await renderArena('/arena?b=local:gone,roster:dwarf')
    const gone = await within(screen.getByRole('list', { name: 'bots picked' })).findByRole(
      'listitem',
      { name: 'local bot' },
    )
    expect(within(gone).getByText('missing').title).toContain('ask for a share link')
    await waitFor(() => expect(fightButton().textContent).toBe('remove 1 missing bot'))
  })

  it('copies a share link that carries the local bots', async () => {
    await saveLocalBot({ id: 'mine-1', name: 'my imp', source: IMP })
    const writeText = mock((_text: string) => Promise.resolve())
    // Bun's own navigator, not jsdom's: the page reads the global one.
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    try {
      await renderArena('/arena?b=local:mine-1,roster:dwarf&seed=5')
      await within(screen.getByRole('list', { name: 'bots picked' })).findByRole('listitem', {
        name: 'Imp',
      })
      fireEvent.click(screen.getByRole('button', { name: 'copy a share link' }))
      expect(await screen.findByText('link copied with 1 local bot inside.')).toBeTruthy()
      const url = new URL(writeText.mock.calls[0]?.[0] ?? '')
      expect(url.pathname + url.search).toBe(
        '/arena?b=local:mine-1,roster:dwarf&seed=5&cycles=100000&rounds=1&procs=64&spacing=1024',
      )
      expect([...sharedBots(url.hash)]).toEqual([['mine-1', IMP]])
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })

  it('stops adding at 16 bots', async () => {
    const sixteen = Array.from({ length: 16 }, () => 'roster:imp').join(',')
    await renderArena(`/arena?b=${sixteen}`)
    expect(picked()).toHaveLength(16)
    expect((screen.getByRole('button', { name: 'add Dwarf' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(within(screen.getByRole('region', { name: 'bots' })).getByText('16 / 16')).toBeTruthy()
  })
})

describe('the fight', () => {
  it('loads the bots and the config into the Worker, plays, and goes back to the setup', async () => {
    const { router, client } = await renderArena('/arena?b=roster:dwarf,roster:paper&seed=42')
    fireEvent.click(fightButton())
    expect(client.load).toHaveBeenCalledTimes(1)
    const [bots, config, rounds] = client.load.mock.calls[0] as unknown as [
      { name: string; bytes: Uint8Array }[],
      unknown,
      number,
    ]
    expect(bots.map((bot) => [bot.name, bot.bytes.length])).toEqual([
      ['Dwarf', 23],
      ['Paper', 34],
    ])
    expect(config).toEqual({ maxCycles: 100_000, maxProcesses: 64, minSpacing: 1024, seed: 42 })
    expect(rounds).toBe(1)
    expect(client.play).toHaveBeenCalledTimes(1)
    expect(useSettings.getState().lastArenaConfig).toMatchObject({ seed: 42, rounds: 1 })
    // The URL holds the setup it fought, every field written.
    await waitFor(() =>
      expect(search(router)).toBe(
        '?b=roster:dwarf,roster:paper&seed=42&cycles=100000&rounds=1&procs=64&spacing=1024',
      ),
    )
    const battle = screen.getByRole('region', { name: 'arena' })
    expect(within(battle).getByRole('application', { name: 'arena' })).toBeTruthy()
    // The Worker's answer names the bots: the rail lists them.
    act(() =>
      client.store.setState({
        status: 'paused',
        botMeta: bots.map((bot) => ({ name: bot.name, size: bot.bytes.length })),
        order: [0, 1],
      }),
    )
    expect(screen.getByRole('table', { name: 'bots' }).textContent).toContain('Paper')
    fireEvent.click(within(battle).getByRole('button', { name: 'setup' }))
    expect(client.pause).toHaveBeenCalled()
    expect(picked()).toEqual(['Dwarf', 'Paper'])
    // The next fight reuses the Worker.
    fireEvent.click(fightButton())
    expect(client.load).toHaveBeenCalledTimes(2)
    await settle()
  })

  it('draws a seed that places when the setup has none', async () => {
    const { client } = await renderArena('/arena?b=roster:dwarf,roster:paper')
    fireEvent.click(fightButton())
    const config = client.load.mock.calls[0]?.[1] as { seed: number }
    expect(Number.isInteger(config.seed)).toBe(true)
    expect(screen.getByRole('region', { name: 'arena' }).textContent).toContain(
      `seed ${config.seed}`,
    )
    await settle()
  })
})

/** A coach mark by its `data-coach`, or null. */
const markOf = (name: string) => document.querySelector<HTMLElement>(`[data-coach="${name}"]`)

describe('the first visit’s tour', () => {
  const cards = () =>
    within(screen.getByRole('list', { name: 'bots to add' })).getAllByRole('listitem')

  it('pins roster, then fight, then watch, each once the step before is done', async () => {
    const { client } = await renderArena()
    // 1/3 under the first roster card's +.
    const roster = markOf('arena-roster') as HTMLElement
    expect(roster.textContent).toContain('1/3')
    expect(cards()[0]?.contains(roster)).toBe(true)
    fireEvent.click(within(cards()[0] as HTMLElement).getByRole('button', { name: /^add / }))
    expect(markOf('arena-roster')).not.toBeNull()
    fireEvent.click(within(cards()[1] as HTMLElement).getByRole('button', { name: /^add / }))
    // Two bots: 2/3 over the fight button.
    expect(markOf('arena-roster')).toBeNull()
    const fight = markOf('arena-fight') as HTMLElement
    expect(fight.textContent).toContain('2/3')
    expect(fight.parentElement?.contains(fightButton())).toBe(true)
    // The battle: 3/3 under the events log. Leaving it ends the tour for good.
    fireEvent.click(fightButton())
    expect(client.load).toHaveBeenCalledTimes(1)
    const watch = markOf('arena-watch') as HTMLElement
    expect(screen.getByRole('region', { name: 'events' }).contains(watch)).toBe(true)
    expect(useSettings.getState().coachMarksSeen).toEqual([])
    const battle = screen.getByRole('region', { name: 'arena' })
    fireEvent.click(within(battle).getByRole('button', { name: 'setup' }))
    expect(useSettings.getState().coachMarksSeen).toEqual(['arena'])
    expect(markOf('arena-fight')).toBeNull()
    await settle()
  })

  it('goes for good with skip the tour, and a visit after has none', async () => {
    await renderArena()
    const roster = markOf('arena-roster') as HTMLElement
    fireEvent.click(within(roster).getByRole('button', { name: 'skip the tour' }))
    expect(markOf('arena-roster')).toBeNull()
    expect(useSettings.getState().coachMarksSeen).toEqual(['arena'])
    fireEvent.click(screen.getByRole('button', { name: /try dwarf vs paper/ }))
    expect(markOf('arena-fight')).toBeNull()
    await settle()
  })

  it('shows nothing to a visitor who put it away before', async () => {
    useSettings.setState({ coachMarksSeen: ['arena'] })
    const { client } = await renderArena('/arena?b=roster:dwarf,roster:paper')
    expect(markOf('arena-roster')).toBeNull()
    expect(markOf('arena-fight')).toBeNull()
    fireEvent.click(fightButton())
    expect(client.load).toHaveBeenCalledTimes(1)
    expect(markOf('arena-watch')).toBeNull()
    await settle()
  })
})

describe('the intro', () => {
  const inBattle = () => screen.findByRole('region', { name: 'arena' })

  it('loads Dwarf vs Imp at its seed and speed, holds for its guide, and keeps the setup in the URL', async () => {
    const { router, client } = await renderArena('/arena?intro=true', fakeClient(), inBattle)
    expect(client.load).toHaveBeenCalledTimes(1)
    const [bots, config, rounds] = client.load.mock.calls[0] as unknown as [
      { name: string }[],
      unknown,
      number,
    ]
    expect(bots.map((bot) => bot.name)).toEqual(['Dwarf', 'Imp'])
    expect(config).toEqual({ maxCycles: 100_000, maxProcesses: 64, minSpacing: 1024, seed: 263 })
    expect(rounds).toBe(1)
    expect(client.speed).toHaveBeenCalledWith(200)
    // Its guide plays it, after the hold.
    expect(client.play).not.toHaveBeenCalled()
    expect(markOf('intro-bots')?.textContent).toContain('intro 1/3')
    // The tour stays out of the intro.
    expect(markOf('arena-watch')).toBeNull()
    await waitFor(() =>
      expect(search(router)).toBe(
        '?b=roster:dwarf,roster:imp&seed=263&cycles=100000&rounds=1&procs=64&spacing=1024',
      ),
    )
    // Skipped, the guide goes, and the tour does not come in its place.
    fireEvent.click(
      within(markOf('intro-bots') as HTMLElement).getByRole('button', { name: 'skip' }),
    )
    expect(markOf('intro-bots')).toBeNull()
    expect(markOf('arena-watch')).toBeNull()
    // The setup it leaves: the intro's bots, picked; leaving the intro does not end the tour.
    const battle = screen.getByRole('region', { name: 'arena' })
    fireEvent.click(within(battle).getByRole('button', { name: 'setup' }))
    expect(picked()).toEqual(['Dwarf', 'Imp'])
    expect(useSettings.getState().coachMarksSeen).toEqual([])
    expect(markOf('arena-fight')).not.toBeNull()
    await settle()
  })

  it('starts over when the link is followed again from a battle', async () => {
    const { router, client } = await renderArena('/arena?b=roster:dwarf,roster:paper&seed=42')
    fireEvent.click(fightButton())
    expect(client.play).toHaveBeenCalledTimes(1)
    await settle()
    await act(() => router.navigate({ to: '/arena', search: { intro: true } }))
    await waitFor(() => expect(client.load).toHaveBeenCalledTimes(2))
    const [bots] = client.load.mock.calls[1] as unknown as [{ name: string }[]]
    expect(bots.map((bot) => bot.name)).toEqual(['Dwarf', 'Imp'])
    expect(client.speed).toHaveBeenCalledWith(200)
    expect(client.play).toHaveBeenCalledTimes(1)
    expect(markOf('intro-bots')).not.toBeNull()
    await settle()
  })
})
