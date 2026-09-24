/**
 * The docs framework (EXEC 2.6 task 1): the MDX blocks, the frame's search, contents, and
 * prev/next, and every page of `src/docs/nav.ts`, compiled and drawn, with each `open in editor`
 * snippet assembled.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { assemble } from '@asmbots/asm'
import { ROSTER } from '@asmbots/bots'
import { ToastProvider } from '@asmbots/ui'
import { evaluate } from '@mdx-js/mdx'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MDXContent } from 'mdx/types'
import type { ReactNode } from 'react'
import * as runtime from 'react/jsx-runtime'
import { useDom, window } from '../../../packages/ui/test/dom'
import { DocsArticle, DocsFrame } from '../src/app/DocsFrame'
import { focusRouteSearch } from '../src/app/keys'
import { DOCS, type DocSection, docEntries, docNeighbors, findDoc } from '../src/docs'
import { Asm, blockSource, loadAsmRuntime, parseRun } from '../src/docs/Asm'
import { MDX_COMPONENTS, metaAttributes } from '../src/docs/components'
import { encodingFields, findForm } from '../src/docs/reference'
import { REMARK_PLUGINS } from '../src/docs/remark'
import { buildSearchIndex, type SearchIndex } from '../src/docs/search'
import { headingId } from '../src/docs/text'
import { parseRefs, sharedBots } from '../src/features/arena/setup/url'

useDom()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}

const DOCS_DIR = new URL('../src/docs/', import.meta.url).pathname

/** Compiles MDX as the build does (vite.config.ts): the same remark plugins. */
async function compile(source: string): Promise<MDXContent> {
  const { default: Content } = await evaluate(source, {
    ...runtime,
    remarkPlugins: REMARK_PLUGINS,
    baseUrl: import.meta.url,
  })
  return Content
}

/**
 * Renders the docs frame at `path` of a memory router: `/docs/$` draws `pages[slug]` in a
 * `DocsArticle`, and `/editor` and `/arena` say where a link landed.
 */
