/**
 * Tournament links (src/features/tournaments/share.ts) and the detail page
 * (TournamentPage.tsx, TournamentHeader.tsx): a link carries each kind whole and the page rebuilds
 * its bracket, standings, and champion; a local bot rides along as bytes, one that does not
 * assemble is left out; a broken link says why; the page shows this browser's tournament with its
 * controls, or a link's read only, and `share` copies the link.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { type BattleConfigInput, DEFAULT_CONFIG } from '@asmbots/engine'
import { toBase64Url } from '@asmbots/protocol'
import { bracket, meleeStandings, roundRobin, runMatch } from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import { deflateSync, strToU8 } from 'fflate'
import { useDom, window } from '../../../packages/ui/test/dom'
import {
  entrantBots,
  type MatchExecutor,
  TournamentRunner,
} from '../src/features/tournaments/runner'
import {
  INLINE_BYTES_UP_TO,
  leftOut,
  readTournamentFragment,
  TOURNAMENT_LINK_FORMAT,
  tournamentFragment,
  tournamentUrl,
} from '../src/features/tournaments/share'
import {
  deleteTournament,
  listTournaments,
  saveTournament,
  type Tournament,
  type TournamentEntrant,
} from '../src/features/tournaments/store'
import { TournamentPage } from '../src/features/tournaments/TournamentPage'
import { watchTarget } from '../src/features/tournaments/watch'
import { refuse, testQueryClient, useApiServer } from './api-server'
import { pickShare } from './share-menu'

useDom()
// The server has no tournament by the id this browser has none of either.
useApiServer(refuse('/tournaments/zz', 404, 'not_found', 'no tournament zz'))
window.scrollTo = () => {}

const CONFIG: BattleConfigInput = { maxCycles: 4_000, maxProcesses: 64, minSpacing: 1024, seed: 7 }

const MINE: TournamentEntrant = {
  source: 'local',
  ref: 'mine.asm',
  name: 'Mine',
  code: '%name "Mine"\nstart: jmp start\n',
}
/** A local bot that does not assemble: every one that does fits `INLINE_BYTES_UP_TO`. */
const JUNK: TournamentEntrant = { source: 'local', ref: 'junk.asm', name: 'Junk', code: 'nope r9' }
const roster = (...names: string[]): TournamentEntrant[] =>
  names.map((name) => ({ source: 'roster', ref: name.toLowerCase(), name }))
const FOUR = [...roster('Dwarf', 'Imp', 'Paper'), MINE]

const base = {
  config: CONFIG,
  rounds: 2,
  createdAt: 1,
  updatedAt: 2,
} as const

function roundRobinCup(entrants = FOUR, upTo = 6): Tournament {
  const whole = roundRobin(entrantBots(entrants), CONFIG, { rounds: 2 })
  const done = upTo === whole.matches.length
  return {
    ...base,
    id: 'rr',
    name: 'league',
    kind: 'round-robin',
    entrants,
    status: done ? 'finished' : 'running',
    matches: whole.matches.slice(0, upTo),
    standings: done ? whole.standings : undefined,
    progress: { done: upTo, of: whole.matches.length },
    champion: done ? (whole.standings[0]?.entrant ?? null) : null,
  }
}

function bracketCup(): Tournament {
  const entrants = [...FOUR, ...roster('Stone')]
  const b = bracket(entrantBots(entrants), CONFIG, {
    seeding: { random: 99 },
    thirdPlace: true,
    rounds: 2,
  })
  return {
    ...base,
    id: 'br',
    name: 'cup',
    kind: 'bracket',
    entrants,
    status: 'finished',
    seeding: { random: 99 },
    thirdPlace: true,
    bracket: b,
    matches: b.matches.flatMap((m) => (m.result === null ? [] : [m.result])),
    progress: { done: 5, of: 5 },
    champion: b.matches[b.final]?.winner ?? null,
  }
}

/** A melee of 3 rounds, 2 of them played. */
function meleeCup(): Tournament {
  const bots = entrantBots(FOUR)
  const match = runMatch(bots, CONFIG, 3, { through: 2 })
  const standings = meleeStandings(match, CONFIG)
  return {
    ...base,
    id: 'ml',
    name: 'melee',
    kind: 'melee',
    entrants: FOUR,
    rounds: 3,
    status: 'running',
    matches: [match],
    standings,
    progress: { done: 2, of: 3 },
    champion: null,
  }
}

/** A round robin not started, one of whose bots does not assemble. */
function withJunk(): Tournament {
  return {
    ...base,
    id: 'junk',
    name: 'junk cup',
    kind: 'round-robin',
    entrants: [...roster('Dwarf', 'Imp'), JUNK],
    status: 'scheduled',
    matches: [],
    progress: { done: 0, of: 0 },
    champion: null,
  }
}

