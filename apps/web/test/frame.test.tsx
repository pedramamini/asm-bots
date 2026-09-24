import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { ToastProvider } from '@asmbots/ui'
import { THEMES } from '@asmbots/ui/themes'
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
import { Frame, FrameToolbar } from '../src/app/Frame'
import { CHORD_WINDOW, createKeymap, type KeyCommand, ROUTE_SEARCH } from '../src/app/keys'
import { useHeaderStat, useRouteStat } from '../src/app/slots'
import { titleHead } from '../src/app/title'
import { useSettings } from '../src/store/settings'
import { answer, useApiServer, WithQueries } from './api-server'
import { TICKER } from './fixtures/api'

useDom()
const server = useApiServer()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}

describe('createKeymap', () => {
  let clock = 0
  const keymap = createKeymap({ now: () => clock })
  let unregister = () => {}

  function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
    const event = new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    Object.defineProperty(event, 'target', { value: target })
    return { taken: keymap.handle(event), prevented: event.defaultPrevented }
  }

  function commands(...list: [keys: string, run?: KeyCommand['run']][]) {
    return list.map(([keys, run = mock(() => {})]) => ({
      keys: keys.split(' '),
      description: keys,
      run,
    }))
  }

  beforeEach(() => {
    clock = 0
  })
  afterEach(() => unregister())

  it('runs a one-key command and takes the key', () => {
    const [theme] = commands(['t'])
    unregister = keymap.register([theme as KeyCommand])
    expect(press('t')).toEqual({ taken: true, prevented: true })
    expect(theme?.run).toHaveBeenCalledTimes(1)
    expect(press('x')).toEqual({ taken: false, prevented: false })
  })

  it('runs a chord whose second key comes within the window', () => {
    const list = commands(['g a'], ['a'])
    unregister = keymap.register(list)
    press('g')
    clock += CHORD_WINDOW
    press('a')
    expect(list[0]?.run).toHaveBeenCalledTimes(1)
    expect(list[1]?.run).not.toHaveBeenCalled()
  })

  it('drops a chord after the window, and reads the late key on its own', () => {
    const list = commands(['g a'], ['a'])
    unregister = keymap.register(list)
    press('g')
    clock += CHORD_WINDOW + 1
    press('a')
    expect(list[0]?.run).not.toHaveBeenCalled()
    expect(list[1]?.run).toHaveBeenCalledTimes(1)
  })

  it('leaves text fields and modified keys alone', () => {
    const list = commands(['t'])
    unregister = keymap.register(list)
    const input = document.createElement('input')
    expect(press('t', {}, input).taken).toBe(false)
    expect(press('t', { metaKey: true }).taken).toBe(false)
    expect(press('t', { ctrlKey: true }).taken).toBe(false)
    expect(list[0]?.run).not.toHaveBeenCalled()
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(press('t', {}, checkbox).taken).toBe(true)
  })

  it('keeps the default when the command did nothing', () => {
    unregister = keymap.register(commands(['/', () => false]))
    expect(press('/')).toEqual({ taken: false, prevented: false })
  })

  it('gives a key to the latest layer and lists each key once', () => {
    const global = commands(['f'], ['?'])
    const route = commands(['f'])
    const off = keymap.register(global)
    unregister = keymap.register(route)
    press('f')
    expect(route[0]?.run).toHaveBeenCalledTimes(1)
    expect(global[0]?.run).not.toHaveBeenCalled()
    expect(keymap.bindings().map((binding) => binding.keys.join(' '))).toEqual(['?', 'f'])
    unregister()
    press('f')
    expect(global[0]?.run).toHaveBeenCalledTimes(1)
    off()
    expect(keymap.bindings()).toEqual([])
  })
})

