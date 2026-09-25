/**
 * `/editor` in jsdom (src/features/editor/EditorPage.tsx): the routes in a memory router under
 * the app frame, the local bots on fake-indexeddb, the assembler on the main thread, and a fake
 * arena client. The toolbar, the problems panel, format, save and versions, templates and the new
 * bot's empty state, the roster read-only, the library and listing keys, `test vs`, share links,
 * and drafts; the debugger: what it loads, breakpoints from the gutter and F9, runs and steps and
 * step back, the panels, the first visit's coach mark, and the arena strip. `e2e/editor.spec.ts`
 * and `e2e/debugger.spec.ts` run the main flows in Chromium.
 */
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { formatSource } from '@asmbots/asm'
import { fighter, rosterSource } from '@asmbots/bots'
import type { Bot } from '@asmbots/engine'
import { type MatchResult, runMatch } from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import { EditorView } from '@codemirror/view'
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
import { Frame } from '../src/app/Frame'
import { battleConfig } from '../src/features/arena/setup/config'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import { setupFromSearch, sharedBots, sharedFragment } from '../src/features/arena/setup/url'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { AsmClient } from '../src/features/editor/asm/client'
import { lineBytes } from '../src/features/editor/cm/debug'
import { DebugSession } from '../src/features/editor/debug/session'
import { EditorBotRoute, EditorIndexRoute } from '../src/features/editor/EditorRoutes'
import { movePanel, PRESETS, panelsOf } from '../src/features/editor/layout/tree'
import { validateEditorSearch } from '../src/features/editor/search'
import { DEFAULT_EDITOR_PREFS, useEditorPrefs } from '../src/features/editor/store'
import { templateSource } from '../src/features/editor/templates'
import { stringifySearch } from '../src/router'
import { listVersions } from '../src/store/bot-versions'
import {
  clearLocalBots,
  LOCAL_BOTS_KEY,
  listLocalBots,
  saveLocalBot,
} from '../src/store/local-bots'
import { useSettings } from '../src/store/settings'
import { useApiServer } from './api-server'
import { stubCanvas } from './fake-canvas'

useDom()
// The frame's ticker asks the API for its feed; it never answers here.
useApiServer()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}
// CodeMirror's selection layer measures ranges; jsdom lays nothing out.
// The debugger's arena strip draws in 2D on a canvas that draws nothing.
let restoreCanvas = () => {}
beforeAll(() => {
  const range = window.Range.prototype as unknown as Record<string, unknown>
  range.getClientRects ??= () => []
  range.getBoundingClientRect ??= () => new window.DOMRect()
  restoreCanvas = stubCanvas(window)
})
afterAll(() => restoreCanvas())

const source = rosterSource
const BLANK = templateSource('blank')

beforeEach(async () => {
  await clearLocalBots()
  useEditorPrefs.setState(structuredClone(DEFAULT_EDITOR_PREFS as never))
  // Each test is a first visit: the editor's coach mark shows until it goes.
  useSettings.setState({ coachMarksSeen: [] })
})

/** An arena client whose matches the test scores. */
function fakeArena(match?: (rounds: number) => MatchResult) {
  return {
    runMatch: mock(async (bots: never, config: never, rounds: number) =>
      match === undefined ? runMatch(bots, config, rounds) : match(rounds),
    ),
    dispose: mock(() => {}),
  }
}

