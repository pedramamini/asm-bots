/**
 * The hill page's submission flow (PRODUCT_SPEC §5) against `msw`: `submit` (sign-in, the melee
 * hill, picking a bot and a version, the cap, a refusal), the progress panel as the job runs, the
 * result card for a bot that stayed and one that did not, the recent submissions feed with its
 * deltas, the king's card, `challenge` under the hill's rules, and `/hills`' best rank.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type {
  BotLabel,
  BotVersion,
  HillEventSummary,
  LiveMessage,
  MatchSummary,
  Me,
  MyBot,
  SubmissionDetail,
} from '@asmbots/protocol'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { useDom, window } from '../../../packages/ui/test/dom'
import { SUBMISSION_POLL_MS, submissionQuery } from '../src/api/queries'
import { parseRefs, sharedBots } from '../src/features/arena/setup/url'
import { hillArenaConfig } from '../src/features/hills/challenge'
import { feedItems, HillFeed, rankDelta } from '../src/features/hills/HillFeed'
import { HillPage } from '../src/features/hills/HillPage'
import { HillsPage } from '../src/features/hills/HillsPage'
import { KingCard } from '../src/features/hills/KingCard'
import { ago } from '../src/features/hills/links'
import { closestFight, missedText, submissionStatus } from '../src/features/hills/SubmissionPanel'
import { validateHillSearch } from '../src/features/hills/search'
import { clearLocalBots, saveLocalBot } from '../src/store/local-bots'
import { answer, answerPost, refuse, renderAt, useApiServer } from './api-server'
import { DWARF, HILLS, IMP, MAIN_DETAIL, MATCHES, PAPER } from './fixtures/api'
import { FakeSockets } from './live-fakes'

useDom()
window.scrollTo = () => {}

const T = '2026-09-24T12:00:00.000Z'
const MAIN = MAIN_DETAIL.hill
const ME: Me = {
  user: { id: 'u1', handle: 'octo', avatarUrl: null, createdAt: T },
  onboarded: true,
}
const LOOP: BotLabel = {
  ...IMP,
  botId: 'b-loop',
  versionId: 'b-loop-v2',
  slug: 'loop',
  name: 'Loop',
  version: 2,
  owner: 'octo',
  author: null,
}

function version(n: number, size: number): BotVersion {
  return {
    id: `b-loop-v${n}`,
    botId: 'b-loop',
    version: n,
    bytesSha256: 'ef'.repeat(32),
    size,
    author: null,
    strategy: null,
    isa: 'x16c-v1',
    createdAt: T,
  }
}

const MY_BOTS: { bots: MyBot[] } = {
  bots: [
    {
      bot: {
        id: 'b-loop',
        ownerId: 'u1',
        slug: 'loop',
        name: 'Loop',
        visibility: 'private',
        createdAt: T,
        updatedAt: T,
      },
      latest: version(2, 600),
    },
  ],
}

const match = (
  id: string,
  versus: BotLabel,
  points: [number, number],
  key: string | null = null,
): MatchSummary => ({
  match: {
    id,
    tournamentId: null,
    hillId: MAIN.id,
    participants: [LOOP.versionId, versus.versionId],
    rounds: 10,
    seed: 1,
    result: { points, survivors: [0], resultHash: '0123456789abcdef' },
    replayKey: key,
    finishedAt: T,
  },
  bots: [LOOP, versus],
})

const event = (
  kind: HillEventSummary['event']['kind'],
  bot: BotLabel,
  rank: number | null,
  score: number,
  delta: number | null = null,
  submissionId = 's1',
  at = T,
): HillEventSummary => ({
  event: {
    id: `${submissionId}-${kind}-${bot.slug}`,
    hillId: MAIN.id,
    submissionId,
    kind,
    botVersionId: bot.versionId,
    rank,
    score,
    delta,
    at,
  },
  bot,
})

function detail(
  over: Partial<SubmissionDetail> = {},
  submission: Partial<SubmissionDetail['submission']> = {},
): SubmissionDetail {
  return {
    submission: {
      id: 's1',
      hillId: MAIN.id,
      botVersionId: LOOP.versionId,
      status: 'running',
      score: null,
      rank: null,
      needed: null,
      createdAt: T,
      ...submission,
    },
    bot: LOOP,
    progress: null,
    matches: [],
    events: [],
    ...over,
  }
}

const RUNNING = detail({
  progress: { done: 1, of: 3, next: [LOOP, DWARF] },
  matches: [match('s1-1', PAPER, [9, 0], 'ab'.repeat(32))],
})
const FINISHED = detail(
  {
    matches: [
      match('s1-1', PAPER, [9, 0]),
      match('s1-2', DWARF, [3, 21]),
      match('s1-3', IMP, [12, 12]),
    ],
    events: [event('entered', LOOP, 2, 24, 3), event('evicted', IMP, 3, 12)],
  },
  { status: 'finished', score: 24, rank: 2 },
)
const MISSED = detail(
  {
    matches: [
      match('s1-1', PAPER, [2, 8]),
      match('s1-2', DWARF, [0, 30]),
      match('s1-3', IMP, [10, 10]),
    ],
    events: [event('rejected', LOOP, null, 12)],
  },
  { status: 'finished', score: 12, needed: 131 },
)

const server = useApiServer(
  answer('/hills', HILLS),
  answer('/hills/main', MAIN_DETAIL),
  answer('/hills/main/matches', MATCHES),
  answer('/hills/main/history', { events: [] }),
  answer('/me', ME),
  answer('/me/bots', MY_BOTS),
  answer('/bots/b-loop', {
    bot: MY_BOTS.bots[0]?.bot,
    owner: ME.user,
    versions: [version(2, 600), version(1, 40)],
    placements: [],
  }),
)

function signedIn(on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the hint cookie the API would set
  document.cookie = on ? 'signed_in=1; Path=/' : 'signed_in=; Max-Age=0; Path=/'
}

beforeEach(async () => {
  signedIn(false)
  await clearLocalBots()
})
afterEach(() => signedIn(false))

/** The hill's live room saying hello. */
const HELLO: LiveMessage = {
  type: 'hello',
  protocol: 1,
  room: { kind: 'hill', id: MAIN.id },
  now: T,
}

