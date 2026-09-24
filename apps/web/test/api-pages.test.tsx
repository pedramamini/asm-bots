/**
 * The read API's hooks (`src/api`) and the pages that draw them, with `msw` for the Worker: the
 * hills list, a hill, a bot, a profile, and the home page's panels, loading, loaded, and refused.
 */
import { describe, expect, it } from 'bun:test'
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { lazy } from 'react'
import { useDom, window } from '../../../packages/ui/test/dom'
import { ApiRequestError, apiGet, shouldRetry } from '../src/api/client'
import { useHills, useReplay } from '../src/api/queries'
import { HomePage, lastChampionship, nextChampionship } from '../src/app/HomePage'
import { BotPage } from '../src/features/bots/BotPage'
import { HillPage } from '../src/features/hills/HillPage'
import { HillsPage } from '../src/features/hills/HillsPage'
import { rules } from '../src/features/hills/links'
import { matchScore, matchTitle, matchWinner } from '../src/features/hills/MatchesTable'
import { ProfilePage } from '../src/features/profile/ProfilePage'
import { answer, hang, refuse, renderAt, useApiServer, WithQueries } from './api-server'
import {
  CONFIG,
  DWARF,
  DWARF_DETAIL,
  HILLS,
  KEY,
  MAIN_DETAIL,
  MATCHES,
  SYSTEM,
  TOURNAMENTS,
  WEEKLY_9,
} from './fixtures/api'

useDom()
window.scrollTo = () => {}

const server = useApiServer(
  answer('/hills', HILLS),
  answer('/hills/main', MAIN_DETAIL),
  answer('/hills/main/matches', MATCHES),
  answer('/hills/main/history', { events: [] }),
  answer('/bots/roster-dwarf', DWARF_DETAIL),
  answer('/bots/roster-dwarf/versions/1', {
    version: { ...DWARF_DETAIL.versions[0], source: 'start: jmp $\n' },
  }),
  answer('/users/system', SYSTEM),
  answer('/tournaments', TOURNAMENTS),
  answer('/tournaments/t9', {
    tournament: WEEKLY_9,
    entrants: [MAIN_DETAIL.standings[0]?.bot],
    matches: [],
  }),
)

const cells = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    )

describe('apiGet', () => {
  it('reads a response through its schema', async () => {
    const read = (v: unknown) => (v as { hills: unknown[] }).hills.length
    expect(await apiGet('/hills', read)).toBe(2)
  })

  it('throws the API’s own error, with its status and code', async () => {
    server.use(refuse('/hills', 429, 'rate_limited', 'slow down.'))
    const error = await apiGet('/hills', (v) => v).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', message: 'slow down.' })
  })

  it('names a response that is not the protocol’s, and one with no error shape', async () => {
    server.use(answer('/hills', { hills: 'no' }))
    const { result } = renderHook(() => useHills(), { wrapper: WithQueries })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toMatchObject({ code: 'bad_response' })
    expect(result.current.error?.message).toContain('hills')

    server.use(http.get('*/api/hills', () => new HttpResponse('boom', { status: 502 })))
    expect(await apiGet('/hills', (v) => v).catch((e: unknown) => e)).toMatchObject({
      status: 502,
      code: 'internal',
    })
  })

  it('retries a failure twice, but never an answer the API gave', () => {
    expect(shouldRetry(0, new ApiRequestError(404, 'not_found', 'no'))).toBe(false)
    expect(shouldRetry(0, new ApiRequestError(503, 'internal', 'down'))).toBe(true)
    expect(shouldRetry(1, new ApiRequestError(0, 'network', 'gone'))).toBe(true)
    expect(shouldRetry(2, new ApiRequestError(0, 'network', 'gone'))).toBe(false)
  })

  it('does not fetch a replay without a key, and reads one with a key', async () => {
    let asked = 0
    server.use(
      http.get('*/api/replays/:key', () => {
        asked++
        return HttpResponse.json({ not: 'a replay' })
      }),
    )
    const idle = renderHook(() => useReplay(null), { wrapper: WithQueries })
    expect(idle.result.current.fetchStatus).toBe('idle')
    const keyed = renderHook(() => useReplay(KEY), { wrapper: WithQueries })
    await waitFor(() => expect(keyed.result.current.error).not.toBeNull())
    expect(asked).toBe(1)
    expect(keyed.result.current.error).toMatchObject({
      code: 'bad_response',
      message: 'isa is not well formed',
    })
  })
})

