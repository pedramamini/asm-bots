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
import { FPS_WARN, Frame, FrameToolbar, hasFooter, navActive } from '../src/app/Frame'
import { CHORD_WINDOW, createKeymap, type KeyCommand, ROUTE_SEARCH } from '../src/app/keys'
import { useFps, useHeaderStat, useRouteStat } from '../src/app/slots'
import { titleHead } from '../src/app/title'
import { VERSION, versionTitle } from '../src/app/version'
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
        <p>the home page</p>
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
    ).toEqual(['home', 'arena', 'editor', 'tournaments', 'hills', 'docs'])
    expect(screen.getByRole('toolbar', { name: 'filters' })).toBeTruthy()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('x16c v1')).toBeTruthy()
    expect(within(footer).getByText('made with maestro').closest('a')?.href).toBe(
      'https://runmaestro.ai/',
    )
  })

  it('links the version stamp to the changelog, and names its release in the tooltip', async () => {
    await renderAndWait()
    const footer = screen.getByRole('contentinfo')
    const stamp = within(footer).getByRole('link', { name: `${VERSION}: the changelog` })
    expect(stamp.getAttribute('href')).toBe('/docs/changelog')
    expect(stamp.textContent).toBe(VERSION)
    fireEvent.pointerEnter(stamp, { pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip', {}, { timeout: 2_000 })
    // No build defines the release under test: the stamp alone.
    expect(tip.textContent).toBe(versionTitle(VERSION, null))
    expect(stamp.getAttribute('aria-describedby')).toBe(tip.id)
  })

  it('warns under 50 fps, and its tooltip names the speed slider', async () => {
    await renderAndWait()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).queryByText(/fps$/)).toBeNull()
    act(() => useFps.getState().setFps(59.6))
    const chip = within(footer).getByText('60 fps')
    expect(chip.className).toContain('text-accent-fg')
    // A Tab stop, so the keyboard reads the tooltip too. Tab to it: jsdom's `:focus-visible` reads
    // the last event of the window, which the files before this one share (a click there makes a
    // bare `focus()` a pointer's).
    expect(chip.tabIndex).toBe(0)
    act(() => {
      fireEvent.keyDown(document.documentElement, { key: 'Tab' })
      chip.focus()
    })
    expect((await screen.findByRole('tooltip', {}, { timeout: 2_000 })).textContent).toBe(
      'frames a second the arena draws.',
    )
    act(() => useFps.getState().setFps(FPS_WARN - 7.8))
    expect(chip.textContent).toBe('42 fps')
    expect(chip.className).toContain('text-warn')
    expect(screen.getByRole('tooltip').textContent).toBe(
      'under 50 fps: each frame runs more cycles than this machine can draw. slow the speed slider under the arena, or press [.',
    )
    act(() => useFps.getState().setFps(FPS_WARN))
    expect(chip.className).toContain('text-accent-fg')
    act(() => useFps.getState().setFps(null))
    expect(within(footer).queryByText(/fps$/)).toBeNull()
  })

  it('starts the Tab order with a skip link to the content, which leaves the URL alone', async () => {
    const router = await renderAndWait()
    await act(() => router.navigate({ to: '/', hash: 'src=keep-me' }))
    const skip = screen.getByRole('link', { name: 'skip to content' })
    const main = screen.getByRole('main')
    // First in the document: before the ticker, the header, and the nav.
    expect([...document.querySelectorAll<HTMLElement>('a[href], button')].indexOf(skip)).toBe(0)
    expect(skip.getAttribute('href')).toBe('#content')
    expect(main.id).toBe('content')
    expect(main.tabIndex).toBe(-1)
    act(() => void fireEvent.click(skip))
    expect(document.activeElement).toBe(main)
    // The fragment is a page's own (a shared bot, a replay): the skip keeps it.
    expect(router.state.location.hash).toBe('src=keep-me')
  })

  it('puts every part of the chrome in a landmark: the ticker, the toolbar, the content', async () => {
    await renderAndWait()
    expect(screen.getByRole('complementary', { name: 'ticker' }).textContent).not.toBe('')
    const tools = screen.getByRole('region', { name: 'filters tools' })
    expect(within(tools).getByRole('toolbar', { name: 'filters' })).toBeTruthy()
    expect(screen.getByRole('main').textContent).toContain('the home page')
  })

  it('links home from the brand and the first nav button, current only on /', async () => {
    const router = await renderAndWait()
    const header = screen.getByRole('banner')
    const brand = within(header).getByRole('link', { name: /^ASM BOTS/ })
    expect(brand.getAttribute('href')).toBe('/')
    const nav = within(header).getByRole('navigation')
    const home = within(nav).getByRole('link', { name: 'home' })
    expect(home.getAttribute('href')).toBe('/')
    expect(home.getAttribute('aria-current')).toBe('page')
    // The intro is the home page's link now, not the header's.
    expect(within(header).queryByRole('link', { name: 'intro' })).toBeNull()
    await act(() => router.navigate({ to: '/arena' }))
    await screen.findByText('the arena')
    expect(home.getAttribute('aria-current')).toBeNull()
    // Home again with `g o`, and from the brand.
    key('g')
    key('o')
    await waitFor(() => expect(home.getAttribute('aria-current')).toBe('page'))
    expect(router.state.location.pathname).toBe('/')
  })

  it('knows which nav button holds a page: home only /, the others their subpages', () => {
    expect(navActive('/', '/')).toBe(true)
    expect(navActive('/', '/arena')).toBe(false)
    expect(navActive('/hills', '/hills/main')).toBe(true)
    expect(navActive('/hills', '/hillside')).toBe(false)
  })

  it('ends a scrolling page in the site footer, and leaves the full-screen routes without', () => {
    expect(hasFooter('/')).toBe(true)
    expect(hasFooter('/docs/strategy/imps')).toBe(true)
    expect(hasFooter('/hills/main')).toBe(true)
    for (const path of ['/arena', '/editor', '/editor/abc', '/embed/arena']) {
      expect(hasFooter(path)).toBe(false)
    }
  })

  it('says offline in the status bar, and what still works, until the network is back', async () => {
    await renderAndWait()
    const status = within(screen.getByRole('contentinfo')).getByRole('status')
    expect(status.textContent).toBe('● local')
    const onLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    let online = false
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
    try {
      act(() => void window.dispatchEvent(new window.Event('offline')))
      expect(status.textContent).toBe('○ offlinearena, editor, and local tournaments still work')
      online = true
      act(() => void window.dispatchEvent(new window.Event('online')))
      expect(status.textContent).toBe('● local')
    } finally {
      if (onLine === undefined) delete (navigator as { onLine?: boolean }).onLine
      else Object.defineProperty(navigator, 'onLine', onLine)
    }
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
      'g ogo to home',
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
    await screen.findByText('the home page')
    return router
  }
})

describe('versionTitle', () => {
  it("names a release's build by its release", () => {
    expect(versionTitle('2026.10.03a', { name: 'imp gate', released: true })).toBe(
      '2026.10.03a · "imp gate"',
    )
  })

  it('says a build ahead of every release is unreleased, with the name of the one coming', () => {
    expect(versionTitle('2026.09.25a', { name: 'imp gate', released: false })).toBe(
      '2026.09.25a · "imp gate" · unreleased',
    )
    expect(versionTitle('2026.09.25a', { name: null, released: false })).toBe(
      '2026.09.25a · unreleased',
    )
  })

  it('is the stamp alone without a release', () => {
    expect(versionTitle('2026.10.10a', { name: null, released: true })).toBe('2026.10.10a')
    expect(versionTitle('dev', null)).toBe('dev')
  })
})