function progressOf(job: string, done: number, status: 'running' | 'finished'): LiveMessage {
  return { type: 'progress', job, status, done, of: 3 }
}

/** The query client of the page under test, which `Page` keeps. */
let client: QueryClient | null = null

/** The live rooms' sockets the pages open: they stay closed unless a test opens one. */
let sockets = new FakeSockets()
beforeEach(() => {
  sockets = new FakeSockets()
})

/** The hill page as its route draws it: the submission from the query. */
function Page() {
  client = useQueryClient()
  const search = useLocation().search as { submission?: string }
  return (
    <HillPage
      slug="main"
      submission={search.submission ?? null}
      live={{ createSocket: sockets.create }}
    />
  )
}

/** Opens the page's live room, and says hello. */
function openRoom() {
  act(() => {
    sockets.last.open()
    sockets.last.receive(HELLO)
  })
}

describe('the words of a submission', () => {
  it('names the closest fight it lost, and what it needed', () => {
    expect(closestFight(MISSED.matches)?.match.id).toBe('s1-1')
    expect(closestFight(FINISHED.matches.slice(0, 1))).toBeNull()
    expect(missedText(MISSED)).toBe(
      'scored 12, needed more than 131. closest fight: vs Paper (lost 2–8).',
    )
    expect(missedText(detail({}, { score: 5 }))).toBe('scored 5.')
    expect(submissionStatus(RUNNING)).toBe('1 / 3')
    expect(submissionStatus(FINISHED)).toBe('3 matches')
  })

  it('reads the route query, feed deltas, and times', () => {
    expect(validateHillSearch({ submission: 'abc-1' })).toEqual({ submission: 'abc-1' })
    expect(validateHillSearch({ submission: 'a b' })).toEqual({})
    expect(validateHillSearch({ submission: 7 })).toEqual({})
    expect([rankDelta(3), rankDelta(-2), rankDelta(0), rankDelta(null)]).toEqual([
      '+3 rank',
      '-2 rank',
      '0 rank',
      'new',
    ])
    const now = Date.parse(T)
    expect([ago(T, now + 20_000), ago(T, now + 5 * 60_000), ago(T, now + 3 * 3_600_000)]).toEqual([
      'now',
      '5m ago',
      '3h ago',
    ])
    expect(ago(T, now + 3 * 86_400_000)).toBe('2026-09-24')
  })

  it('groups a feed by submission, the challenger first', () => {
    const items = feedItems([
      event('entered', LOOP, 2, 24, 3, 's2'),
      event('evicted', IMP, 3, 12, null, 's2'),
      event('rejected', DWARF, null, 7, null, 's1'),
    ])
    expect(items.map((item) => item.events.map((e) => e.event.kind))).toEqual([
      ['entered', 'evicted'],
      ['rejected'],
    ])
  })

  it('polls a submission while its job may change it, unless the live room says', () => {
    const interval = submissionQuery('main', 's1').refetchInterval as (query: unknown) => unknown
    const at = (data: SubmissionDetail | undefined) => interval({ state: { data } })
    expect(at(RUNNING)).toBe(SUBMISSION_POLL_MS)
    expect(at(detail({}, { status: 'queued' }))).toBe(SUBMISSION_POLL_MS)
    expect([at(FINISHED), at(detail({}, { status: 'failed' })), at(undefined)]).toEqual([
      false,
      false,
      false,
    ])
    const quiet = submissionQuery('main', 's1', false).refetchInterval as typeof interval
    expect(quiet({ state: { data: RUNNING } })).toBe(false)
  })

  it('sets the arena to a hill’s rules and seed', () => {
    expect(hillArenaConfig({ ...MAIN, rounds: 25 })).toEqual({
      preset: null,
      rounds: 10,
      maxCycles: 100_000,
      maxProcesses: 64,
      minSpacing: 1024,
      seed: 1,
    })
  })
})