function read(t: Tournament, id = t.id): Tournament {
  const got = readTournamentFragment(`#${tournamentFragment(t)}`, id)
  if (got.kind !== 'ok') throw new Error(`not read: ${JSON.stringify(got)}`)
  return got.tournament
}

/** The fragment of a hand-made link: `json` deflated. */
const fragmentOf = (json: unknown) =>
  `#t=${toBase64Url(deflateSync(strToU8(JSON.stringify(json)), { level: 9 }))}`

/** The link JSON of `t`, to tamper with. */
function linkJson(t: Tournament): Record<string, unknown> {
  return {
    format: TOURNAMENT_LINK_FORMAT,
    name: t.name,
    kind: t.kind,
    status: t.status,
    config: { ...DEFAULT_CONFIG, ...t.config },
    rounds: t.rounds,
    entrants: t.entrants.map(({ source, ref, name }) => ({ source, ref, name })),
    matches: t.matches,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

const reason = (fragment: string) => {
  const got = readTournamentFragment(fragment, 'x')
  return got.kind === 'broken' ? got.reason : got.kind
}

describe('a tournament link', () => {
  it('carries a round robin; the page rebuilds its standings and champion', () => {
    const t = roundRobinCup()
    const shared = read(t)
    expect(shared).toMatchObject({
      id: 'rr',
      name: 'league',
      kind: 'round-robin',
      status: 'finished',
      rounds: 2,
      matches: t.matches,
      standings: t.standings,
      progress: t.progress,
      champion: t.champion,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(shared.config).toEqual({ ...DEFAULT_CONFIG, ...CONFIG })
  })

  it('carries a bracket with random seeds and a third-place match, played in id order', () => {
    const t = bracketCup()
    const shared = read(t)
    expect(shared.bracket).toEqual(t.bracket)
    expect(shared).toMatchObject({
      seeding: { random: 99 },
      thirdPlace: true,
      progress: { done: 5, of: 5 },
      champion: t.champion,
    })
  })

  it('carries a melee in progress, which reads as paused: nothing runs it here', () => {
    const t = meleeCup()
    const shared = read(t)
    expect(shared.status).toBe('paused')
    expect(shared.matches[0]?.rounds).toHaveLength(2)
    expect(shared.standings).toEqual(t.standings)
    expect(shared.progress).toEqual({ done: 2, of: 3 })
    expect(shared.champion).toBeNull()
  })

  it('takes the page’s id, not the one it was shared from', () => {
    expect(read(roundRobinCup(), 'elsewhere').id).toBe('elsewhere')
    expect(tournamentUrl('https://asmbots.dev', roundRobinCup())).toStartWith(
      'https://asmbots.dev/tournaments/rr#t=',
    )
  })

  it('inlines a local bot’s bytes, so its rounds can be watched from the link', () => {
    const t = roundRobinCup()
    const shared = read(t)
    const mine = shared.entrants[3] as TournamentEntrant
    expect(mine.code).toBeUndefined()
    expect(mine.bytes).toEqual(entrantBots([MINE])[0]?.bytes)
    expect(leftOut(t)).toEqual([])
    // Match 3 is Dwarf v Mine: its round rebuilds from the bytes to the recorded hash.
    const result = shared.matches[2]
    expect(result?.names).toEqual(['Dwarf', 'Mine'])
    const target = watchTarget(shared, [0, 3], result!, result!.rounds[0]!)
    expect(target.bots.map((b) => b.name)).toEqual(['Dwarf', 'Mine'])
    expect(target.resultHash).toBe(result!.rounds[0]!.resultHash)
  })

  it('leaves out a local bot with no machine code: its rounds cannot be watched', () => {
    const t = withJunk()
    expect(leftOut(t).map((e) => e.name)).toEqual(['Junk'])
    const shared = read(t)
    expect(shared.entrants[2]).toEqual({ source: 'local', ref: 'junk.asm', name: 'Junk' })
    expect(() => entrantBots(shared.entrants)).toThrow('Junk: no such bot')
    expect(shared).toMatchObject({ status: 'scheduled', progress: { done: 0, of: 3 } })
  })

  it('says why a link is broken', () => {
    expect(readTournamentFragment('#src=abc', 'x').kind).toBe('none')
    expect(reason('#t=!!!')).toBe('it does not decode, so the link may be cut short')
    expect(reason(fragmentOf({ format: 'nope' }))).toBe(
      `it is not a tournament of format ${TOURNAMENT_LINK_FORMAT}`,
    )
    const rr = roundRobinCup()
    const swapped = linkJson(rr)
    swapped.matches = [rr.matches[1], rr.matches[0]]
    expect(reason(fragmentOf(swapped))).toBe('match 1 is not of its bots')
    const extra = linkJson(rr)
    extra.matches = [...rr.matches, rr.matches[0]]
    expect(reason(fragmentOf(extra))).toBe('it has more matches than its 6')
    const crowd = linkJson(meleeCup())
    crowd.entrants = roster(...Array.from({ length: 17 }, (_, i) => `Bot${i}`))
    expect(reason(fragmentOf(crowd))).toBe('it has 17 bots, and a melee has 2 to 16')
    const br = bracketCup()
    const unseeded = linkJson(br)
    unseeded.seeding = 'given'
    expect(reason(fragmentOf(unseeded))).toMatch(/^match \d+ is not of its bots$/)
    const giant = linkJson(meleeCup())
    ;(giant.entrants as { bytes?: string }[])[0]!.bytes = toBase64Url(new Uint8Array(600))
    ;(giant.entrants as { source: string }[])[0]!.source = 'local'
    expect(reason(fragmentOf(giant))).toBe(`Dwarf's bytes must be 1..${INLINE_BYTES_UP_TO}`)
  })
})

/** An executor that never runs a match. */
const idle: MatchExecutor = { runMatch: () => new Promise(() => {}) }

async function renderPage(path: string) {
  const runner = new TournamentRunner(() => idle)
  const root = createRootRoute({ component: Outlet })
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/tournaments/$id',
    component: function Detail() {
      return <TournamentPage id={detail.useParams().id} runner={runner} />
    },
  })
  const list = createRoute({
    getParentRoute: () => root,
    path: '/tournaments',
    component: () => <p>the list</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([list, detail]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={testQueryClient()}>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  await act(() => router.load())
  return router
}

describe('the tournament page', () => {
  let writeText = mock((_text: string) => Promise.resolve())
  let clipboard: PropertyDescriptor | undefined
  beforeEach(async () => {
    for (const t of await listTournaments()) await deleteTournament(t.id)
    writeText = mock((_text: string) => Promise.resolve())
    clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })
  afterEach(() => {
    if (clipboard === undefined) Reflect.deleteProperty(globalThis.navigator, 'clipboard')
    else Object.defineProperty(globalThis.navigator, 'clipboard', clipboard)
  })

  it('shows this browser’s tournament: header, controls, entrants, and its view', async () => {
    const t = roundRobinCup()
    await saveTournament(t)
    await renderPage('/tournaments/rr')
    const header = await screen.findByRole('region', { name: 'league' })
    expect(header.textContent).toContain('round robin')
    expect(header.textContent).toContain('finished')
    expect(within(header).getByRole('button', { name: 'auto-watch' })).toBeTruthy()
    expect(within(header).queryByText('shared')).toBeNull()
    const entrants = within(header).getByRole('list', { name: 'entrants' })
    expect(
      within(entrants)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Dwarf', 'Imp', 'Paper', 'Mine'])
    const champion = t.entrants[t.champion as number]?.name
    expect(within(entrants).getByTitle('champion').textContent).toBe(champion as string)
    expect(screen.getByRole('table', { name: 'results matrix' })).toBeTruthy()

    await pickShare(header, 'copy link')
    await screen.findByText('link copied.')
    const url = writeText.mock.calls[0]?.[0] as string
    expect(url).toStartWith('http://localhost/tournaments/rr#t=')
    expect(read(t).matches).toEqual(
      (readTournamentFragment(new URL(url).hash, 'rr') as { tournament: Tournament }).tournament
        .matches,
    )
  })

  it('shows a link’s tournament read only when this browser has none by that id', async () => {
    const t = meleeCup()
    await renderPage(`/tournaments/ml#${tournamentFragment(t)}`)
    const header = await screen.findByRole('region', { name: 'melee' })
    expect(header.textContent).toContain('shared')
    expect(header.textContent).toContain('paused · 2 / 3')
    expect(within(header).queryByRole('button', { name: 'auto-watch' })).toBeNull()
    expect(within(header).queryByRole('button', { name: 'resume' })).toBeNull()
    expect(screen.getByRole('region', { name: 'standings' })).toBeTruthy()
    expect(await listTournaments()).toEqual([])
  })

  it('says so when the link is broken, and when there is no link', async () => {
    await renderPage('/tournaments/zz#t=!!!')
    expect(
      await screen.findByText(
        'this tournament link is broken: it does not decode, so the link may be cut short.',
      ),
    ).toBeTruthy()
  })

  it('asks the server for a tournament this browser has not, and says when it has none', async () => {
    await renderPage('/tournaments/zz')
    expect(
      await screen.findByText(
        'there is no tournament by that id, in this browser or on the server.',
      ),
    ).toBeTruthy()
  })

  it('tells the sharer which local bots the link leaves out', async () => {
    await saveTournament(withJunk())
    await renderPage('/tournaments/junk')
    await pickShare(await screen.findByRole('region', { name: 'junk cup' }), 'copy link')
    expect(
      await screen.findByText(
        'link copied without the machine code of Junk: its rounds cannot be watched from it.',
      ),
    ).toBeTruthy()
  })
})