async function renderDocs(
  path: string,
  {
    docs = DOCS,
    pages = {},
    index,
  }: {
    docs?: readonly DocSection[]
    pages?: Record<string, () => ReactNode>
    index?: SearchIndex
  } = {},
) {
  const root = createRootRoute({ component: Outlet })
  const frame = createRoute({
    getParentRoute: () => root,
    path: '/docs',
    component: () => (
      <DocsFrame
        docs={docs}
        loadIndex={() => (index === undefined ? new Promise(() => {}) : Promise.resolve(index))}
      >
        <Outlet />
      </DocsFrame>
    ),
  })
  const contents = createRoute({
    getParentRoute: () => frame,
    path: '/',
    component: () => <p>contents</p>,
  })
  const page = createRoute({
    getParentRoute: () => frame,
    path: '$',
    component: function Page() {
      const slug = page.useParams()._splat ?? ''
      const title = docEntries(docs).find((e) => e.page.slug === slug)?.page.title ?? slug
      return (
        <DocsArticle title={title} slug={slug} docs={docs}>
          {pages[slug]?.() ?? <p>page {slug}</p>}
        </DocsArticle>
      )
    },
  })
  const editor = createRoute({
    getParentRoute: () => root,
    path: '/editor',
    component: () => <p>the editor</p>,
  })
  const arena = createRoute({
    getParentRoute: () => root,
    path: '/arena',
    component: () => <p>the arena</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([frame.addChildren([contents, page]), editor, arena]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <ToastProvider>
      <RouterProvider router={router as never} />
    </ToastProvider>,
  )
  await act(() => router.load())
  return router
}

/** Waits for the code blocks' colors and links. */
async function runtimeLoaded() {
  await act(async () => {
    await loadAsmRuntime()
  })
}

const IMP = `%name "Imp"

start:  call    .here
.here:  pop     bx
        sub     bx, .here
        lea     si, [bx+imp]
        lea     di, [bx+imp+2]

imp:    movsw
        nop`

describe('Asm', () => {
  it('reads a run tag: the roster bot, and a seed', () => {
    expect(parseRun('vs=imp')).toEqual({ vs: 'imp', seed: undefined })
    expect(parseRun(' vs=dwarf  seed=7 ')).toEqual({ vs: 'dwarf', seed: 7 })
    expect(parseRun('vs=')).toBeNull()
    expect(parseRun('imp')).toBeNull()
    expect(parseRun('vs=imp seed=99999999999')).toBeNull()
  })

  it('takes the blank lines and the shared indent off a block', () => {
    expect(blockSource('\n\n    mov ax, 1\n      nop   \n\n')).toBe('mov ax, 1\n  nop')
    expect(blockSource('\tnop')).toBe('nop')
    expect(blockSource('')).toBe('')
  })

  it('shows the text at once, then the colors, and links the editor and the arena', async () => {
    const router = await renderDocs('/docs/p', {
      pages: {
        p: () => <Asm run="vs=dwarf seed=7">{`\n    ${IMP.replace(/\n/g, '\n    ')}\n`}</Asm>,
      },
    })
    const block = screen.getByRole('figure', { name: 'Imp · x16c code' })
    expect(block.querySelector('code')?.textContent).toBe(IMP)
    await runtimeLoaded()
    const code = block.querySelector('code') as HTMLElement
    expect(code.textContent).toBe(IMP)
    const colored = [...code.querySelectorAll<HTMLElement>('span[style]')]
    expect(colored.find((s) => s.textContent === 'movsw')?.style.color).toBe('var(--accent)')
    expect(colored.find((s) => s.textContent === '"Imp"')?.style.color).toBe('var(--info)')

    const editor = within(block).getByRole('link', { name: 'open in editor' })
    const editorUrl = new URL(editor.getAttribute('href') as string, 'http://x')
    expect(editorUrl.pathname).toBe('/editor')
    expect([...sharedBots(editorUrl.hash).values()]).toEqual([IMP])

    const arena = within(block).getByRole('link', { name: 'open in arena · vs dwarf' })
    const arenaUrl = new URL(arena.getAttribute('href') as string, 'http://x')
    expect(arenaUrl.pathname).toBe('/arena')
    expect(arenaUrl.searchParams.get('seed')).toBe('7')
    const [mine, theirs] = parseRefs(arenaUrl.searchParams.get('b') as string)
    expect(theirs).toEqual({ kind: 'roster', slug: 'dwarf' })
    expect(mine?.kind).toBe('local')
    const shared = sharedBots(arenaUrl.hash)
    expect(mine?.kind === 'local' && shared.get(mine.id)).toBe(IMP)

    fireEvent.click(arena)
    await screen.findByText('the arena')
    expect(router.state.location.pathname).toBe('/arena')
  })

  it('copies its source', async () => {
    let copied = ''
    const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text
        },
      },
    })
    try {
      await renderDocs('/docs/p', { pages: { p: () => <Asm>{IMP}</Asm> } })
      fireEvent.click(screen.getByRole('button', { name: 'copy' }))
      expect(await screen.findByText('copied.')).toBeTruthy()
      expect(copied).toBe(IMP)
    } finally {
      if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
    }
  })

  it('opens a fragment nowhere: no name, no bytes', async () => {
    await renderDocs('/docs/p', {
      pages: {
        p: () => (
          <Asm fragment run="vs=imp">
            {'rep movsw'}
          </Asm>
        ),
      },
    })
    await runtimeLoaded()
    const block = screen.getByRole('figure', { name: 'x16c code' })
    expect(within(block).getByText('x16c · fragment')).toBeTruthy()
    expect(within(block).queryByRole('link')).toBeNull()
    expect(
      within(block)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['copy'])
  })
})

describe('fenced blocks', () => {
  it('reads the meta of a fence', () => {
    expect(metaAttributes('run="vs=imp" fragment')).toEqual({ run: 'vs=imp', fragment: true })
    expect(metaAttributes('')).toEqual({})
  })

  it('draws ```asm as Asm, its run tag kept, and any other language as text with copy', async () => {
    const Content = await compile(
      [
        '```asm run="vs=imp"',
        IMP,
        '```',
        '',
        '```asm fragment',
        'rep movsw',
        '```',
        '',
        '```sh',
        'bun run asmbots fight imp dwarf',
        '```',
      ].join('\n'),
    )
    await renderDocs('/docs/p', { pages: { p: () => <Content components={MDX_COMPONENTS} /> } })
    await runtimeLoaded()
    const imp = screen.getByRole('figure', { name: 'Imp · x16c code' })
    expect(within(imp).getByRole('link', { name: 'open in arena · vs imp' })).toBeTruthy()
    const fragment = screen.getByRole('figure', { name: 'x16c code' })
    expect(within(fragment).queryByRole('link')).toBeNull()
    const shell = screen.getByText('bun run asmbots fight imp dwarf')
    expect(shell.closest('figure')).toBeNull()
    expect(
      within(shell.closest('div') as HTMLElement).getByRole('button', { name: 'copy' }),
    ).toBeTruthy()
  })

  it('draws GitHub tables, and gives headings the ids the index uses', async () => {
    const Content = await compile(
      '# Page\n\n## Stride math: `add bx, 4`?\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n### Sub part\n',
    )
    await renderDocs('/docs/p', { pages: { p: () => <Content components={MDX_COMPONENTS} /> } })
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Stride math: add bx, 4?' }).id).toBe(
      'stride-math-add-bx-4',
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Sub part' }).id).toBe('sub-part')
  })
})