describe('submit', () => {
  it('asks a signed-out reader to sign in, and holds the melee hill shut', async () => {
    await renderAt('/hills/main', Page, '/hills/$slug')
    expect(await screen.findByRole('button', { name: 'sign in to submit' })).toBeTruthy()
    server.use(answer('/hills/main', { ...MAIN_DETAIL, hill: { ...MAIN, scoring: 'melee' } }))
    await renderAt('/hills/main', Page, '/hills/$slug')
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'submit' }).some((b) => b.hasAttribute('disabled')),
      ).toBe(true),
    )
  })

  it('sends me to the editor when my account has no bot', async () => {
    signedIn(true)
    server.use(answer('/me/bots', { bots: [] }))
    await renderAt('/hills/main', Page, '/hills/$slug')
    const submit = await screen.findByRole('button', { name: 'submit' })
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    fireEvent.click(submit)
    const dialog = await screen.findByRole('dialog', { name: 'submit to main' })
    expect(await within(dialog).findByRole('link', { name: 'open the editor' })).toBeTruthy()
  })

  it('picks a version under the cap, submits it, and follows the submission', async () => {
    signedIn(true)
    const seen: unknown[] = []
    server.use(
      answerPost(
        '/hills/main/submit',
        { submissionId: 's1', liveRoom: 'hill:hill-main' },
        201,
        seen,
      ),
      answer('/hills/main/submissions/s1', RUNNING),
    )
    const router = await renderAt('/hills/main', Page, '/hills/$slug')
    const submit = await screen.findByRole('button', { name: 'submit' })
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    fireEvent.click(submit)
    const dialog = await screen.findByRole('dialog', { name: 'submit to main' })
    const send = within(dialog).getByRole('button', { name: 'submit' })
    // v2, the latest, is over the hill's 512 bytes.
    await waitFor(() =>
      expect(dialog.textContent).toContain("600 / 512 B: over the main hill's cap."),
    )
    expect(send.hasAttribute('disabled')).toBe(true)
    expect(dialog.textContent).toContain(
      'the server fights it against 3 entries, 10 rounds a match',
    )
    const versions = within(dialog).getByRole('combobox', { name: 'version' })
    await waitFor(() => expect(within(versions).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(versions, { target: { value: '1' } })
    expect(dialog.textContent).toContain('40 / 512 B')
    await waitFor(() => expect(send.hasAttribute('disabled')).toBe(false))
    fireEvent.click(send)
    await waitFor(() => expect(router.state.location.search).toEqual({ submission: 's1' }))
    expect(seen).toEqual([{ botVersionId: 'b-loop-v1' }])
    expect(await screen.findByText('submitted Loop v1 to the main hill.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByRole('region', { name: 'submission' })).toBeTruthy()
  })

  it('shows the server’s refusal in the dialog', async () => {
    signedIn(true)
    server.use(
      http.post('*/api/hills/main/submit', () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'Loop v1 is on the main hill already' } },
          { status: 409 },
        ),
      ),
    )
    await renderAt('/hills/main', Page, '/hills/$slug')
    const submit = await screen.findByRole('button', { name: 'submit' })
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    fireEvent.click(submit)
    const dialog = await screen.findByRole('dialog', { name: 'submit to main' })
    const versions = await within(dialog).findByRole('combobox', { name: 'version' })
    await waitFor(() => expect(within(versions).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(versions, { target: { value: '1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'submit' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Loop v1 is on the main hill already',
    )
  })
})

describe('the submission panel', () => {
  it('shows the match being fought and the ones fought, then the result, and refreshes the hill', async () => {
    let asked = 0
    let hillReads = 0
    server.use(
      http.get('*/api/hills/main/submissions/s1', () => {
        asked++
        return HttpResponse.json(asked === 1 ? RUNNING : FINISHED)
      }),
      http.get('*/api/hills/main', () => {
        hillReads++
        return HttpResponse.json(MAIN_DETAIL)
      }),
    )
    await renderAt('/hills/main?submission=s1', Page, '/hills/$slug')
    const panel = await screen.findByRole('region', { name: 'submission' })
    await waitFor(() => expect(panel.textContent).toContain('fighting 2 of 3'))
    expect(panel.textContent).toContain('1 / 3')
    expect(within(panel).getByText('running').getAttribute('data-live')).toBe('true')
    const bar = within(panel).getByRole('progressbar', { name: 'matches fought' })
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual([
      '1',
      '3',
    ])
    const rows = within(within(panel).getByRole('table', { name: 'submission matches' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent)
    expect(rows).toEqual(['Paperwon 9–0watch', 'Dwarffighting…'])

    // The next poll finds it finished: the result card, and the hill read again. (Under the test
    // preload TanStack Query thinks it runs on a server and sets no interval: the test polls.)
    await act(() => client?.refetchQueries({ queryKey: ['hills', 'main', 'submissions', 's1'] }))
    const result = await within(panel).findByRole('region', { name: 'result' })
    expect(result.textContent).toContain('#2')
    expect(result.textContent).toContain('up 3 rank')
    expect(result.textContent).toContain('on the hill at #2: pushed off Imp (#3).')
    expect(panel.textContent).toContain('finished')
    await waitFor(() => expect(hillReads).toBeGreaterThan(1))
  })

  it('reads the submission again as its job moves in the live room, and does not poll it', async () => {
    let asked = 0
    server.use(
      http.get('*/api/hills/main/submissions/s1', () => {
        asked++
        return HttpResponse.json(asked === 1 ? RUNNING : FINISHED)
      }),
    )
    await renderAt('/hills/main?submission=s1', Page, '/hills/$slug')
    const panel = await screen.findByRole('region', { name: 'submission' })
    await waitFor(() => expect(panel.textContent).toContain('fighting 2 of 3'))
    const interval = () => {
      const key = ['hills', 'main', 'submissions', 's1']
      const query = client?.getQueryCache().find({ queryKey: key })
      const poll = query?.observers[0]?.options.refetchInterval as (q: unknown) => unknown
      return poll({ state: { data: RUNNING } })
    }
    // Polled until the room is open; then the room says when to read it again.
    expect(sockets.last.url).toBe(`ws://localhost/api/live/hill%3A${MAIN.id}`)
    expect(interval()).toBe(SUBMISSION_POLL_MS)
    openRoom()
    const live = screen.getByRole('region', { name: 'live' })
    expect(live.querySelector('[data-status]')?.getAttribute('data-status')).toBe('live')
    expect(interval()).toBe(false)
    expect(asked).toBe(1)

    act(() => sockets.last.receive(progressOf('hill:main:s1', 2, 'finished')))
    const result = await within(panel).findByRole('region', { name: 'result' })
    expect(result.textContent).toContain('#2')
  })

  it('reads the hill again when a job in its live room ends, for any spectator', async () => {
    let hillReads = 0
    server.use(
      http.get('*/api/hills/main', () => {
        hillReads++
        return HttpResponse.json(MAIN_DETAIL)
      }),
    )
    await renderAt('/hills/main', Page, '/hills/$slug')
    await waitFor(() => expect(sockets.all).toHaveLength(1))
    openRoom()
    expect(hillReads).toBe(1)
    // A job this page saw running, then ended: the board changed.
    act(() => sockets.last.receive(progressOf('hill:main:s9', 0, 'running')))
    act(() => sockets.last.receive(progressOf('hill:main:s9', 3, 'finished')))
    await waitFor(() => expect(hillReads).toBe(2))
  })

  it('says what a bot that did not stay needed, and its closest fight', async () => {
    server.use(answer('/hills/main/submissions/s1', MISSED))
    await renderAt('/hills/main?submission=s1', Page, '/hills/$slug')
    const result = await screen.findByRole('region', { name: 'result' })
    expect(result.textContent).toContain('off the hill')
    expect(result.textContent).toContain(
      'scored 12, needed more than 131. closest fight: vs Paper (lost 2–8).',
    )
  })

  it('says a failed job could not finish, and closes', async () => {
    server.use(answer('/hills/main/submissions/s1', detail({}, { status: 'failed' })))
    const router = await renderAt('/hills/main?submission=s1', Page, '/hills/$slug')
    const panel = await screen.findByRole('region', { name: 'submission' })
    await waitFor(() =>
      expect(panel.textContent).toContain('the server could not finish this submission.'),
    )
    fireEvent.click(within(panel).getByRole('button', { name: 'close the submission' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.queryByRole('region', { name: 'submission' })).toBeNull()
  })

  it('says so when there is no such submission', async () => {
    server.use(
      refuse('/hills/main/submissions/s1', 404, 'not_found', 'the main hill has no submission s1'),
    )
    await renderAt('/hills/main?submission=s1', Page, '/hills/$slug')
    expect(
      await screen.findByText('could not load: the main hill has no submission s1'),
    ).toBeTruthy()
  })
})

describe('the feed and the king', () => {
  it('lists recent submissions with their deltas and what they pushed off', async () => {
    const now = Date.parse(T) + 5 * 60_000
    server.use(
      answer('/hills/main/history', {
        events: [
          event('entered', LOOP, 2, 24, 3, 's3'),
          event('evicted', IMP, 3, 12, null, 's3'),
          event('entered', PAPER, 1, 40, null, 's2'),
          event('rejected', DWARF, null, 7, null, 's1'),
        ],
      }),
    )
    await renderAt('/hills/main', () => <HillFeed slug="main" now={now} />)
    const list = await screen.findByRole('list', { name: 'recent submissions' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '5m agoLoop entered at #2 +3 rank · pushed off Imp (#3)',
      '5m agoPaper entered at #1 new',
      '5m agoDwarf missed the hill · scored 7',
    ])
  })

  it('shows the king, and an empty hill', async () => {
    const king = { ...MAIN_DETAIL.standings[0], rd: 87.4 } as (typeof MAIN_DETAIL.standings)[0]
    await renderAt('/', () => <KingCard king={king} />)
    const card = await screen.findByRole('region', { name: 'king' })
    expect(card.textContent).toContain('Paper')
    expect(card.textContent).toContain('1,500± 87')
    expect(card.textContent).toContain('2/0/0')
    expect(card.textContent).toContain('on the hill through 2 challenges.')
    await renderAt('/', () => <KingCard king={null} />)
    expect(
      await screen.findByText('nobody holds this hill yet: the first bot takes it.'),
    ).toBeTruthy()
  })
})

describe('challenge', () => {
  it('fights my bot against a hill entry under the hill’s rules, mine first', async () => {
    const mine = await saveLocalBot({ name: 'Mine', source: 'start: jmp $\n' })
    server.use(
      answer(`/bots/${PAPER.botId}/versions/1`, {
        version: {
          ...version(1, 34),
          id: PAPER.versionId,
          botId: PAPER.botId,
          source: 'paper source',
        },
      }),
    )
    const router = await renderAt('/hills/main', Page, '/hills/$slug')
    const challenge = await screen.findByRole('button', { name: 'challenge Paper' })
    await waitFor(() => expect(challenge.hasAttribute('disabled')).toBe(false))
    fireEvent.click(challenge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/arena'))
    const search = router.state.location.search as Record<string, unknown>
    expect(parseRefs(String(search.b))).toEqual([
      { kind: 'local', id: mine.id },
      { kind: 'local', id: PAPER.botId },
    ])
    expect([search.seed, search.cycles, search.rounds]).toEqual([1, 100_000, 10])
    expect(sharedBots(router.state.location.hash).get(PAPER.botId)).toBe('paper source')
  })

  it('says a private entry fights on the server only', async () => {
    await saveLocalBot({ name: 'Mine', source: 'start: jmp $\n' })
    server.use(
      answer(`/bots/${DWARF.botId}/versions/1`, {
        version: { ...version(1, 23), id: DWARF.versionId, botId: DWARF.botId },
      }),
    )
    await renderAt('/hills/main', Page, '/hills/$slug')
    const challenge = await screen.findByRole('button', { name: 'challenge Dwarf' })
    await waitFor(() => expect(challenge.hasAttribute('disabled')).toBe(false))
    fireEvent.click(challenge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mine' }))
    expect(
      await screen.findByText("Dwarf's source is not public: it fights on the server only."),
    ).toBeTruthy()
  })
})

describe('/hills', () => {
  it('shows my best place on each hill, signed in', async () => {
    signedIn(true)
    server.use(
      answer('/users/octo', {
        user: ME.user,
        bots: [],
        hills: [
          {
            hill: { slug: 'main', name: 'main' },
            entry: MAIN_DETAIL.standings[1]?.entry,
            bot: DWARF,
          },
        ],
        championships: [],
      }),
    )
    await renderAt('/hills', HillsPage)
    const table = await screen.findByRole('table', { name: 'hills' })
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((th) => th.textContent),
      ).toContain('your best'),
    )
    const rows = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell').at(-1)?.textContent)
    await waitFor(() => expect(rows()).toEqual(['#2 Dwarf', '–']))
  })
})