describe('the words for records', () => {
  it('says a hill’s rules in one line', () => {
    expect(rules(10, CONFIG)).toBe('10 rounds · 100k cycles · 512 B')
    expect(rules(3, { ...CONFIG, maxCycles: 1500 })).toBe('3 rounds · 1,500 cycles · 512 B')
  })

  it('names a match, its winner, and its points; a draw and a deleted bot too', () => {
    const [won, drawn] = MATCHES.matches as [
      (typeof MATCHES.matches)[0],
      (typeof MATCHES.matches)[0],
    ]
    expect([matchTitle(won), matchWinner(won), matchScore(won)]).toEqual([
      'Dwarf vs Imp',
      'Dwarf',
      '21–9',
    ])
    expect([matchTitle(drawn), matchWinner(drawn)]).toEqual(['Imp vs [deleted]', 'draw'])
  })

  it('picks the running championship, else the soonest scheduled one', () => {
    const t = WEEKLY_9
    const later = { ...t, id: 'later', startsAt: '2026-10-03T18:00:00.000Z' }
    expect(nextChampionship([later, t])?.id).toBe('t9')
    expect(nextChampionship([later, { ...t, id: 'now', status: 'running' }])?.id).toBe('now')
    expect(nextChampionship([{ ...t, status: 'finished' }])).toBeNull()
    // A user's tournament is no championship, running or not.
    expect(
      nextChampionship([{ ...t, id: 'mine', ownerId: 'u1', status: 'running' }, later])?.id,
    ).toBe('later')
  })
})

