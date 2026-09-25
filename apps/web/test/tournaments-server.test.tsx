/**
 * Server tournaments in the web app (src/features/tournaments/server.ts, ServerTournament.tsx,
 * EnterModal.tsx, TournamentsPage.tsx) against `msw`: the API's detail as the record the local
 * views draw (a bracket, a round robin in schedule order, a melee), a round of a server match
 * watched from its replay to its recorded hash, the list with the server's cards among this
 * browser's, and the page: its chips, its live room, `enter`, and `start`.
 */
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { LoadedBot } from '@asmbots/engine'
import {
  type BotLabel,
  type BotVersion,
  buildReplay,
  type LiveMessage,
  type Match,
  type Me,
  type MyBot,
  matchResultHash,
  type Tournament as ServerRecord,
  type TournamentDetail,
  type TournamentSummary,
} from '@asmbots/protocol'
import {
  type Bracket,
  bracket,
  champion,
  type MatchResult,
  meleeStandings,
  melee as playMelee,
  roundRobin,
  standingsFromMatches,
} from '@asmbots/tourney'
import { ToastProvider } from '@asmbots/ui'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { stubLayout, useDom, window } from '../../../packages/ui/test/dom'
import type { ArenaClient } from '../src/features/arena/worker/client'
import { BracketView } from '../src/features/tournaments/BracketView'
import { takesEntries } from '../src/features/tournaments/entry'
import { type MatchExecutor, TournamentRunner } from '../src/features/tournaments/runner'
import { entrantNames, fromServer } from '../src/features/tournaments/server'
import {
  createTournament,
  deleteTournament,
  listTournaments,
} from '../src/features/tournaments/store'
import { TournamentPage } from '../src/features/tournaments/TournamentPage'
import { TournamentsPage } from '../src/features/tournaments/TournamentsPage'
import { answer, answerPost, renderAt, useApiServer, WithQueries } from './api-server'
import { stubCanvas } from './fake-canvas'
import { FakeSockets, LIVE_CONFIG } from './live-fakes'
import { manualSchedule, type SessionWorker, sessionClient } from './session-worker'

useDom()
window.scrollTo = () => {}

const T = '2026-09-24T12:00:00.000Z'
/** Far past any run of these tests: an open tournament with this deadline takes entries. */
const OPEN_UNTIL = '2099-09-25T18:00:00.000Z'
const SEED = 7
const ROUNDS = 2
const BATTLE = { ...LIVE_CONFIG, seed: SEED }

/** `jmp short $`: lives to the cycle cap. `dat`: dies on its first instruction. */
const loop = (name: string): LoadedBot => ({ name, bytes: Uint8Array.from([0xeb, 0xfe]) })
const dat = (name: string): LoadedBot => ({ name, bytes: Uint8Array.from([0x00, 0x00]) })

const label = (i: number, name: string, owner = 'alice'): BotLabel => ({
  botId: `b${i}`,
  versionId: `v${i}`,
  slug: `bot-${i}`,
  name,
  version: 1,
  owner,
  author: null,
})

/** Five entrants, two of them named Loop: the page names them apart by owner. */
const BOTS = [loop('Loop'), dat('Dat'), loop('Spin'), dat('Halt'), loop('Loop')]
const LABELS = BOTS.map((b, i) => label(i, b.name, i === 4 ? 'bob' : 'alice'))

function record(change: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 't1',
    slug: 'spring-cup-12345678',
    name: 'spring cup',
    kind: 'bracket',
    status: 'finished',
    config: { rounds: ROUNDS, seed: SEED, battle: LIVE_CONFIG, thirdPlace: true },
    bracket: null,
    ownerId: null,
    startsAt: T,
    createdAt: T,
    entry: 'invite',
    entryClosesAt: null,
    championId: null,
    finishedAt: null,
    ...change,
  }
}

/** A replay key per spec id: 64 hex digits. */
const replayKeyOf = (spec: number) => String(spec).padStart(64, '0')