describe('Frame', () => {
  function renderFrame(path = '/') {
    const root = createRootRoute({
      component: () => (
        <Frame>
          <Outlet />
        </Frame>
      ),
    })
    const home = createRoute({
      getParentRoute: () => root,
      path: '/',
      head: () => titleHead('home'),
      component: Home,
    })
    const arena = createRoute({
      getParentRoute: () => root,
      path: '/arena',
      head: () => titleHead('arena'),
      component: () => <p>the arena</p>,
    })
    const router = createRouter({
      routeTree: root.addChildren([home, arena]),
      history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(
      <WithQueries>
        <ToastProvider>
          <RouterProvider router={router as never} />
        </ToastProvider>
      </WithQueries>,
    )
    return router
  }

  function Home() {
    useRouteStat('8 bots · 41 procs')
    return (
      <>
        <FrameToolbar aria-label="filters">
          <input aria-label="search" {...{ [ROUTE_SEARCH]: '' }} />
        </FrameToolbar>
        <p>home</p>
      </>
    )
  }

  const key = (key: string) => act(() => void fireEvent.keyDown(document.body, { key }))

  beforeEach(() => {
    document.documentElement.dataset.theme = 'sentinel'
    useSettings.setState({ theme: 'sentinel' })
  })
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('draws the brand, the route stat, the nav, the toolbar, and the status row', async () => {
    await renderAndWait()
    const header = screen.getByRole('banner')
    expect(header.textContent).toContain('ASM BOTS // HOME')
    expect(within(header).getByText('8 bots · 41 procs')).toBeTruthy()
    const nav = within(header).getByRole('navigation')
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['arena', 'editor', 'tournaments', 'hills', 'docs'])
    expect(screen.getByRole('toolbar', { name: 'filters' })).toBeTruthy()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('x16c v1')).toBeTruthy()
    expect(within(footer).getByText('made with maestro').closest('a')?.href).toBe(
      'https://maestro.sh/',
    )
  })

  it('lists the global keys in the key help', async () => {
    await renderAndWait()
    key('?')
    const dialog = await screen.findByRole('dialog', { name: 'keys' })
    const rows = within(dialog)
      .getAllByRole('row')
      .map((row) => row.textContent)
    expect(rows).toEqual([
      '?show the keys',
      'tnext theme',
      '/search this page',
      'g ago to arena',
      'g ego to editor',
      'g tgo to tournaments',
      'g hgo to hills',
      'g dgo to docs',
    ])
    key('?')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cycles through all five themes with t, and stores each', async () => {
    await renderAndWait()
    const seen: string[] = []
    for (const _ of THEMES) {
      key('t')
      const theme = document.documentElement.dataset.theme ?? ''
      seen.push(theme)
      expect(localStorage.getItem('theme')).toBe(theme)
    }
    expect(seen).toEqual([...THEMES.slice(1), THEMES[0]])
    expect(screen.getByRole('button', { name: `theme: ${THEMES[0]}` })).toBeTruthy()
  })

  it('goes to a route with a g chord, and marks its nav link', async () => {
    const router = await renderAndWait()
    key('g')
    key('a')
    await screen.findByText('the arena')
    expect(router.state.location.pathname).toBe('/arena')
    expect(screen.getByRole('link', { name: 'arena' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('banner').textContent).toContain('ASM BOTS // ARENA')
    // The route that set the stat is gone, and so is the stat.
    expect(useHeaderStat.getState().stat).toBe('')
  })

  it('focuses the route search with /', async () => {
    await renderAndWait()
    key('/')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'search' }))
    // Typed into the field, t is a letter, not a theme.
    act(() => void fireEvent.keyDown(document.activeElement as Element, { key: 't' }))
    expect(document.documentElement.dataset.theme).toBe('sentinel')
  })

  it('shows the quiet line, then the live feed once the page has painted', async () => {
    server.use(answer('/ticker', TICKER))
    await renderAndWait()
    const ticker = screen.getByRole('marquee')
    // The first paint: what is always so, while the feed waits for the page to paint.
    expect(ticker.textContent).toContain('▍ASM BOTS')
    await waitFor(() => expect(ticker.textContent).toContain('▍LIVE'))
    expect(ticker.textContent).toContain('HILL "MAIN" · Dwarf v1 took #1 (+3)')
    expect(ticker.textContent).toContain('CUP "WEEKLY 2026-09-19" won by Paper v1')
    expect(ticker.textContent).toContain('3 ENTERED · 4 WATCHING')
    const arrow = within(ticker).getByRole('link', { name: 'open the main hill' })
    expect(arrow.getAttribute('href')).toBe('/hills/main')
  })

  async function renderAndWait() {
    const router = renderFrame()
    await screen.findByText('home')
    return router
  }
})