/** Renders `path` the way the app routes the editor, under the frame. */
async function renderEditor(path = '/editor', arena = fakeArena()) {
  const services = {
    createAssembler: () => new AsmClient({ worker: null }),
    createArena: () => arena as unknown as ArenaClient,
    assembleDelay: 0,
  }
  const root = createRootRoute({
    component: () => (
      <Frame>
        <Outlet />
      </Frame>
    ),
  })
  const editor = createRoute({ getParentRoute: () => root, path: 'editor' })
  const index = createRoute({
    getParentRoute: () => editor,
    path: '/',
    validateSearch: validateEditorSearch,
    component: () => <EditorIndexRoute {...services} />,
  })
  const bot = createRoute({
    getParentRoute: () => editor,
    path: '$botId',
    component: () => <EditorBotRoute {...services} />,
  })
  const arenaRoute = createRoute({
    getParentRoute: () => root,
    path: 'arena',
    validateSearch: validateArenaSearch,
    component: () => <p>the arena</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([editor.addChildren([index, bot]), arenaRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
    stringifySearch,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(queryClient.getQueryState(LOCAL_BOTS_KEY)?.status).toBe('success'))
  return { router, arena, queryClient, ...rendered }
}

/** The editor's view, once it is up. */
async function editorView(): Promise<EditorView> {
  let view: EditorView | null = null
  await waitFor(() => {
    const dom = document.querySelector<HTMLElement>('.cm-editor')
    view = dom === null ? null : EditorView.findFromDOM(dom)
    expect(view).not.toBeNull()
  })
  return view as unknown as EditorView
}

const sizeChip = () => screen.getByLabelText(/^size /).textContent
const newBot = () => screen.queryByRole('region', { name: 'new bot' })
const toolbar = () => within(screen.getByRole('toolbar', { name: 'editor' }))
const problemRows = () =>
  within(screen.getByRole('list', { name: 'problems' }))
    .getAllByRole('button')
    .map((row) => row.textContent)

/** Puts `text` in the view as a user edit. */
function type(view: EditorView, text: string, at = view.state.doc.length) {
  act(() => view.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' }))
}

function replaceAll(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }))
}

const settle = (ms = 10) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

describe('the editor page', () => {
  it('opens a new bot on the blank template and assembles it', async () => {
    await renderEditor()
    const view = await editorView()
    expect(view.state.doc.toString()).toBe(BLANK)
    await waitFor(() => expect(sizeChip()).toBe('2 / 512 B'))
    expect(toolbar().getByText('new')).toBeTruthy()
    expect(toolbar().getByTitle("the bot's %name").textContent).toBe('untitled')
    expect(screen.getByText('no problems: the bot assembles clean.')).toBeTruthy()
    expect(screen.getByText('untitled · 2 B · assembles')).toBeTruthy()
  })

  it('lists an error at its line and column, and a click puts the cursor there', async () => {
    await renderEditor()
    const view = await editorView()
    await waitFor(() => expect(sizeChip()).toBe('2 / 512 B'))
    type(view, 'next:   mov     [bx], 0\n')
    await waitFor(() =>
      expect(problemRows()).toEqual(['error6:17operation size not specifiedsize-not-specified']),
    )
    expect(sizeChip()).toBe('— / 512 B')
    expect(view.dom.querySelector('.cm-lintRange-error')?.textContent).toBe('[bx]')
    fireEvent.click(within(screen.getByRole('list', { name: 'problems' })).getByRole('button'))
    const line = view.state.doc.line(6)
    expect(view.state.selection.main.head).toBe(line.from + 16)
    // Lint warnings come and go with the lint switch.
    type(view, '        movsb\n')
    await waitFor(() => expect(problemRows()).toHaveLength(2))
    fireEvent.click(toolbar().getByRole('button', { name: 'lint' }))
    await waitFor(() => expect(problemRows()).toHaveLength(1))
  })

  it('formats the source and keeps the cursor in its token', async () => {
    await renderEditor()
    const view = await editorView()
    const messy = '%NAME "t"\n%strategy "s"\nSTART:MOV AX,0X1f\n  jmp   START\n'
    replaceAll(view, messy)
    act(() => view.dispatch({ selection: { anchor: messy.indexOf('AX') + 1 } }))
    fireEvent.click(toolbar().getByRole('button', { name: 'format' }))
    expect(view.state.doc.toString()).toBe(formatSource(messy))
    const head = view.state.selection.main.head
    expect(view.state.sliceDoc(head - 1, head + 1)).toBe('ax')
    fireEvent.click(toolbar().getByRole('button', { name: 'format' }))
    expect(await screen.findByText('already formatted.')).toBeTruthy()
  })

  it('saves a new bot, moves it to its address, and keeps each save as a version', async () => {
    const { router } = await renderEditor()
    const view = await editorView()
    await waitFor(() => expect(sizeChip()).toBe('2 / 512 B'))
    act(() => view.dispatch({ selection: { anchor: 5 } }))
    fireEvent.click(toolbar().getByRole('button', { name: 'save' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/editor\/[0-9a-f-]{36}$/))
    const id = router.state.location.pathname.split('/').pop() as string
    const [saved] = await listLocalBots()
    expect([saved?.id, saved?.name, saved?.source]).toEqual([id, 'untitled', BLANK])
    expect(await screen.findByText('saved untitled.')).toBeTruthy()
    // The bot's own page: saved, and the cursor where it was.
    await waitFor(() =>
      expect(toolbar().queryByText('new')?.textContent ?? 'no new').toBe('no new'),
    )
    const moved = await editorView()
    expect(moved.state.selection.main.head).toBe(5)
    expect(useEditorPrefs.getState().drafts.scratch).toBeUndefined()
    // Change it: unsaved; save again with Mod-s: a second version, and the diff between them.
    type(moved, '; more\n')
    expect(toolbar().getByText('unsaved')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })
    await waitFor(() =>
      expect(toolbar().queryByText('unsaved')?.textContent ?? 'saved').toBe('saved'),
    )
    expect((await listVersions(id)).map((v) => v.source)).toEqual([`${BLANK}; more\n`, BLANK])
    await waitFor(() =>
      expect(toolbar().getByRole('button', { name: 'versions' }).hasAttribute('disabled')).toBe(
        false,
      ),
    )
    fireEvent.click(toolbar().getByRole('button', { name: 'versions' }))
    const dialog = await screen.findByRole('dialog', { name: 'versions' })
    // The saves are read as the dialog opens.
    const list = await within(dialog).findByRole('list', { name: 'saves' })
    const saves = within(list).getAllByRole('button')
    expect(saves).toHaveLength(2)
    fireEvent.click(saves[1] as HTMLElement)
    expect(within(dialog).getByLabelText('diff').textContent).toContain('+ ; more')
    expect(within(dialog).getByText('the editor has 1 line added, 0 removed')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'restore' }))
    expect(moved.state.doc.toString()).toBe(BLANK)
  })

  it('starts a new bot from a template, and undo brings the text back', async () => {
    const { router } = await renderEditor('/editor?t=imp')
    const view = await editorView()
    await waitFor(() => expect(view.state.doc.toString()).toBe(source('imp')))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByText('a new bot from imp.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    expect(view.state.doc.toString()).toBe(BLANK)
    // From the menu.
    fireEvent.click(toolbar().getByRole('button', { name: 'templates ▾' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'scanner skeleton' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe(templateSource('scanner')))
  })

  it('shows a roster bot read-only, and forks it into my bots', async () => {
    const { router } = await renderEditor('/editor/roster-dwarf')
    const view = await editorView()
    expect(view.state.doc.toString()).toBe(source('dwarf'))
    expect(view.state.readOnly).toBe(true)
    expect(toolbar().getByText('read-only')).toBeTruthy()
    expect(toolbar().getByRole('button', { name: 'format' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(document.body, { key: 's', metaKey: true })
    expect(await screen.findByText('a roster bot is read-only: fork it to edit.')).toBeTruthy()
    fireEvent.click(toolbar().getByRole('button', { name: 'fork' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/editor\/[0-9a-f-]{36}$/))
    const [fork] = await listLocalBots()
    expect([fork?.name, fork?.source]).toEqual(['Dwarf', source('dwarf')])
    await waitFor(() => expect(toolbar().queryByText('read-only')).toBeNull())
    const forked = await editorView()
    expect(forked.state.readOnly).toBe(false)
  })

  it('opens the first bot of the arena’s setup', async () => {
    await renderEditor('/editor?b=roster:paper,roster:imp&seed=1')
    const view = await editorView()
    expect(view.state.doc.toString()).toBe(source('paper'))
  })

  it('shows and hides the library (b) and the listing (l)', async () => {
    await renderEditor()
    const view = await editorView()
    await waitFor(() => expect(view.dom.querySelector('.cm-listing-gutter')).not.toBeNull())
    expect(screen.getByRole('region', { name: 'bot library' })).toBeTruthy()
    act(() => void fireEvent.keyDown(document.body, { key: 'b' }))
    expect(screen.queryByRole('region', { name: 'bot library' })).toBeNull()
    act(() => void fireEvent.keyDown(document.body, { key: 'l' }))
    expect(view.dom.querySelector('.cm-listing-gutter')).toBeNull()
    expect(useEditorPrefs.getState().listing).toBe(false)
    expect(useEditorPrefs.getState().layout.hidden).toEqual(['library'])
    fireEvent.click(toolbar().getByRole('button', { name: 'listing' }))
    expect(view.dom.querySelector('.cm-listing-gutter')).not.toBeNull()
  })

  it('opens my bots and the roster from the library', async () => {
    const bot = await saveLocalBot({ name: 'mine', source: source('imp') })
    const { router } = await renderEditor()
    await editorView()
    const library = () => within(screen.getByRole('region', { name: 'bot library' }))
    fireEvent.click(await library().findByRole('button', { name: 'mine' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/editor/${bot.id}`))
    await waitFor(async () => expect((await editorView()).state.doc.toString()).toBe(source('imp')))
    fireEvent.click(library().getByRole('button', { name: 'Stone' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/roster-stone'))
    // The bots opened lately, the latest first.
    await waitFor(() =>
      expect(useEditorPrefs.getState().recent).toEqual([
        'roster:stone',
        `local:${bot.id}`,
        'scratch',
      ]),
    )
  })

  it('tests the bot vs a roster bot: the record, and watch opens the arena as tested', async () => {
    const arena = fakeArena(() => ({
      key: 'k',
      names: ['untitled', 'Imp'],
      of: 3,
      points: [4, 4],
      rounds: [
        [3, 0],
        [1, 1],
        [0, 3],
      ].map((points, round) => ({
        round,
        seed: round,
        order: [0, 1],
        resultHash: '',
        durationCycles: 1,
        points,
        survivors: [],
        survival: [],
      })),
    }))
    const { router } = await renderEditor('/editor', arena)
    await editorView()
    fireEvent.click(toolbar().getByRole('button', { name: 'test vs ▾' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'imp' }))
    const record = await screen.findByRole('status', { name: /vs Imp/ })
    expect(record.textContent).toBe('W 1 · T 1 · L 1 vs imp')
    const [bots, config, rounds] = arena.runMatch.mock.calls[0] as unknown as [
      { name: string }[],
      { maxCycles: number },
      number,
    ]
    expect([bots.map((b) => b.name), config.maxCycles, rounds]).toEqual([
      ['untitled', 'Imp'],
      100_000,
      10,
    ])
    const watch = screen.getByRole('link', { name: 'watch' })
    const href = watch.getAttribute('href') ?? ''
    expect(href).toMatch(
      /^\/arena\?b=local:draft-[0-9a-f]{12},roster:imp&seed=\d+&cycles=100000&rounds=10/,
    )
    expect(
      sharedBots(href.split('#')[1] ?? '')
        .values()
        .next().value,
    ).toBe(BLANK)
    fireEvent.click(watch)
    await waitFor(() => expect(router.state.location.pathname).toBe('/arena'))
    expect(await screen.findByText('the arena')).toBeTruthy()
  })

  it('will not test a bot with errors', async () => {
    const arena = fakeArena()
    await renderEditor('/editor', arena)
    const view = await editorView()
    type(view, '        jmp     nowhere\n')
    fireEvent.click(toolbar().getByRole('button', { name: 'test vs ▾' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'dwarf' }))
    expect(await screen.findByText(/fix the error first/)).toBeTruthy()
    expect(arena.runMatch).not.toHaveBeenCalled()
  })

  it('copies a share link with the source inside, which opens it unsaved', async () => {
    const writeText = mock(async (_text: string) => {})
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    try {
      const first = await renderEditor()
      const view = await editorView()
      type(view, '; shared\n')
      fireEvent.click(toolbar().getByRole('button', { name: 'share' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const url = new URL(writeText.mock.calls[0]?.[0] ?? '')
      expect(url.pathname).toBe('/editor')
      expect([...sharedBots(url.hash).values()]).toEqual([`${BLANK}; shared\n`])
      first.unmount()
      await renderEditor(`/editor${url.hash}`)
      const opened = await editorView()
      expect(opened.state.doc.toString()).toBe(`${BLANK}; shared\n`)
      expect(toolbar().getByText('new')).toBeTruthy()
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })

  it('shows the templates over a new bot, and one starts the bot from it', async () => {
    const { router } = await renderEditor()
    const view = await editorView()
    const panel = within(newBot() as HTMLElement)
    const templates = within(panel.getByRole('list', { name: 'templates' })).getAllByRole('button')
    expect(templates.map((row) => row.textContent)).toEqual([
      'blank',
      'imp',
      'dwarf',
      'scanner skeleton',
      'replicator skeleton',
    ])
    expect(
      panel.getByRole('button', { name: 'dwarf', description: 'roster dwarf: a DAT bomber' }),
    ).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'dwarf' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe(source('dwarf')))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(newBot()).toBeNull()
    expect(view.hasFocus).toBe(true)
    // Undo brings the blank bot back, and the panel stays put away.
    fireEvent.click(await screen.findByRole('button', { name: 'undo' }))
    expect(view.state.doc.toString()).toBe(BLANK)
    expect(newBot()).toBeNull()
  })

  it('puts the templates away once the bot has text of its own, until it has none', async () => {
    await renderEditor()
    const view = await editorView()
    expect(newBot()).not.toBeNull()
    type(view, '; mine\n')
    expect(newBot()).toBeNull()
    // Emptied, the bot is new again: blank puts the blank template in.
    replaceAll(view, ' \n')
    expect(newBot()).not.toBeNull()
    fireEvent.click(within(newBot() as HTMLElement).getByRole('button', { name: 'blank' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe(BLANK))
    expect(await screen.findByText('a new bot from blank.')).toBeTruthy()
    expect(newBot()).toBeNull()
  })

  it('blank keeps the blank bot and selects its name; close keeps the text', async () => {
    const first = await renderEditor()
    const view = await editorView()
    fireEvent.click(within(newBot() as HTMLElement).getByRole('button', { name: 'blank' }))
    expect(newBot()).toBeNull()
    expect(view.state.doc.toString()).toBe(BLANK)
    const { from, to } = view.state.selection.main
    expect(view.state.sliceDoc(from, to)).toBe('untitled')
    expect(view.hasFocus).toBe(true)
    expect(first.router.state.location.search).toEqual({})
    expect(screen.queryByText('a new bot from blank.')).toBeNull()
    // Each new visit shows the panel again; close puts it away and leaves the text.
    first.unmount()
    await renderEditor()
    const again = await editorView()
    fireEvent.click(within(newBot() as HTMLElement).getByRole('button', { name: 'close' }))
    expect(newBot()).toBeNull()
    expect(again.state.doc.toString()).toBe(BLANK)
    expect(again.hasFocus).toBe(true)
  })

  it('shows no templates over a saved bot, a roster bot, or a template on its way', async () => {
    const bot = await saveLocalBot({ name: 'blank one', source: BLANK })
    const mine = await renderEditor(`/editor/${bot.id}`)
    expect((await editorView()).state.doc.toString()).toBe(BLANK)
    expect(newBot()).toBeNull()
    mine.unmount()
    const roster = await renderEditor('/editor/roster-imp')
    await editorView()
    expect(newBot()).toBeNull()
    roster.unmount()
    // The panel must not flash over the blank text before the template goes in: a panel put in
    // and taken out in one batch is gone from the page by now, but not from its removal record.
    const flashed: string[] = []
    const watcher = new window.MutationObserver((records: MutationRecord[]) => {
      for (const record of records) {
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (node.textContent?.includes('start from a template')) flashed.push('new bot')
        }
      }
    })
    watcher.observe(document.body, { childList: true, subtree: true })
    await renderEditor('/editor?t=imp')
    const view = await editorView()
    await waitFor(() => expect(view.state.doc.toString()).toBe(source('imp')))
    watcher.disconnect()
    expect(flashed).toEqual([])
    expect(newBot()).toBeNull()
  })

  it('says so for a bot this browser does not have', async () => {
    await renderEditor('/editor/no-such-bot')
    expect(await screen.findByText(/no bot with this id in this browser/)).toBeTruthy()
    expect(sharedFragment([])).toBe('')
  })

  it('keeps unsaved text as a draft, and opens it again', async () => {
    const first = await renderEditor()
    const view = await editorView()
    type(view, '; mine\n')
    await settle(450)
    expect(useEditorPrefs.getState().drafts.scratch?.source).toBe(`${BLANK}; mine\n`)
    first.unmount()
    await renderEditor()
    expect((await editorView()).state.doc.toString()).toBe(`${BLANK}; mine\n`)
  })

  it('writes the draft of text that has not rested when the page goes', async () => {
    const first = await renderEditor()
    const view = await editorView()
    type(view, '; quick\n')
    first.unmount()
    expect(useEditorPrefs.getState().drafts.scratch?.source).toBe(`${BLANK}; quick\n`)
  })
})

afterEach(() => {
  useEditorPrefs.setState(structuredClone(DEFAULT_EDITOR_PREFS as never))
})

describe('the debugger', () => {
  /** The dwarf's base in `/editor?b=roster:dwarf,roster:imp&seed=1`: the arena's round 0. */
  const DWARF_BASE = (() => {
    const { config } = setupFromSearch({ b: 'roster:dwarf,roster:imp', seed: 1 })
    const session = new DebugSession([fighter('dwarf'), fighter('imp')], battleConfig(config, 1))
    return (session.battle.bots[0] as Bot).base
  })()
  const BOMB = DWARF_BASE + 0x0f
  const hex = (v: number) => v.toString(16).toUpperCase().padStart(4, '0')
  const reg = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value
  const stopLine = () => screen.getByText(/^cycle$/).parentElement?.textContent ?? ''
  const key = (k: string, init: KeyboardEventInit = {}) =>
    act(() => {
      fireEvent.keyDown(document.body, { key: k, ...init })
    })

  /** Opens dwarf vs imp at seed 1, and waits for the debugger to load it. */
  async function dwarfVsImp() {
    const rendered = await renderEditor('/editor?b=roster:dwarf,roster:imp&seed=1')
    const view = await editorView()
    await waitFor(() => expect(reg('ip')).toBe(hex(DWARF_BASE)))
    return { ...rendered, view }
  }

  /** Puts the cursor on the line that holds `text`. */
  function cursorOn(view: EditorView, text: string) {
    const at = view.state.doc.toString().indexOf(text)
    act(() => view.dispatch({ selection: { anchor: at } }))
  }

  it("loads the editor's bot with the arena's setup, and shows where it stands", async () => {
    await dwarfVsImp()
    expect(within(screen.getByRole('list', { name: 'opponents' })).getByText('Imp')).toBeTruthy()
    expect((screen.getByLabelText('placement seed') as HTMLInputElement).value).toBe('1')
    expect(stopLine()).toBe('cycle0·ready: nothing has run')
    expect(reg('sp')).toBe(hex(DWARF_BASE))
    expect(reg('ax')).toBe('0000')
    const processes = screen.getByRole('region', { name: 'processes' })
    expect(within(processes).getByText('Dwarf')).toBeTruthy()
    expect(within(processes).getByText('Imp')).toBeTruthy()
    const dwarf = within(screen.getByRole('list', { name: 'Dwarf queue' })).getByRole('button')
    expect(dwarf.getAttribute('aria-current')).toBe('true')
    expect(dwarf.textContent).toContain('call start.here')
    const memory = within(screen.getByRole('list', { name: 'memory' }))
    expect(memory.getByRole('button', { current: true }).textContent).toContain(
      `0x${hex(DWARF_BASE)}`,
    )
  })

  it('breaks on the line F9 marks, runs to it with F5, and steps back with ,', async () => {
    const { view } = await dwarfVsImp()
    cursorOn(view, 'mov     word [di], 0')
    key('F9')
    await waitFor(() =>
      expect(view.dom.querySelector('.cm-debug-mark[data-breakpoint="on"]')).not.toBeNull(),
    )
    const breakpoints = screen.getByRole('list', { name: 'breakpoints' })
    expect(breakpoints.textContent).toContain(`0x${hex(BOMB)}`)
    expect(breakpoints.textContent).toContain(
      `lap.bomb+3 · line ${
        source('dwarf')
          .split('\n')
          .findIndex((l) => l.includes('word [di], 0')) + 1
      }`,
    )
    key('F5')
    await waitFor(() => expect(stopLine()).toContain(`breakpoint at 0x${hex(BOMB)}`))
    expect(stopLine()).toMatch(/^cycle6·/)
    expect(view.dom.querySelector('.cm-debug-ip')?.textContent).toContain('mov     word [di], 0')
    const memory = within(screen.getByRole('list', { name: 'memory' }))
    expect(memory.getByRole('button', { current: true }).textContent).toContain(`0x${hex(BOMB)}`)
    expect(reg('ip')).toBe(hex(BOMB))
    const di = reg('di')
    expect(di).toBe(hex(DWARF_BASE - 4))
    expect(screen.getByRole('list', { name: 'breakpoints' }).textContent).toContain('1 hit')
    // Back two cycles, a cycle each after a run: before `sub di, 4`, and `mov cx, LAP` before it.
    key(',')
    key(',')
    await waitFor(() => expect(stopLine()).toBe('cycle4·stepped back'))
    expect(reg('di')).toBe(hex(DWARF_BASE))
    expect(reg('ip')).toBe(hex(DWARF_BASE + 9))
    expect(view.dom.querySelector('.cm-debug-ip')?.textContent).toContain('mov     cx, LAP')
  })

  it('steps with the transport and F11, F10, and Shift+F11', async () => {
    await dwarfVsImp()
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await waitFor(() => expect(stopLine()).toBe('cycle1·stepped'))
    // The base idiom's `pop bx`: step over it is a step.
    key('F10')
    await waitFor(() => expect(stopLine()).toMatch(/^cycle2·/))
    expect(reg('bx')).toBe(hex(DWARF_BASE + 3))
    key('F11')
    await waitFor(() => expect(stopLine()).toMatch(/^cycle3·/))
    expect(reg('bx')).toBe(hex(DWARF_BASE))
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(stopLine()).toBe('cycle0·ready: nothing has run'))
    fireEvent.change(screen.getByLabelText('cycles to run'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'run N cycles' }))
    await waitFor(() => expect(stopLine()).toBe('cycle40·paused'))
  })

  it('edits a register in place, and toggles a flag', async () => {
    await dwarfVsImp()
    const ax = screen.getByLabelText('ax') as HTMLInputElement
    fireEvent.focus(ax)
    fireEvent.change(ax, { target: { value: '1A2B' } })
    fireEvent.keyDown(ax, { key: 'Enter' })
    await waitFor(() => expect(reg('ax')).toBe('1A2B'))
    fireEvent.click(screen.getByRole('button', { name: 'carry flag' }))
    await waitFor(() => expect(reg('flags')).toBe('0003'))
    expect(screen.getByRole('button', { name: 'carry flag' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'trap flag' }).hasAttribute('disabled')).toBe(true)
    // Esc puts a field back.
    fireEvent.focus(ax)
    fireEvent.change(ax, { target: { value: '0' } })
    fireEvent.keyDown(ax, { key: 'Escape' })
    fireEvent.blur(ax)
    expect(reg('ax')).toBe('1A2B')
  })

  it('watches an address, and goes to one in the memory panel', async () => {
    await dwarfVsImp()
    const watch = screen.getByLabelText('watch an address')
    fireEvent.change(watch, { target: { value: 'start - 2' } })
    fireEvent.keyDown(watch, { key: 'Enter' })
    const watches = await screen.findByRole('list', { name: 'watches' })
    expect(watches.textContent).toContain('start - 2')
    expect(watches.textContent).toContain(`0x${hex(DWARF_BASE - 2)}`)
    expect(watches.textContent).toContain('0000')
    // The call pushes its return address there: the next state reads it.
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await waitFor(() => expect(watches.textContent).toContain(hex(DWARF_BASE + 3)))
    const go = screen.getByLabelText('go to address')
    fireEvent.change(go, { target: { value: 'lap' } })
    fireEvent.keyDown(go, { key: 'Enter' })
    const memory = screen.getByRole('region', { name: 'memory' })
    await waitFor(() =>
      expect(within(memory).getByText(`at 0x${hex(DWARF_BASE + 7)}`)).toBeTruthy(),
    )
    fireEvent.change(go, { target: { value: 'ax ==' } })
    fireEvent.keyDown(go, { key: 'Enter' })
    expect(within(memory).getByRole('alert').textContent).toBeTruthy()
  })

  it('follows another process, and says when it runs outside the bot', async () => {
    await dwarfVsImp()
    expect(screen.queryByText('executing outside this bot')).toBeNull()
    fireEvent.click(within(screen.getByRole('list', { name: 'Imp queue' })).getByRole('button'))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'registers' }).textContent).toContain('Imp'),
    )
    expect(await screen.findByText('executing outside this bot')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'trace' }).textContent).toContain(
      'has run nothing yet',
    )
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await waitFor(() =>
      expect(screen.getByRole('log', { name: 'trace' }).textContent).toContain('call'),
    )
  })

  it('loads a new assemble by itself until the session moves, then waits for reload', async () => {
    await renderEditor('/editor?t=dwarf')
    const view = await editorView()
    await waitFor(() => expect(view.state.doc.toString()).toContain('%name     "Dwarf"'))
    await waitFor(() => expect(stopLine()).toBe('cycle0·ready: nothing has run'))
    const bombLine =
      view.state.doc
        .toString()
        .split('\n')
        .findIndex((l) => l.includes('word [di], 0')) + 1
    await waitFor(() => expect(lineBytes(view.state, bombLine)).not.toBeNull())
    // A breakpoint by a press on the gutter's line: the page's handler takes line numbers.
    cursorOn(view, 'mov     word [di], 0')
    key('F9')
    const set = lineBytes(view.state, bombLine)?.addr
    // An edit before anything ran: the session loads again, the breakpoint on its line.
    type(view, '        nop\n', view.state.doc.line(bombLine).from)
    await waitFor(() => expect(lineBytes(view.state, bombLine + 1)?.addr).toBe((set ?? 0) + 1))
    expect(screen.queryByText('source changed')).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'breakpoints' }).textContent).toContain(
        `0x${hex((set ?? 0) + 1)}`,
      ),
    )
    // Once it has moved, an edit leaves the session as it is, and says so.
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await waitFor(() => expect(stopLine()).toBe('cycle1·stepped'))
    type(view, '; note\n')
    await waitFor(() => expect(screen.getByText('source changed')).toBeTruthy())
    expect(stopLine()).toBe('cycle1·stepped')
    // The chip comes with the edit, reload once the edit has assembled.
    const reload = screen.getByRole('button', { name: 'reload' })
    await waitFor(() => expect(reload.hasAttribute('disabled')).toBe(false))
    fireEvent.click(reload)
    await waitFor(() => expect(stopLine()).toBe('cycle0·ready: nothing has run'))
    expect(screen.queryByText('source changed')).toBeNull()
    expect(screen.getByRole('list', { name: 'breakpoints' }).textContent).toContain(
      `0x${hex((set ?? 0) + 1)}`,
    )
  })

  it('flashes a new process in, and fades a dead one out of the processes panel', async () => {
    await renderEditor()
    const view = await editorView()
    // Each child dies on its first instruction.
    replaceAll(view, '%name "Fork"\nstart:  spl     child\n        jmp     start\nchild:  dat\n')
    await waitFor(() => expect(screen.getByRole('list', { name: 'Fork queue' })).toBeTruthy())
    const queue = () => screen.getByRole('list', { name: 'Fork queue' })
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await waitFor(() => expect(queue().querySelectorAll('[data-spawned]')).toHaveLength(1))
    expect(within(queue()).getAllByRole('button')).toHaveLength(2)
    // The child runs its `dat` in the next cycle, before the followed parent's turn.
    fireEvent.click(screen.getByRole('button', { name: 'step' }))
    await waitFor(() => expect(within(queue()).getAllByRole('button')).toHaveLength(1))
    expect(queue().textContent).toContain('died')
    await waitFor(() => expect(queue().textContent).not.toContain('died'), { timeout: 2000 })
  })

  it('pins the coach mark under run on the first visit, until got it, and never again', async () => {
    const first = await dwarfVsImp()
    const transport = screen.getByRole('group', { name: 'debugger transport' })
    const tip = screen.getByRole('note', { name: 'tip' })
    expect(tip.querySelector('p')?.textContent).toBe(
      'assemble runs as you type; press F5 to debug.',
    )
    // Under the transport, whose first button is run, which its caret points at.
    expect(transport.nextElementSibling).toBe(tip)
    expect(within(transport).getAllByRole('button')[0]).toBe(
      screen.getByRole('button', { name: 'run' }),
    )
    fireEvent.click(within(tip).getByRole('button', { name: 'got it' }))
    expect(screen.queryByRole('note', { name: 'tip' })).toBeNull()
    expect(useSettings.getState().coachMarksSeen).toEqual(['editor'])
    first.unmount()
    await dwarfVsImp()
    expect(screen.queryByRole('note', { name: 'tip' })).toBeNull()
  })

  it('puts the coach mark away once the debugger runs', async () => {
    await dwarfVsImp()
    expect(screen.getByRole('note', { name: 'tip' })).toBeTruthy()
    key('F11')
    await waitFor(() => expect(stopLine()).toBe('cycle1·stepped'))
    await waitFor(() => expect(screen.queryByRole('note', { name: 'tip' })).toBeNull())
    expect(useSettings.getState().coachMarksSeen).toEqual(['editor'])
    // Back at cycle 0, it stays away.
    key(',')
    await waitFor(() => expect(stopLine()).toMatch(/^cycle0·/))
    expect(screen.queryByRole('note', { name: 'tip' })).toBeNull()
  })

  /** Opens the menu of panel `label` from its grip, and picks `item`. */
  async function panelMenu(label: string, item: string) {
    fireEvent.click(
      screen.getByRole('button', { name: `${label}: drag to move, or open its menu` }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: item }))
  }

  /** Opens the toolbar's layout menu, and picks `item`. */
  async function layoutMenu(item: string) {
    fireEvent.click(toolbar().getByRole('button', { name: 'layout ▾' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: item }))
  }

  it('hides the arena strip from its menu and shows it from the layout menu; the editor stays', async () => {
    const { view } = await dwarfVsImp()
    const strip = screen.getByRole('region', { name: 'arena strip' })
    expect(within(strip).getByRole('application', { name: 'debug arena' })).toBeTruthy()
    expect(screen.getByRole('separator', { name: 'arena strip height' })).toBeTruthy()
    await panelMenu('arena strip', 'hide arena strip')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'arena strip' })).toBeNull())
    expect(useEditorPrefs.getState().layout.hidden).toEqual(['arena'])
    expect(screen.queryByRole('separator', { name: 'arena strip height' })).toBeNull()
    expect(await editorView()).toBe(view)
    await layoutMenu('show arena strip')
    await waitFor(() =>
      expect(screen.getByRole('application', { name: 'debug arena' })).toBeTruthy(),
    )
    expect(useEditorPrefs.getState().layout.hidden).toEqual([])
    expect(await editorView()).toBe(view)
  })

  it('moves panels and keeps what each holds: the source, the watches', async () => {
    const { view } = await dwarfVsImp()
    type(view, '; mine\n')
    const watch = screen.getByLabelText('watch an address')
    fireEvent.change(watch, { target: { value: 'start' } })
    fireEvent.keyDown(watch, { key: 'Enter' })
    await screen.findByRole('list', { name: 'watches' })
    // The source goes right of the memory, the watch panel hides and comes back.
    const { layout, setLayout } = useEditorPrefs.getState()
    act(() => setLayout({ ...layout, root: movePanel(layout.root, 'source', 'memory', 'right') }))
    const order = panelsOf(useEditorPrefs.getState().layout.root)
    expect(order.indexOf('source')).toBe(order.indexOf('memory') + 1)
    expect(document.querySelector('[data-panel="source"] .cm-editor')).not.toBeNull()
    await panelMenu('watch', 'hide watch')
    await waitFor(() => expect(screen.queryByRole('list', { name: 'watches' })).toBeNull())
    await layoutMenu('show watch')
    expect((await screen.findByRole('list', { name: 'watches' })).textContent).toContain('start')
    const moved = await editorView()
    expect(moved).toBe(view)
    expect(moved.state.doc.toString()).toContain('; mine')
  })

  it('moves a panel past its neighbor from its menu, and says when none is there', async () => {
    await dwarfVsImp()
    // jsdom lays nothing out: the registers sit left of the memory, and nothing is right of it.
    const at = (id: string, left: number, right: number) => {
      const slot = document.querySelector(`[data-panel="${id}"]`) as HTMLElement
      slot.getBoundingClientRect = () => new window.DOMRect(left, 0, right - left, 100)
    }
    at('registers', 0, 100)
    at('memory', 112, 300)
    await panelMenu('registers', 'move right')
    const order = () => panelsOf(useEditorPrefs.getState().layout.root)
    expect(order().indexOf('memory')).toBeLessThan(order().indexOf('registers'))
    at('memory', 0, 100)
    at('registers', 112, 300)
    await panelMenu('registers', 'move right')
    expect(await screen.findByText('no panel right of registers.')).toBeTruthy()
  })

  it('sizes two panels with the divider between them, from the keys', async () => {
    await renderEditor()
    const divider = screen.getByRole('separator', { name: 'library width' })
    const before = Number(divider.getAttribute('aria-valuenow'))
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
    fireEvent.keyDown(divider, { key: 'Home' })
    expect(divider.getAttribute('aria-valuenow')).toBe('5')
  })

  it('shows a narrow window the phone layout, and keeps the stored one for a wide window', async () => {
    const stored = useEditorPrefs.getState().layout
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    })
    try {
      await renderEditor()
      const shown = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map(
        (slot) => slot.dataset.panel,
      )
      expect(shown).toEqual(['source', 'problems'])
      expect(screen.queryByRole('region', { name: 'bot library' })).toBeNull()
      await layoutMenu('show memory')
      await waitFor(() => expect(screen.getByRole('region', { name: 'memory' })).toBeTruthy())
      expect(useEditorPrefs.getState().layout).toBe(stored)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'matchMedia')
      else Object.defineProperty(globalThis, 'matchMedia', previous)
    }
  })

  it('puts the panels as a preset has them', async () => {
    await renderEditor()
    await layoutMenu('writing layout')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'memory' })).toBeNull())
    expect(screen.getByRole('region', { name: 'bot library' })).toBeTruthy()
    await layoutMenu('debugging layout')
    await waitFor(() => expect(screen.getByRole('region', { name: 'memory' })).toBeTruthy())
    expect(screen.queryByRole('region', { name: 'bot library' })).toBeNull()
    await layoutMenu('default layout')
    await waitFor(() => expect(screen.getByRole('region', { name: 'bot library' })).toBeTruthy())
    expect(useEditorPrefs.getState().layout).toEqual(PRESETS.default())
  })
})