/** The row the `Runner` stores for `result`, match `spec` of tournament t1. */
function row(spec: number, participants: string[], result: MatchResult): Match {
  return {
    id: `t1-${spec}`,
    tournamentId: 't1',
    hillId: null,
    participants,
    rounds: ROUNDS,
    seed: SEED,
    key: result.key,
    result: {
      points: [...result.points],
      survivors: [...(result.rounds[result.rounds.length - 1]?.survivors ?? [])],
      resultHash: matchResultHash(result.rounds),
      rounds: result.rounds.map((r) => ({
        ...r,
        order: [...r.order],
        points: [...r.points],
        survivors: [...r.survivors],
        survival: [...r.survival],
      })),
    },
    replayKey: replayKeyOf(spec),
    finishedAt: T,
  }
}

/** The five, played out as a bracket with its third-place match, as the `Runner` would. */
const PLAYED: Bracket = bracket(BOTS, BATTLE, {
  seeding: 'given',
  thirdPlace: true,
  rounds: ROUNDS,
})
const DONE = PLAYED.matches.filter((m) => m.result !== null)
const ROWS = DONE.map((m) =>
  row(
    m.id,
    m.slots.map((s) => `v${s.entrant}`),
    m.result as MatchResult,
  ),
)
const FINISHED: TournamentDetail = {
  tournament: record({ bracket: PLAYED, championId: `v${champion(PLAYED)}`, finishedAt: T }),
  entrants: LABELS,
  matches: ROWS,
}

describe('fromServer', () => {
  it('reads a bracket: its entrants named apart, its champion, its replays by match key', () => {
    const t = fromServer(FINISHED)
    const names = ['Loop (alice)', 'Dat', 'Spin', 'Halt', 'Loop (bob)']
    expect(entrantNames(LABELS)).toEqual(names)
    expect(t).toMatchObject({
      kind: 'bracket',
      status: 'finished',
      rounds: ROUNDS,
      thirdPlace: true,
    })
    expect(t.entrants).toEqual(names.map((name, i) => ({ source: 'server', ref: `v${i}`, name })))
    expect(t.bracket?.names).toEqual(names)
    expect(t.champion).toBe(champion(PLAYED))
    // 5 bots play 4 matches, and the third-place match.
    expect(DONE).toHaveLength(5)
    expect(t.matches).toHaveLength(5)
    expect(t.progress).toEqual({ done: 5, of: 5 })
    expect(t.config).toEqual(BATTLE)
    expect(t.replays).toEqual(
      Object.fromEntries(DONE.map((m) => [m.result?.key, replayKeyOf(m.id)])),
    )
    // While it runs, the bracket says how far it is.
    const first = PLAYED.matches.find((m) => m.result !== null)
    const running = fromServer({
      ...FINISHED,
      tournament: record({ status: 'running', bracket: { ...PLAYED } }),
    })
    expect(running.status).toBe('running')
    expect(running.champion).toBeNull()
    expect(first).toBeDefined()
  })

  it('reads a round robin in schedule order, up to the first match not stored', () => {
    const four = BOTS.slice(0, 4)
    const { schedule, matches } = roundRobin(four, BATTLE, { rounds: ROUNDS })
    const names = four.map((b) => b.name)
    // Stored: matches 0, 1 and 3; 2 is not, so the page shows 0 and 1.
    const rows = [0, 1, 3].map((spec) =>
      row(
        spec,
        (schedule[spec]?.entrants ?? []).map((e) => `v${e}`),
        matches[spec] as MatchResult,
      ),
    )
    const t = fromServer({
      tournament: record({ kind: 'roundrobin', status: 'running' }),
      entrants: LABELS.slice(0, 4),
      matches: [rows[2] as Match, rows[0] as Match, rows[1] as Match],
    })
    expect(t.kind).toBe('round-robin')
    expect(t.matches.map((m) => m.points)).toEqual([0, 1].map((i) => matches[i]?.points))
    const first = [0, 1].map((i) => ({
      entrants: schedule[i]?.entrants ?? [],
      result: matches[i] as MatchResult,
    }))
    expect(t.standings).toEqual(standingsFromMatches(names, first))
    expect(t.progress).toEqual({ done: 2, of: 6 })
  })

  it('reads a melee’s one match and its standings', () => {
    const three = BOTS.slice(0, 3)
    const { match } = playMelee(three, BATTLE, ROUNDS)
    const t = fromServer({
      tournament: record({ kind: 'melee', championId: 'v0' }),
      entrants: LABELS.slice(0, 3),
      matches: [row(0, ['v0', 'v1', 'v2'], match)],
    })
    expect(t.matches).toHaveLength(1)
    expect(t.standings).toEqual(
      meleeStandings({ ...match, names: ['Loop', 'Dat', 'Spin'] }, BATTLE),
    )
    expect(t.champion).toBe(0)
  })

  it('says whether an open tournament takes entries', () => {
    const open = record({ entry: 'open', status: 'scheduled', entryClosesAt: OPEN_UNTIL })
    expect(takesEntries(open)).toBe(true)
    expect(takesEntries(open, Date.parse(OPEN_UNTIL))).toBe(false)
    expect(takesEntries({ ...open, status: 'running' })).toBe(false)
    expect(takesEntries({ ...open, entry: 'invite' })).toBe(false)
  })
})

