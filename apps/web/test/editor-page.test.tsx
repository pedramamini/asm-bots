/**
 * `/editor` in jsdom (src/features/editor/EditorPage.tsx): the routes in a memory router under
 * the app frame, the local bots on fake-indexeddb, the assembler on the main thread, and a fake
 * arena client. The toolbar, the problems panel, format, save and versions, templates, the roster
 * read-only, the library and listing keys, `test vs`, share links, and drafts.
 * `e2e/editor.spec.ts` runs the main flows in Chromium.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { formatSource } from '@asmbots/asm'
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
import { rosterCatalog } from '../src/features/arena/setup/bots'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import { sharedBots, sharedFragment } from '../src/features/arena/setup/url'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { AsmClient } from '../src/features/editor/asm/client'
import { EditorBotRoute, EditorIndexRoute } from '../src/features/editor/EditorRoutes'
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

useDom()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}
// CodeMirror's selection layer measures ranges; jsdom lays nothing out.
beforeAll(() => {
  const range = window.Range.prototype as unknown as Record<string, unknown>
  range.getClientRects ??= () => []
  range.getBoundingClientRect ??= () => new window.DOMRect()
})

const source = (slug: string) =>
  rosterCatalog().find((b) => b.ref.kind === 'roster' && b.ref.slug === slug)?.source ?? ''
const BLANK = templateSource('blank')

beforeEach(async () => {
  await clearLocalBots()
  useEditorPrefs.setState(structuredClone(DEFAULT_EDITOR_PREFS as never))
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
    const saves = within(within(dialog).getByRole('list', { name: 'saves' })).getAllByRole('button')
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
    expect(useEditorPrefs.getState()).toMatchObject({ library: false, listing: false })
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
