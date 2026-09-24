import { describe, expect, it } from 'bun:test'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { lazy, type ReactNode, useEffect } from 'react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { HomePage } from '../src/app/HomePage'
import { NotFound } from '../src/app/NotFound'
import { useTicker } from '../src/app/ticker'
import type { HomeDemoProps } from '../src/features/arena/demo/HomeDemo'
import { hang, useApiServer, WithQueries } from './api-server'

useDom()
// The server never answers: the home page's panels hold their skeletons (test/api-pages.test.tsx
// fills them).
useApiServer(hang('/hills/main'), hang('/hills/main/matches'), hang('/tournaments'))
// The router restores the scroll on each navigation; jsdom has no scrolling.
window.scrollTo = () => {}

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
  render(
    <WithQueries>
      <RouterProvider router={router as never} />
    </WithQueries>,
  )
  await act(() => router.load())
  return router
}

/** A demo that never loads: the hero keeps its loader. */
const NeverLoads = lazy(() => new Promise<never>(() => {}))

describe('HomePage', () => {
  it('draws the hero, its two ways in, and the three panels in skeleton', async () => {
    await renderAt(() => <HomePage demo={NeverLoads} />)
    expect(screen.getByRole('region', { name: 'live demo' }).textContent).toContain(
      '4 bots · loading',
    )
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
    expect(within(matches).getAllByRole('columnheader')).toHaveLength(4)
    const cup = screen.getByRole('region', { name: 'championship' })
    expect(within(cup).getByRole('button', { name: 'enter' })).toHaveProperty('disabled', true)
  })

  it('puts the demo under the hero once the page is idle, and its status in the panel', async () => {
    function Demo({ onStatus }: HomeDemoProps) {
      useEffect(() => onStatus?.('4 bots · seed 7'), [onStatus])
      return <p>the demo</p>
    }
    await renderAt(() => <HomePage demo={Demo} />)
    const hero = screen.getByRole('region', { name: 'live demo' })
    // The loader first: the demo waits for the load event and an idle moment.
    expect(within(hero).getByRole('status').textContent).toContain('loading the demo battle')
    expect(within(hero).queryByText('the demo')).toBeNull()
    expect(await within(hero).findByText('the demo')).toBeTruthy()
    // The demo reports from an effect, which may run a task after the commit that drew it.
    await waitFor(() => expect(hero.textContent).toContain('4 bots · seed 7'))
    expect(within(hero).queryByRole('status')).toBeNull()
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