let restore: (() => void)[] = []
const made: { client: ArenaClient; worker: SessionWorker }[] = []
beforeAll(() => {
  restore = [
    stubCanvas(window),
    stubLayout('clientWidth', () => 800),
    stubLayout('clientHeight', () => 600),
  ]
})
afterAll(() => {
  for (const undo of restore) undo()
  for (const { client } of made.splice(0)) client.dispose()
})

const server = useApiServer()

const nodes = () => document.querySelectorAll<SVGGElement>('[data-match-id]')
const node = (id: number) => document.querySelector(`[data-match-id="${id}"]`) as SVGGElement

describe('watching a server match', () => {
  it('loads the match’s replay and plays the round to its recorded hash', async () => {
    const final = PLAYED.matches[PLAYED.final]
    const result = final?.result as MatchResult
    const pair = final?.slots.map((s) => BOTS[s.entrant as number] as LoadedBot) ?? []
    const replay = await buildReplay({ bots: pair, config: BATTLE, rounds: ROUNDS, match: result })
    server.use(answer(`/replays/${replayKeyOf(PLAYED.final)}`, replay))
    const frames = manualSchedule()
    const createClient = () => {
      const next = sessionClient(frames.schedule)
      made.push(next)
      return next.client
    }
    render(
      <WithQueries>
        <ToastProvider>
          <BracketView tournament={fromServer(FINISHED)} createClient={createClient} />
        </ToastProvider>
      </WithQueries>,
    )
    expect(nodes()).toHaveLength(8)
    fireEvent.click(node(PLAYED.final))
    const panel = screen.getByRole('region', { name: 'match' })
    // The server played it and stored it: it can be verified here.
    expect(within(panel).getByRole('button', { name: /^verify final · match \d+$/ })).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'watch round 2' }))
    const dialog = await screen.findByRole('dialog')
    const round = result.rounds[1]
    const last = () => made[made.length - 1] as (typeof made)[0]
    await waitFor(() => expect(last().worker.sent.some((r) => r.type === 'load')).toBe(true))
    const load = last().worker.sent.find((r) => r.type === 'load')
    expect(load).toMatchObject({ rounds: 1, config: { ...BATTLE, seed: round?.seed } })
    const order = (round?.order ?? []).map((k) => pair[k]?.name)
    expect(load?.type === 'load' && load.bots.map((b) => b.name)).toEqual(order)
    await act(async () => {
      for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    })
    last().client.seek(LIVE_CONFIG.maxCycles)
    await waitFor(() => expect(within(dialog).getByText('verified')).toBeTruthy())
  })

  it('says so when the server has no replay of the match', async () => {
    const t = fromServer({
      ...FINISHED,
      matches: FINISHED.matches.map((m) => ({ ...m, replayKey: null })),
    })
    render(
      <WithQueries>
        <ToastProvider>
          <BracketView tournament={t} />
        </ToastProvider>
      </WithQueries>,
    )
    fireEvent.click(node(PLAYED.final))
    const panel = screen.getByRole('region', { name: 'match' })
    // No replay, no inputs: nothing to verify either.
    expect(within(panel).queryByRole('button', { name: /^verify/ })).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'watch round 1' }))
    expect(
      await screen.findByText('cannot watch: the server has not stored this match.'),
    ).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/** An executor that never runs a match: the pages' runner has nothing running. */
const idle: MatchExecutor = { runMatch: () => new Promise(() => {}) }