describe('/hills', () => {
  it('lists each hill with its rules, how full it is, and its king', async () => {
    const router = await renderAt('/hills', HillsPage)
    const table = await screen.findByRole('table', { name: 'hills' })
    await waitFor(() => expect(cells(table)).toHaveLength(2))
    expect(cells(table)).toEqual([
      ['main', '10 rounds · 100k cycles · 512 B', '3 / 32', 'Paper', '321'],
      ['tiny', '10 rounds · 50k cycles · 256 B', '0 / 16', 'none', ''],
    ])
    expect(screen.getByRole('region', { name: 'hills' }).textContent).toContain('2 hills')
    fireEvent.click(within(table).getByText('tiny'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/hills/tiny'))
  })

  it('says what went wrong when the read fails', async () => {
    server.use(refuse('/hills', 500, 'internal', 'internal error (request r-1)'))
    await renderAt('/hills', HillsPage)
    expect(await screen.findByText('could not load: internal error (request r-1)')).toBeTruthy()
  })
})

describe('/hills/$slug', () => {
  it('shows the standings, king first, and the recent matches that open replays', async () => {
    const router = await renderAt('/hills/main', () => <HillPage slug="main" />)
    const standings = await screen.findByRole('table', { name: 'standings' })
    await waitFor(() => expect(cells(standings)).toHaveLength(3))
    expect(cells(standings)[0]).toEqual([
      '1',
      'Paper',
      'ASM Bots',
      '321',
      '1,500',
      '2',
      '0',
      '0',
      '2',
      'challenge ▾',
    ])
    // With no %author, the owner is the author.
    expect(cells(standings)[2]?.[2]).toBe('system')
    expect(screen.getByText(/3 of 32 places taken/)).toBeTruthy()

    const matches = await screen.findByRole('table', { name: 'recent matches' })
    await waitFor(() => expect(cells(matches)).toHaveLength(2))
    expect(cells(matches)[0]).toEqual(['Dwarf vs Imp', 'Dwarf', '21–9', 'verify', 'watch'])
    fireEvent.click(within(matches).getByText('Dwarf vs Imp'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/arena/${KEY}`))
  })

  it('says so when there is no such hill', async () => {
    server.use(refuse('/hills/nope', 404, 'not_found', 'no hill nope'))
    server.use(refuse('/hills/nope/matches', 404, 'not_found', 'no hill nope'))
    server.use(refuse('/hills/nope/history', 404, 'not_found', 'no hill nope'))
    await renderAt('/hills/nope', () => <HillPage slug="nope" />)
    expect(await screen.findByText('there is no hill named nope.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'all hills' }).getAttribute('href')).toBe('/hills')
  })
})

describe('/bots/$id', () => {
  it('shows the bot’s card, its places, its versions, and its public source', async () => {
    await renderAt('/bots/roster-dwarf', () => <BotPage id="roster-dwarf" />)
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Dwarf')
    expect(screen.getByText('Bomb every 4th byte, walking backward')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'system' }).getAttribute('href')).toBe('/u/system')
    expect(cells(screen.getByRole('table', { name: 'hill placements' }))).toEqual([
      ['main', 'v1', '2', '145', '1/0/1'],
    ])
    expect(cells(screen.getByRole('table', { name: 'versions' }))[0]?.slice(0, 2)).toEqual([
      'v1',
      '23 B',
    ])
    const source = screen.getByRole('region', { name: 'source' })
    await waitFor(() => expect(source.querySelector('pre')?.textContent).toBe('start: jmp $\n'))
  })

  it('says the source is not public when the version comes without one', async () => {
    server.use(answer('/bots/roster-dwarf/versions/1', { version: DWARF_DETAIL.versions[0] }))
    await renderAt('/bots/roster-dwarf', () => <BotPage id="roster-dwarf" />)
    expect(await screen.findByText('its source is not public.')).toBeTruthy()
  })

  it('does not tell a private bot from a missing one', async () => {
    server.use(refuse('/bots/secret', 404, 'not_found', 'no bot secret'))
    await renderAt('/bots/secret', () => <BotPage id="secret" />)
    expect(await screen.findByText('there is no bot secret, or it is private.')).toBeTruthy()
  })
})

describe('/u/$handle', () => {
  it('shows the user, when they joined, and their public bots', async () => {
    await renderAt('/u/system', () => <ProfilePage handle="system" />)
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('system')
    expect(screen.getByRole('region', { name: 'profile' }).textContent).toContain(
      'joined 2026-09-24',
    )
    const bots = screen.getByRole('table', { name: 'bots' })
    expect(cells(bots)).toEqual([['Dwarf', 'public', '2026-09-24']])
    expect(within(bots).getByRole('link', { name: 'Dwarf' }).getAttribute('href')).toBe(
      '/bots/roster-dwarf',
    )
    const hills = screen.getByRole('table', { name: 'best hill ranks' })
    expect(cells(hills)).toEqual([['main', '2', 'Dwarf', '1,500']])
    expect(within(hills).getByRole('link', { name: 'main' }).getAttribute('href')).toBe(
      '/hills/main',
    )
    const cups = screen.getByRole('table', { name: 'championship results' })
    expect(cells(cups)).toEqual([['Weekly 8', 'Dwarf', '4/0/1', 'champion']])
    expect(within(cups).getByRole('link', { name: 'Weekly 8' }).getAttribute('href')).toBe(
      '/tournaments/t8',
    )
  })

  it('says so when there is no such user', async () => {
    server.use(refuse('/users/ghost', 404, 'not_found', 'no user ghost'))
    await renderAt('/u/ghost', () => <ProfilePage handle="ghost" />)
    expect(await screen.findByText('there is no user ghost.')).toBeTruthy()
  })
})

describe('/ panels', () => {
  const NeverLoads = lazy(() => new Promise<never>(() => {}))

  it('fills the main hill’s top 10, its recent matches, and the next championship', async () => {
    await renderAt('/', () => <HomePage demo={NeverLoads} />)
    const hill = screen.getByRole('region', { name: 'main hill' })
    const top = within(hill).getByRole('table', { name: 'main hill, top 10' })
    await waitFor(() => expect(cells(top)).toHaveLength(3))
    expect(cells(top)[0]).toEqual(['1', 'Paper', 'ASM Bots', '321', '1,500', '2'])
    expect(hill.textContent).toContain('3 of 32')

    const recent = screen.getByRole('region', { name: 'recent matches' })
    await waitFor(() => expect(within(recent).getAllByRole('row')).toHaveLength(3))
    expect(within(recent).getByRole('link', { name: 'watch' }).getAttribute('href')).toBe(
      `/arena/${KEY}`,
    )

    const cup = screen.getByRole('region', { name: 'championship' })
    await waitFor(() => expect(cup.textContent).toContain('Weekly 9'))
    expect(cup.textContent).toContain('2026-09-26')
    await waitFor(() => expect(cup.textContent).toContain('entrants so far1'))
    expect(within(cup).getByRole('link', { name: 'Weekly 9' }).getAttribute('href')).toBe(
      '/tournaments/t9',
    )
    // Its entries are open, and nobody is signed in.
    expect(await within(cup).findByRole('button', { name: 'sign in to enter' })).toBeTruthy()
    expect(cup.textContent).not.toContain('last:')
  })

  it('names the champion of the championship that finished last', async () => {
    const last = {
      ...WEEKLY_9,
      id: 't8',
      name: 'Weekly 8',
      status: 'finished' as const,
      championId: DWARF.versionId,
      finishedAt: '2026-09-19T18:40:00.000Z',
    }
    const earlier = { ...last, id: 't7', name: 'Weekly 7', finishedAt: '2026-09-12T18:40:00.000Z' }
    const summary = (t: typeof last) => ({
      tournament: t,
      entrants: 5,
      done: 5,
      of: 5,
      champion: DWARF,
    })
    const cup8 = summary(last)
    expect(lastChampionship([summary(earlier), cup8])).toBe(cup8)
    expect(lastChampionship([{ ...cup8, tournament: { ...last, ownerId: 'u1' } }])).toBeNull()
    server.use(
      answer('/tournaments', {
        tournaments: [...TOURNAMENTS.tournaments, summary(earlier), cup8],
      }),
    )
    await renderAt('/', () => <HomePage demo={NeverLoads} />)
    const cup = screen.getByRole('region', { name: 'championship' })
    await waitFor(() => expect(cup.textContent).toContain('last: Dwarf won Weekly 8'))
    expect(await within(cup).findByRole('button', { name: 'sign in to enter' })).toBeTruthy()
  })

  it('holds skeletons while the server has not answered', async () => {
    server.use(hang('/hills/main'), hang('/hills/main/matches'), hang('/tournaments'))
    await renderAt('/', () => <HomePage demo={NeverLoads} />)
    const hill = screen.getByRole('region', { name: 'main hill' })
    expect(within(hill).getByText('loading')).toBeTruthy()
    expect(
      within(hill)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['rank', 'bot', 'author', 'score', 'rating', 'age'])
  })

  it('says none is scheduled when no championship is', async () => {
    server.use(answer('/tournaments', { tournaments: [] }))
    await renderAt('/', () => <HomePage demo={NeverLoads} />)
    const cup = screen.getByRole('region', { name: 'championship' })
    await waitFor(() => expect(cup.textContent).toContain('none scheduled'))
  })
})