describe('Encoding and Flags', () => {
  it('splits an encoding into its fields', () => {
    expect(encodingFields('C7 /0 iw').map((f) => [f.kind, f.label, f.bytes])).toEqual([
      ['opcode', 'opcode', [1, 1]],
      ['modrm', 'ModR/M · /0', [1, 1]],
      ['disp', 'by mod', [0, 2]],
      ['imm', 'imm16 lo', [1, 1]],
      ['imm', 'imm16 hi', [1, 1]],
    ])
    expect(encodingFields('B8+r iw')[0]).toMatchObject({ value: 'B8+r', label: 'opcode + reg' })
    expect(encodingFields('88 /r')[1]?.reg).toBe('reg')
    expect(encodingFields('83 /5 ib')[1]?.reg).toBe('101')
    expect(encodingFields('E8 cw').map((f) => f.label)).toEqual(['opcode', 'rel16 lo', 'rel16 hi'])
    expect(() => encodingFields('0F 84 cw /q')).toThrow('no encoding field "/q"')
  })

  it('finds a form by its syntax, and names the forms when it cannot', () => {
    expect(findForm('mov r/m16, imm16').encoding).toBe('C7 /0 iw')
    expect(() => findForm('mov r/m16, imm8')).toThrow('"mov r/m16, imm16"')
    expect(() => findForm('frob ax')).toThrow('no mnemonic "frob"')
  })

  it('draws the bytes and the flags row', async () => {
    const Content = await compile(
      '<Encoding form="mov r/m16, imm16" />\n\n<Flags op="add" />\n\n<Flags set="cz" />',
    )
    await renderDocs('/docs/p', { pages: { p: () => <Content components={MDX_COMPONENTS} /> } })
    const encoding = screen.getByRole('figure', { name: 'encoding of mov r/m16, imm16' })
    expect(encoding.textContent).toContain('C7 /0 iw · 4 to 6 bytes')
    expect(within(encoding).getByText('000').className).toContain('text-accent')

    const [add, named] = screen.getAllByRole('table')
    const row = (table: HTMLElement | undefined) =>
      [...(table?.querySelectorAll('td') ?? [])].map((td) => td.textContent).join('')
    expect(row(add)).toBe('*---*****')
    expect(within(add as HTMLElement).getByRole('columnheader', { name: 'C' }).className).toContain(
      'text-accent',
    )
    expect(within(add as HTMLElement).getByRole('columnheader', { name: 'D' }).className).toContain(
      'text-dim',
    )
    expect(row(named)).toBe('-----*--*')
  })
})