const summary = (
  t: ServerRecord,
  change: Partial<Omit<TournamentSummary, 'tournament'>> = {},
): TournamentSummary => ({ tournament: t, entrants: 5, done: 0, of: 5, champion: null, ...change })

describe('the tournament list', () => {
  beforeEach(async () => {
    for (const t of await listTournaments()) await deleteTournament(t.id)
  })

  it('shows the server’s tournaments among this browser’s, marked, running first', async () => {
    await createTournament({
      name: 'my local cup',
      kind: 'bracket',
      entrants: [
        { source: 'roster', ref: 'dwarf', name: 'Dwarf' },
        { source: 'roster', ref: 'imp', name: 'Imp' },
      ],
      config: { seed: 1 },
      rounds: 1,
    })
    server.use(
      answer('/tournaments', {
        tournaments: [
          summary(
            record({
              id: 'r1',
              name: 'live league',
              kind: 'roundrobin',
              status: 'running',
              ownerId: 'u9',
              startsAt: '2026-09-20T00:00:00.000Z',
            }),
            { done: 2, of: 10 },
          ),
          summary(
            record({ id: 'w1', name: 'weekly 2026-09-19', startsAt: '2026-09-19T18:00:00.000Z' }),
            {
              done: 4,
              of: 4,
              champion: label(2, 'Dwarf', 'system'),
            },
          ),
          summary(
            record({
              id: 'o1',
              name: 'open melee',
              kind: 'melee',
              status: 'scheduled',
              entry: 'open',
              entryClosesAt: OPEN_UNTIL,
              ownerId: 'u9',
              startsAt: null,
              createdAt: '2026-09-23T00:00:00.000Z',
            }),
            { entrants: 3, of: 1 },
          ),
        ],
      }),
    )
    const runner = new TournamentRunner(() => idle)
    await renderAt('/tournaments', () => <TournamentsPage runner={runner} />)
    const list = await screen.findByRole('list', { name: 'tournament list' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4))
    const names = () =>
      within(screen.getByRole('list', { name: 'tournament list' }))
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-label'))
    // Running first; then the newest: this browser's (made now), the open one, the weekly.
    expect(names()).toEqual(['live league', 'my local cup', 'open melee', 'weekly 2026-09-19'])
    const live = screen.getByRole('listitem', { name: 'live league' })
    expect(live.textContent).toContain('server')
    expect(live.textContent).toContain('running · 2 / 10')
    expect(live.textContent).not.toContain('championship')
    expect(live.querySelector('a')?.getAttribute('href')).toBe('/tournaments/r1')
    const weekly = screen.getByRole('listitem', { name: 'weekly 2026-09-19' })
    expect(weekly.textContent).toContain('championship')
    expect(weekly.textContent).toContain('championDwarf')
    const open = screen.getByRole('listitem', { name: 'open melee' })
    expect(open.textContent).toContain('entries open until 2099-09-25 18:00 UTC')
    expect(open.textContent).toContain('3 bots')
    const local = screen.getByRole('listitem', { name: 'my local cup' })
    expect(local.textContent).not.toContain('server')
    expect(screen.getByRole('region', { name: 'tournaments' }).textContent).toContain('4 of 4')

    // The filters and the search take the server's cards too: a champion's name finds its cup.
    fireEvent.click(screen.getByRole('radio', { name: 'melee' }))
    expect(names()).toEqual(['open melee'])
    fireEvent.click(screen.getByRole('radio', { name: 'all kinds' }))
    fireEvent.click(screen.getByRole('radio', { name: 'finished' }))
    expect(names()).toEqual(['weekly 2026-09-19'])
    fireEvent.click(screen.getByRole('radio', { name: 'any status' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'search tournaments' }), {
      target: { value: 'dwarf' },
    })
    expect(names()).toEqual(['my local cup', 'weekly 2026-09-19'])
  })

  it('shows this browser’s tournaments when the server’s do not load', async () => {
    server.use(
      http.get('*/api/tournaments', () =>
        HttpResponse.json({ error: { code: 'internal', message: 'down' } }, { status: 500 }),
      ),
    )
    await createTournament({
      name: 'offline cup',
      kind: 'melee',
      entrants: [
        { source: 'roster', ref: 'dwarf', name: 'Dwarf' },
        { source: 'roster', ref: 'imp', name: 'Imp' },
      ],
      config: { seed: 1 },
      rounds: 1,
    })
    await renderAt('/tournaments', () => (
      <TournamentsPage runner={new TournamentRunner(() => idle)} />
    ))
    expect(await screen.findByRole('listitem', { name: 'offline cup' })).toBeTruthy()
    expect(await screen.findByText("could not load the server's tournaments: down")).toBeTruthy()
    // The failure has its retry, which reads the list again.
    server.use(answer('/tournaments', { tournaments: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^retry/ })).toBeNull())
    expect(screen.queryByText(/could not load/)).toBeNull()
    expect(screen.getByRole('listitem', { name: 'offline cup' })).toBeTruthy()
  })
})

