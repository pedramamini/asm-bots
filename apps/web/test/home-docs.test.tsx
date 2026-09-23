import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { evaluate } from '@mdx-js/mdx'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { MDXContent } from 'mdx/types'
import type { ReactNode } from 'react'
import * as runtime from 'react/jsx-runtime'
import { useDom, window } from '../../../packages/ui/test/dom'
import { DocsFrame } from '../src/app/DocsFrame'
import { HomePage } from '../src/app/HomePage'
import { focusRouteSearch } from '../src/app/keys'
import { NotFound } from '../src/app/NotFound'
import { useTicker } from '../src/app/ticker'
import { DOCS, type DocSection, docEntries, findDoc, searchDocs } from '../src/docs'
import { MDX_COMPONENTS } from '../src/docs/components'

useDom()
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}

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
      page('strategy/dwarf', 'dwarf', 'bomb every fourth word.'),
    ],
  },
  { title: 'tools', pages: [] },
]

/** Renders `content` at `/` of a memory router whose `/docs/$` shows the splat. */
async function renderAt(content: () => ReactNode, path = '/') {
  const root = createRootRoute({ component: Outlet, notFoundComponent: NotFound })
  const home = createRoute({ getParentRoute: () => root, path: '/', component: content })
  const doc = createRoute({
    getParentRoute: () => root,
    path: '/docs/$',
    component: function Doc() {
      return <p>doc {doc.useParams()._splat}</p>
    },
  })
  const router = createRouter({
    routeTree: root.addChildren([home, doc]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router as never} />)
  await act(() => router.load())
  return router
}

describe('docs index', () => {
  it('lists every page in reading order, and finds one by slug', () => {
    expect(docEntries(TEST_DOCS).map(({ page }) => page.slug)).toEqual([
      'start-here',
      'strategy/imp',
      'strategy/dwarf',
    ])
    expect(findDoc('strategy/dwarf', TEST_DOCS)?.title).toBe('dwarf')
    expect(findDoc('strategy', TEST_DOCS)).toBeUndefined()
    expect(findDoc(undefined, TEST_DOCS)).toBeUndefined()
  })

  it('searches titles, sections, and blurbs for every word', () => {
    const slugs = (query: string) => searchDocs(query, TEST_DOCS).map(({ page }) => page.slug)
    expect(slugs('')).toHaveLength(3)
    expect(slugs('  ')).toHaveLength(3)
    expect(slugs('STRATEGY')).toEqual(['strategy/imp', 'strategy/dwarf'])
    expect(slugs('strategy bomb')).toEqual(['strategy/dwarf'])
    expect(slugs('word')).toEqual(['strategy/imp', 'strategy/dwarf'])
    expect(slugs('vampire')).toEqual([])
  })

  it('ships the placeholder page, and it loads', async () => {
    expect(DOCS[0]?.pages[0]?.slug).toBe('start-here')
    expect(findDoc('start-here')).toBeDefined()
  })
})

describe('the placeholder page', () => {
  it('compiles as MDX and draws in the kit type, with app links through the router', async () => {
    const source = readFileSync(new URL('../src/docs/start-here.mdx', import.meta.url), 'utf8')
    const { default: Content } = await evaluate(source, { ...runtime, baseUrl: import.meta.url })
    await renderAt(() => <Content components={MDX_COMPONENTS} />)
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('Start here')
    expect(title.className).toContain('text-modal-title')
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-panel-title')
    const code = document.querySelector('pre > code')
    expect(code?.textContent).toContain('imp:    movsw')
    const arena = screen.getByRole('link', { name: 'open the arena' })
    expect(arena.getAttribute('href')).toBe('/arena')
    expect(arena.getAttribute('target')).toBeNull()
  })
})

describe('DocsFrame', () => {
  const renderFrame = () =>
    renderAt(() => (
      <DocsFrame docs={TEST_DOCS}>
        <p>the page</p>
      </DocsFrame>
    ))

  it('lists the sections with pages, and hides the empty ones', async () => {
    await renderFrame()
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
    ).toEqual(['contents', 'start here', 'imp', 'dwarf'])
    expect(screen.getByText('the page')).toBeTruthy()
  })

  it('takes / focus, filters as it is typed, and opens the first match on Enter', async () => {
    const router = await renderFrame()
    const search = screen.getByRole('searchbox', { name: 'search the docs' })
    expect(focusRouteSearch()).toBe(true)
    expect(document.activeElement).toBe(search)

    fireEvent.change(search, { target: { value: 'bomb' } })
    const nav = screen.getByRole('navigation', { name: 'docs pages' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['contents', 'dwarf'])
    fireEvent.change(search, { target: { value: 'vampire' } })
    expect(within(nav).getByText('no page matches.')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'imp' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    await screen.findByText('doc strategy/imp')
    expect(router.state.location.pathname).toBe('/docs/strategy/imp')
  })

  it('clears the search and leaves it on Escape', async () => {
    await renderFrame()
    const search = screen.getByRole('searchbox', { name: 'search the docs' }) as HTMLInputElement
    search.focus()
    fireEvent.change(search, { target: { value: 'dwarf' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search.value).toBe('')
    expect(document.activeElement).not.toBe(search)
  })
})

describe('HomePage', () => {
  it('draws the hero, its two ways in, and the three panels in skeleton', async () => {
    await renderAt(HomePage)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ASM BOTS')
    expect(screen.getByText('Write 8086 assembly. Fight for 64 KB.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'open arena' }).getAttribute('href')).toBe('/arena')
    expect(screen.getByRole('link', { name: 'write a bot' }).getAttribute('href')).toBe('/editor')
    expect(screen.getByRole('status').textContent).toContain('loading the demo battle')

    const hill = screen.getByRole('region', { name: 'main hill' })
    expect(
      within(hill)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['rank', 'bot', 'author', 'score', 'rating', 'age'])
    expect(within(hill).getByText('loading')).toBeTruthy()
    const matches = screen.getByRole('region', { name: 'recent matches' })
    expect(within(matches).getAllByRole('columnheader')).toHaveLength(3)
    const cup = screen.getByRole('region', { name: 'championship' })
    expect(within(cup).getByRole('button', { name: 'enter' })).toHaveProperty('disabled', true)
  })
})

describe('NotFound', () => {
  it('names the address nobody owns', async () => {
    await renderAt(() => null, '/no/such/address')
    const panel = screen.getByRole('region', { name: '0x404 · nothing at this address' })
    expect(within(panel).getByText('/no/such/address')).toBeTruthy()
    expect(within(panel).getByText(/no route lives here/)).toBeTruthy()
  })
})

describe('useTicker', () => {
  it('reads the static feed: a bold lead, then the hill, the cup, and the countdown', () => {
    const { items, link } = useTicker()
    expect(items).toHaveLength(5)
    expect(items.slice(1)).toContain('dwarf-v3 took #1')
    expect(
      items.some((item) => typeof item === 'string' && item.startsWith('NEXT CHAMPIONSHIP')),
    ).toBe(true)
    expect(link.to).toBe('/hills/main')
  })
})