describe('Keys, Note, Warn, Fig', () => {
  it('draws keys, callouts, and a themed figure', async () => {
    const Content = await compile(
      [
        'Press <Keys>g a</Keys> or <Keys>ctrl+enter</Keys>.',
        '',
        '<Note>A remark.</Note>',
        '',
        '<Warn>A trap.</Warn>',
        '',
        '<Fig src="modrm" alt="the ModR/M byte">mod, reg, r/m.</Fig>',
      ].join('\n'),
    )
    await renderDocs('/docs/p', { pages: { p: () => <Content components={MDX_COMPONENTS} /> } })
    expect([...document.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([
      'g',
      'a',
      'ctrl',
      'enter',
    ])
    expect(screen.getByRole('complementary', { name: 'note' }).textContent).toBe('NOTEA remark.')
    expect(screen.getByRole('complementary', { name: 'warning' }).textContent).toBe('WARNA trap.')
    const figure = screen.getByRole('img', { name: 'the ModR/M byte' })
    expect(figure.querySelector('svg')?.innerHTML).toContain('var(--accent)')
    expect(screen.getByText('mod, reg, r/m.').tagName).toBe('FIGCAPTION')
  })

  it('names the figures there are when one is missing', () => {
    const { Fig } = MDX_COMPONENTS as { Fig: (p: { src: string; alt: string }) => ReactNode }
    expect(() => Fig({ src: 'nope', alt: 'x' })).toThrow('try modrm')
  })
})

const page = (slug: string, title: string, blurb: string) => ({
  slug,
  title,
  blurb,
  load: async () => ({ default: (() => null) as MDXContent }),
})

const TEST_DOCS: DocSection[] = [
  { title: 'start here', pages: [page('start-here', 'start here', 'the tour.')] },
  {
    title: 'strategy guide',
    pages: [
      page('strategy/imp', 'imp', 'copy yourself one word ahead.'),
      page('strategy/paper', 'paper', 'copy the whole bot.'),
    ],
  },
  { title: 'tools', pages: [] },
]

const TEST_INDEX = buildSearchIndex(
  [
    { slug: 'start-here', heading: 'start here', anchor: '', text: 'the tour.' },
    { slug: 'strategy/imp', heading: 'imp', anchor: '', text: 'movsw one word ahead.' },
    {
      slug: 'strategy/paper',
      heading: 'paper',
      anchor: '',
      text: 'a paper copies itself with rep movsw, then splits.',
    },
    {
      slug: 'strategy/paper',
      heading: 'Why spl before rep movsw',
      anchor: 'why-spl-before-rep-movsw',
      text: 'the copy runs in a new process.',
    },
  ],
  (record) => (record.anchor === '' ? 'strategy guide' : ''),
)

describe('the docs tree', () => {
  it('lists every page in reading order, and finds one by slug', () => {
    expect(docEntries(TEST_DOCS).map(({ page }) => page.slug)).toEqual([
      'start-here',
      'strategy/imp',
      'strategy/paper',
    ])
    expect(findDoc('strategy/paper', TEST_DOCS)?.title).toBe('paper')
    expect(findDoc('strategy', TEST_DOCS)).toBeUndefined()
    expect(findDoc(undefined, TEST_DOCS)).toBeUndefined()
    expect(findDoc('start-here')).toBeDefined()
  })
})

describe('DocsFrame', () => {
  it('lists the sections with pages, and hides the empty ones', async () => {
    await renderDocs('/docs/start-here', { docs: TEST_DOCS })
    const nav = screen.getByRole('navigation', { name: 'docs pages' })
    expect(
      within(nav)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['start here', 'strategy guide'])
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['contents', 'start here', 'imp', 'paper'])
  })

  it('takes /, searches the sections as it is typed, and opens the best at its heading', async () => {
    const router = await renderDocs('/docs/start-here', { docs: TEST_DOCS, index: TEST_INDEX })
    const search = screen.getByRole('searchbox', { name: 'search the docs' })
    // Focus loads the index.
    await act(async () => {
      expect(focusRouteSearch()).toBe(true)
    })
    expect(document.activeElement).toBe(search)

    fireEvent.change(search, { target: { value: 'rep movsw' } })
    const results = await screen.findByRole('navigation', { name: 'search results' })
    await waitFor(() => expect(within(results).getAllByRole('link')).toHaveLength(2))
    const [best, other] = within(results).getAllByRole('link')
    expect(best?.textContent).toStartWith('paper › Why spl before rep movsw')
    expect(best?.getAttribute('href')).toBe('/docs/strategy/paper#why-spl-before-rep-movsw')
    expect(other?.textContent).toStartWith('paper')
    expect(screen.queryByRole('navigation', { name: 'docs pages' })).toBeNull()

    fireEvent.change(search, { target: { value: 'vampire' } })
    expect(within(results).getByRole('status').textContent).toBe('no section matches.')

    fireEvent.change(search, { target: { value: 'rep mov' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    await screen.findByText('page strategy/paper')
    expect(router.state.location.pathname).toBe('/docs/strategy/paper')
    expect(router.state.location.hash).toBe('why-spl-before-rep-movsw')
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('navigation', { name: 'docs pages' })).toBeTruthy()
  })

  it('says so while the index loads', async () => {
    await renderDocs('/docs/start-here', { docs: TEST_DOCS })
    const search = screen.getByRole('searchbox', { name: 'search the docs' })
    fireEvent.change(search, { target: { value: 'imp' } })
    expect(screen.getByRole('status').textContent).toBe('loading the index…')
  })

  it('clears the search and leaves it on Escape: the tree comes back', async () => {
    await renderDocs('/docs/start-here', { docs: TEST_DOCS, index: TEST_INDEX })
    const search = screen.getByRole('searchbox', { name: 'search the docs' }) as HTMLInputElement
    await act(async () => search.focus())
    fireEvent.change(search, { target: { value: 'paper' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search.value).toBe('')
    expect(document.activeElement).not.toBe(search)
    expect(screen.getByRole('navigation', { name: 'docs pages' })).toBeTruthy()
  })

  it('links the pages before and after, across sections', async () => {
    expect(docNeighbors('strategy/imp', TEST_DOCS).prev?.page.slug).toBe('start-here')
    expect(docNeighbors('strategy/imp', TEST_DOCS).next?.page.slug).toBe('strategy/paper')
    expect(docNeighbors('nope', TEST_DOCS)).toEqual({ prev: undefined, next: undefined })
    await renderDocs('/docs/strategy/imp', { docs: TEST_DOCS })
    const nav = screen.getByRole('navigation', { name: 'previous and next pages' })
    expect(within(nav).getByRole('link', { name: '← start here' }).getAttribute('href')).toBe(
      '/docs/start-here',
    )
    expect(within(nav).getByRole('link', { name: 'paper →' }).getAttribute('rel')).toBe('next')
  })

  it("lists the page's headings beside it", async () => {
    const Content = await compile('# T\n\n## One\n\ntext\n\n### One a\n\n## Two\n')
    await renderDocs('/docs/strategy/imp', {
      docs: TEST_DOCS,
      pages: { 'strategy/imp': () => <Content components={MDX_COMPONENTS} /> },
    })
    const toc = await screen.findByRole('navigation', { name: 'page contents' })
    expect(
      within(toc)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['One', '#one'],
      ['One a', '#one-a'],
      ['Two', '#two'],
    ])
  })
})

/** A directory entry, as `readdirSync` gives it (no Node types are installed). */
interface DirEntry {
  name: string
  isDirectory(): boolean
}

/** Every `.mdx` file under `src/docs`, as the slug a page would give it. */
function mdxSlugs(dir = DOCS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: DirEntry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return mdxSlugs(path)
    return entry.name.endsWith('.mdx') ? [relative(DOCS_DIR, path).replace(/\.mdx$/, '')] : []
  })
}

describe('the pages', () => {
  const entries = docEntries()

  it('are every MDX file, each once, with a unique slug and title', () => {
    const slugs = entries.map(({ page }) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect([...slugs].sort()).toEqual(mdxSlugs().sort())
    const titles = entries.map(({ page }) => page.title)
    expect(new Set(titles).size).toBe(titles.length)
    for (const { page } of entries) expect(page.title).toBe(page.title.toLowerCase())
  })

  for (const { page } of entries) {
    it(`${page.slug}: compiles, draws, and each open in editor snippet assembles`, async () => {
      const source = readFileSync(`${DOCS_DIR}${page.slug}.mdx`, 'utf8')
      const Content = await compile(source)
      await renderDocs(`/docs/${page.slug}`, {
        pages: { [page.slug]: () => <Content components={MDX_COMPONENTS} /> },
      })
      await runtimeLoaded()
      const article = screen.getByRole('region', { name: page.title })
      const ids = [...article.querySelectorAll('[id]')].map((el) => el.id)
      expect(new Set(ids).size).toBe(ids.length)

      const blocks = within(article).queryAllByRole('figure', { name: /x16c code$/ })
      for (const block of blocks) {
        const fragment = within(block).queryByText(/· fragment$/) !== null
        const editor = within(block).queryByRole('link', { name: 'open in editor' })
        expect(editor === null).toBe(fragment)
        if (editor === null) continue
        const url = new URL(editor.getAttribute('href') as string, 'http://x')
        for (const snippet of sharedBots(url.hash).values()) {
          const errors = assemble(snippet).diagnostics.filter((d) => d.severity === 'error')
          expect({ snippet, errors }).toEqual({ snippet, errors: [] })
        }
        const arena = within(block).queryByRole('link', { name: /^open in arena/ })
        if (arena === null) continue
        const b = new URL(arena.getAttribute('href') as string, 'http://x').searchParams.get('b')
        const vs = parseRefs(b ?? '')[1]
        expect(vs?.kind === 'roster' && ROSTER.some((bot) => bot.slug === vs.slug)).toBe(true)
      }
    })
  }
})

describe('headingId', () => {
  it('is the lowercase words of a heading, joined by dashes', () => {
    expect(headingId('Why `spl` before `rep movsw`?')).toBe('why-spl-before-rep-movsw')
    expect(headingId('ModR/M addressing')).toBe('modrm-addressing')
    expect(headingId('  The  machine -- memory ')).toBe('the-machine-memory')
    expect(headingId('???')).toBe('section')
  })
})