const ME: Me = {
  user: { id: 'u1', handle: 'octo', avatarUrl: null, createdAt: T },
  onboarded: true,
}
const MY_VERSION: BotVersion = {
  id: 'mine-v2',
  botId: 'mine',
  version: 2,
  bytesSha256: 'ef'.repeat(32),
  size: 2,
  author: null,
  strategy: null,
  isa: 'x16c-v1',
  createdAt: T,
}
const MY_BOTS: { bots: MyBot[] } = {
  bots: [
    {
      bot: {
        id: 'mine',
        ownerId: 'u1',
        slug: 'loop',
        name: 'Loop',
        visibility: 'private',
        createdAt: T,
        updatedAt: T,
      },
      latest: MY_VERSION,
    },
  ],
}

function signedIn(on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the hint cookie the API would set
  document.cookie = on ? 'signed_in=1; Path=/' : 'signed_in=; Max-Age=0; Path=/'
}

describe('a server tournament’s page', () => {
  let sockets = new FakeSockets()
  beforeEach(() => {
    sockets = new FakeSockets()
    signedIn(false)
    server.use(
      answer('/me', ME),
      answer('/me/bots', MY_BOTS),
      answer('/bots/mine', {
        bot: MY_BOTS.bots[0]?.bot,
        owner: ME.user,
        versions: [MY_VERSION],
        placements: [],
      }),
    )
  })
  afterEach(() => signedIn(false))

  const page = (id = 't1') =>
    renderAt(
      `/tournaments/${id}`,
      () => (
        <TournamentPage
          id={id}
          runner={new TournamentRunner(() => idle)}
          live={{ createSocket: sockets.create }}
        />
      ),
      '/tournaments/$id',
    )

  it('shows a finished one: its chips, its entrants and champion, and its bracket', async () => {
    server.use(answer('/tournaments/t1', FINISHED))
    await page()
    const header = await screen.findByRole('region', { name: 'spring cup' })
    for (const chip of ['server', 'championship', 'bracket', 'finished']) {
      expect(within(header).getByText(chip)).toBeTruthy()
    }
    expect(header.textContent).toContain('the bots its owner invited.')
    const entrants = within(header).getByRole('list', { name: 'entrants' })
    expect(
      within(entrants)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Loop (alice)', 'Dat', 'Spin', 'Halt', 'Loop (bob)'])
    expect(within(entrants).getByTitle('champion').textContent).toBe(
      entrantNames(LABELS)[champion(PLAYED) as number],
    )
    expect(nodes()).toHaveLength(8)
    expect(screen.getByRole('region', { name: 'live' }).textContent).toContain(
      'every match is played',
    )
    // An ended tournament's room has nothing more to say: no socket.
    expect(sockets.all).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /enter|start/ })).toBeNull()
  })

  it('follows a running one in its live room, and reads it again as its matches land', async () => {
    let reads = 0
    const running: TournamentDetail = {
      ...FINISHED,
      tournament: record({ status: 'running', bracket: PLAYED }),
      matches: FINISHED.matches.slice(0, 2),
    }
    server.use(
      http.get('*/api/tournaments/t1', () => {
        reads++
        return HttpResponse.json(running)
      }),
    )
    await page()
    await screen.findByRole('region', { name: 'spring cup' })
    await waitFor(() => expect(sockets.all).toHaveLength(1))
    expect(sockets.last.url).toBe('ws://localhost/api/live/tournament%3At1')
    const before = reads
    const say = (message: LiveMessage) => act(() => sockets.last.receive(message))
    act(() => sockets.last.open())
    say({ type: 'hello', protocol: 1, room: { kind: 'tournament', id: 't1' }, now: T })
    const live = screen.getByRole('region', { name: 'live' })
    await waitFor(() => expect(live.querySelector('[data-status="live"]')).not.toBeNull())
    say({ type: 'progress', job: 'tournament:t1', status: 'running', done: 3, of: 5 })
    await waitFor(() => expect(reads).toBe(before + 1))
    say({ type: 'progress', job: 'tournament:t1', status: 'running', done: 4, of: 5 })
    await waitFor(() => expect(reads).toBe(before + 2))
  })

  it('enters an open one with a version of my bot, or asks a stranger to sign in', async () => {
    const open: TournamentDetail = {
      tournament: record({
        status: 'scheduled',
        entry: 'open',
        entryClosesAt: OPEN_UNTIL,
        startsAt: null,
        bracket: null,
        ownerId: 'u9',
      }),
      entrants: [],
      matches: [],
    }
    const seen: unknown[] = []
    server.use(
      answer('/tournaments/t1', open),
      answerPost(
        '/tournaments/t1/enter',
        { tournamentId: 't1', botVersionId: 'mine-v2', replaced: null },
        201,
        seen,
      ),
    )
    await page()
    const header = await screen.findByRole('region', { name: 'spring cup' })
    expect(header.textContent).toContain('open entry until 2099-09-25 18:00 UTC')
    expect(header.textContent).toContain('no bots have entered yet.')
    expect(await within(header).findByRole('button', { name: 'sign in to enter' })).toBeTruthy()
  })

  it('takes my entry in the dialog, and says so', async () => {
    signedIn(true)
    const open: TournamentDetail = {
      tournament: record({
        status: 'scheduled',
        entry: 'open',
        entryClosesAt: OPEN_UNTIL,
        startsAt: null,
        bracket: null,
        ownerId: 'u9',
      }),
      entrants: [],
      matches: [],
    }
    const seen: unknown[] = []
    server.use(
      answer('/tournaments/t1', open),
      answerPost(
        '/tournaments/t1/enter',
        { tournamentId: 't1', botVersionId: 'mine-v2', replaced: null },
        201,
        seen,
      ),
    )
    await page()
    const enter = await screen.findByRole('button', { name: 'enter' })
    await waitFor(() => expect(enter.hasAttribute('disabled')).toBe(false))
    fireEvent.click(enter)
    const dialog = await screen.findByRole('dialog', { name: 'enter spring cup' })
    await waitFor(() => expect(dialog.textContent).toContain('2 / 512 B'))
    expect(dialog.textContent).toContain(
      'one entry each: enter again before the deadline to swap it.',
    )
    const send = within(dialog).getByRole('button', { name: 'enter' })
    await waitFor(() => expect(send.hasAttribute('disabled')).toBe(false))
    fireEvent.click(send)
    expect(await screen.findByText('entered Loop v2 in spring cup.')).toBeTruthy()
    expect(seen).toEqual([{ botVersionId: 'mine-v2' }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lets its owner start it, and no one else', async () => {
    signedIn(true)
    const scheduled: TournamentDetail = {
      tournament: record({
        status: 'scheduled',
        startsAt: null,
        bracket: null,
        ownerId: 'u1',
      }),
      entrants: LABELS.slice(0, 2),
      matches: [],
    }
    const seen: unknown[] = []
    server.use(
      answer('/tournaments/t1', scheduled),
      answerPost(
        '/tournaments/t1/start',
        { tournamentId: 't1', liveRoom: 'tournament:t1' },
        200,
        seen,
      ),
    )
    await page()
    const start = await screen.findByRole('button', { name: 'start' })
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    fireEvent.click(start)
    expect(await screen.findByText('spring cup is running on the server.')).toBeTruthy()
    expect(seen).toEqual([{}])
  })

  it('shows no start to another user', async () => {
    signedIn(true)
    server.use(
      answer('/tournaments/t1', {
        tournament: record({ status: 'scheduled', startsAt: null, bracket: null, ownerId: 'u9' }),
        entrants: LABELS.slice(0, 2),
        matches: [],
      }),
    )
    await page()
    await screen.findByRole('region', { name: 'spring cup' })
    await waitFor(() => expect(screen.getByRole('region', { name: 'live' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'start' })).toBeNull()
  })
})
