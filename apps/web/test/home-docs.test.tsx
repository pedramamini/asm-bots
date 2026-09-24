import { describe, expect, it } from 'bun:test'
import type { TickerChampionship, TickerHillEvent } from '@asmbots/protocol'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { lazy, type ReactElement, type ReactNode, useEffect } from 'react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { HomePage } from '../src/app/HomePage'
import { NotFound } from '../src/app/NotFound'
import {
  challengeText,
  countdown,
  QUIET_FEED,
  type TickerFeed,
  tickerFeed,
} from '../src/app/ticker'
import type { HomeDemoProps } from '../src/features/arena/demo/HomeDemo'
import { hang, useApiServer, WithQueries } from './api-server'
import { TICKER } from './fixtures/api'

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
    expect(within(matches).getAllByRole('columnheader')).toHaveLength(5)
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

describe('the ticker', () => {
  // 2 days and 4 hours before the next weekly (TICKER: 2026-09-26 18:00 UTC).
  const NOW = Date.parse('2026-09-24T14:00:00.000Z')
  const texts = (feed: TickerFeed) => feed.items.slice(1)

  it('says what is always so until the feed comes', () => {
    expect(tickerFeed(undefined, NOW)).toBe(QUIET_FEED)
    expect(QUIET_FEED.link).toEqual({ to: '/hills/main', label: 'open the main hill' })
  })

  it('names the latest challenge, the last champion, the next cup, and who is watching', () => {
    const feed = tickerFeed(TICKER, NOW)
    const lead = feed.items[0] as ReactElement<{ children: string }>
    expect([lead.type, lead.props.children]).toEqual(['b', '▍LIVE'])
    expect(texts(feed)).toEqual([
      'HILL "MAIN"',
      'Dwarf v1 took #1 (+3)',
      'CUP "WEEKLY 2026-09-19" won by Paper v1',
      'NEXT CHAMPIONSHIP IN 2D 04H',
      '3 ENTERED',
      '4 WATCHING',
    ])
    expect(feed.link).toEqual({ to: '/hills/main', label: 'open the main hill' })
  })

  it('counts down to the minute, then says the cup is starting, or live', () => {
    const next = TICKER.nextChampionship as TickerChampionship
    const at = (iso: string) => texts(tickerFeed(TICKER, Date.parse(iso)))[3]
    expect(at('2026-09-26T13:48:00.000Z')).toBe('NEXT CHAMPIONSHIP IN 4H 12M')
    expect(at('2026-09-26T17:59:30.000Z')).toBe('NEXT CHAMPIONSHIP IN 1M')
    expect(at('2026-09-26T18:00:00.000Z')).toBe('NEXT CHAMPIONSHIP STARTING')
    const live = tickerFeed(
      { ...TICKER, nextChampionship: { ...next, status: 'running' }, spectators: 0 },
      NOW,
    )
    expect(texts(live).slice(3)).toEqual(['CUP "WEEKLY 2026-09-26" LIVE NOW', '3 ENTERED'])
    expect(live.link).toEqual({
      to: '/tournaments/weekly-2026-09-26',
      label: 'watch weekly 2026-09-26',
    })
    expect(countdown(0)).toBe('0M')
    expect(countdown(26 * 3_600_000)).toBe('1D 02H')
  })

  it('tells each challenge, and a quiet day', () => {
    const hill = TICKER.hill as TickerHillEvent
    const event = (e: Partial<TickerHillEvent['event']>, bot = hill.bot) =>
      challengeText({ ...hill, bot, event: { ...hill.event, ...e } })
    expect(event({ delta: -2, rank: 5 })).toBe('Dwarf v1 took #5 (-2)')
    expect(event({ delta: null, rank: 9 })).toBe('Dwarf v1 took #9')
    expect(event({ kind: 'rejected', rank: null, delta: null }, null)).toBe(
      '[deleted] missed the hill',
    )
    const quiet = tickerFeed(
      { at: TICKER.at, hill: null, lastChampionship: null, nextChampionship: null, spectators: 0 },
      NOW,
    )
    expect(texts(quiet)).toEqual(['QUIET ON THE HILLS'])
    expect(quiet.link.to).toBe('/hills/main')
  })
})
