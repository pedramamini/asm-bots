/**
 * `/tournaments` (src/features/tournaments/TournamentsPage.tsx): the cards, their chips and
 * champion, the kind and status filters, the search, and a card that updates as the runner saves.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { type MatchExecutor, TournamentRunner } from '../src/features/tournaments/runner'
import {
  createTournament,
  deleteTournament,
  listTournaments,
  saveTournament,
  type Tournament,
  type TournamentEntrant,
} from '../src/features/tournaments/store'
import {
  filterTournaments,
  statusLabel,
  TournamentsPage,
} from '../src/features/tournaments/TournamentsPage'
import { answer, useApiServer } from './api-server'

useDom()
window.scrollTo = () => {}
// The server has no tournaments: the list is this browser's (test/tournaments-server.test.tsx
// merges the server's).
useApiServer(answer('/tournaments', { tournaments: [] }))

const roster = (...slugs: string[]): TournamentEntrant[] =>
  slugs.map((slug) => ({ source: 'roster', ref: slug, name: slug }))

async function seed(
  name: string,
  kind: Tournament['kind'],
  change: Partial<Tournament> = {},
): Promise<Tournament> {
  const made = await createTournament({
    name,
    kind,
    entrants: roster('dwarf', 'imp', 'paper'),
    config: { seed: 1 },
    rounds: 1,
  })
  return saveTournament({ ...made, ...change })
}

/** An executor that never runs a match: the list's runner has nothing running. */
const idle: MatchExecutor = { runMatch: () => new Promise(() => {}) }

async function renderList(runner = new TournamentRunner(() => idle)) {
  const root = createRootRoute({ component: Outlet })
  const list = createRoute({
    getParentRoute: () => root,
    path: '/tournaments',
    component: () => <TournamentsPage runner={runner} />,
  })
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/tournaments/$id',
    component: function Detail() {
      return <p>tournament {detail.useParams().id}</p>
    },
  })
  const router = createRouter({
    routeTree: root.addChildren([list, detail]),
    history: createMemoryHistory({ initialEntries: ['/tournaments'] }),
  })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
  await act(() => router.load())
  return router
}

const names = () =>
  within(screen.getByRole('list', { name: 'tournament list' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label'))

beforeEach(async () => {
  for (const t of await listTournaments()) await deleteTournament(t.id)
})

describe('filterTournaments', () => {
  it('filters by kind and status group, and searches the name and the entrants', async () => {
    const a = await seed('spring cup', 'bracket', { status: 'paused' })
    const b = await seed('summer melee', 'melee', { status: 'failed' })
    const c = await seed('autumn league', 'round-robin')
    const all = [a, b, c]
    const pick = (f: Partial<Parameters<typeof filterTournaments>[1]>) =>
      filterTournaments(all, { kind: 'all', status: 'all', query: '', ...f }).map((t) => t.name)
    expect(pick({ kind: 'melee' })).toEqual(['summer melee'])
    expect(pick({ status: 'running' })).toEqual(['spring cup'])
    expect(pick({ status: 'finished' })).toEqual(['summer melee'])
    expect(pick({ status: 'scheduled' })).toEqual(['autumn league'])
    expect(pick({ query: 'CUP' })).toEqual(['spring cup'])
    expect(pick({ query: 'imp league' })).toEqual(['autumn league'])
    expect(pick({ query: 'nobody' })).toEqual([])
  })

  it('says how far a running tournament is', async () => {
    const t = await seed('x', 'round-robin', { status: 'running', progress: { done: 12, of: 66 } })
    expect(statusLabel(t)).toBe('running · 12 / 66')
    expect(statusLabel({ ...t, status: 'finished' })).toBe('finished')
  })
})

describe('the tournament list', () => {
  it('says there are none yet', async () => {
    await renderList()
    expect(await screen.findByText(/no tournaments yet/)).toBeTruthy()
  })

  it('shows a card per tournament with its kind, status, entrants, and champion', async () => {
    await seed('spring cup', 'bracket', { status: 'finished', champion: 1 })
    await seed('summer melee', 'melee')
    await renderList()
    const card = await screen.findByRole('listitem', { name: 'spring cup' })
    expect(card.textContent).toContain('bracket')
    expect(card.textContent).toContain('finished')
    expect(card.textContent).toContain('3 bots')
    expect(card.textContent).toContain('championimp')
    expect(card.querySelector('svg')).not.toBeNull()
    const other = screen.getByRole('listitem', { name: 'summer melee' })
    expect(other.textContent).toContain('scheduled')
    expect(other.textContent).not.toContain('champion')
  })

  it('filters by kind and status, and searches', async () => {
    await seed('spring cup', 'bracket', { status: 'running', progress: { done: 1, of: 3 } })
    await seed('summer melee', 'melee', { status: 'finished', champion: 0 })
    await seed('autumn league', 'round-robin')
    // The list's runner picks the running one up; its idle executor keeps it at 1 / 3.
    await renderList()
    await screen.findByRole('listitem', { name: 'spring cup' })
    expect(names()).toHaveLength(3)

    fireEvent.click(screen.getByRole('radio', { name: 'melee' }))
    expect(names()).toEqual(['summer melee'])
    fireEvent.click(screen.getByRole('radio', { name: 'all kinds' }))
    fireEvent.click(screen.getByRole('radio', { name: 'scheduled' }))
    expect(names()).toEqual(['autumn league'])
    fireEvent.click(screen.getByRole('radio', { name: 'any status' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'search tournaments' }), {
      target: { value: 'cup' },
    })
    expect(names()).toEqual(['spring cup'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'search tournaments' }), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText('no tournament matches.')).toBeTruthy()
    // Its one way on: every filter off, the search too.
    fireEvent.click(screen.getByRole('radio', { name: 'melee' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear the filters' }))
    expect(names()).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'all kinds' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(
      (screen.getByRole('searchbox', { name: 'search tournaments' }) as HTMLInputElement).value,
    ).toBe('')
  })

  it('opens a tournament from its card', async () => {
    const t = await seed('spring cup', 'bracket')
    const router = await renderList()
    fireEvent.click(await screen.findByRole('link', { name: /spring cup/ }))
    await act(() => router.load())
    expect(await screen.findByText(`tournament ${t.id}`)).toBeTruthy()
  })

  it('updates a card as the runner saves', async () => {
    const t = await seed('spring cup', 'round-robin')
    const runner = new TournamentRunner(() => idle)
    await renderList(runner)
    await screen.findByRole('listitem', { name: 'spring cup' })
    // The first match never answers: the runner saves `running · 0 / 3` and waits.
    void runner.start(t.id)
    expect(await screen.findByText('running · 0 / 3')).toBeTruthy()
    await act(() => runner.pause(t.id))
    expect(await screen.findByText('paused · 0 / 3')).toBeTruthy()
  })
})
