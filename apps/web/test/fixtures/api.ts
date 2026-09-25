/** Protocol records as the read API returns them: two hills, three bots, a user. */
import type {
  BotDetail,
  BotLabel,
  HillDetail,
  HillList,
  MatchList,
  ReplayConfig,
  Ticker,
  Tournament,
  TournamentList,
  UserDetail,
} from '@asmbots/protocol'

const T = '2026-09-24T12:00:00.000Z'
export const CONFIG: ReplayConfig = {
  coreSize: 65_536,
  maxCycles: 100_000,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
}

const label = (slug: string, name: string): BotLabel => ({
  botId: `roster-${slug}`,
  versionId: `roster-${slug}-v1`,
  slug,
  name,
  version: 1,
  owner: 'system',
  author: 'ASM Bots',
})

export const PAPER = label('paper', 'Paper')
export const DWARF = label('dwarf', 'Dwarf')
export const IMP = label('imp', 'Imp')

const MAIN = {
  id: 'hill-main',
  slug: 'main',
  name: 'main',
  description: 'the ladder.',
  size: 32,
  rounds: 10,
  config: CONFIG,
  scoring: 'duel' as const,
  createdAt: T,
}

const entry = (bot: BotLabel, rank: number, score: number) => ({
  hillId: 'hill-main',
  botVersionId: bot.versionId,
  score,
  rating: 1500,
  wins: 3 - rank,
  ties: 0,
  losses: rank - 1,
  age: 2,
  enteredAt: T,
  rank,
  reign: rank === 1 ? 1 : null,
})

export const MAIN_DETAIL: HillDetail = {
  hill: MAIN,
  standings: [
    { entry: entry(PAPER, 1, 321), bot: PAPER, rd: null },
    { entry: entry(DWARF, 2, 145), bot: DWARF, rd: null },
    { entry: entry(IMP, 3, 42), bot: { ...IMP, author: null }, rd: null },
  ],
}

export const HILLS: HillList = {
  hills: [
    { hill: MAIN, entrants: 3, king: MAIN_DETAIL.standings[0] ?? null },
    {
      hill: {
        ...MAIN,
        id: 'hill-tiny',
        slug: 'tiny',
        name: 'tiny',
        size: 16,
        config: { ...CONFIG, maxBotBytes: 256, maxCycles: 50_000 },
      },
      entrants: 0,
      king: null,
    },
  ],
}

export const KEY = 'ab'.repeat(32)

export const MATCHES: MatchList = {
  matches: [
    {
      match: {
        id: 'm1',
        tournamentId: null,
        hillId: 'hill-main',
        participants: [DWARF.versionId, IMP.versionId],
        rounds: 10,
        seed: 1,
        key: null,
        result: { points: [21, 9], survivors: [0], resultHash: '0123456789abcdef' },
        replayKey: KEY,
        finishedAt: T,
      },
      bots: [DWARF, IMP],
    },
    {
      match: {
        id: 'm2',
        tournamentId: null,
        hillId: 'hill-main',
        participants: [IMP.versionId, PAPER.versionId],
        rounds: 10,
        seed: 1,
        key: null,
        result: { points: [10, 10], survivors: [0, 1], resultHash: '0123456789abcdef' },
        replayKey: null,
        finishedAt: T,
      },
      bots: [IMP, null],
    },
  ],
}

export const DWARF_DETAIL: BotDetail = {
  bot: {
    id: DWARF.botId,
    ownerId: 'system',
    slug: 'dwarf',
    name: 'Dwarf',
    visibility: 'public',
    createdAt: T,
    updatedAt: T,
  },
  owner: { id: 'system', handle: 'system', avatarUrl: null, createdAt: T },
  versions: [
    {
      id: DWARF.versionId,
      botId: DWARF.botId,
      version: 1,
      bytesSha256: 'cd'.repeat(32),
      size: 23,
      author: 'ASM Bots',
      strategy: 'Bomb every 4th byte, walking backward',
      isa: 'x16c-v1',
      createdAt: T,
    },
  ],
  placements: [{ hill: { slug: 'main', name: 'main' }, version: 1, entry: entry(DWARF, 2, 145) }],
  fights: 1204,
}

export const SYSTEM: UserDetail = {
  user: { id: 'system', handle: 'system', avatarUrl: null, createdAt: T },
  bots: [DWARF_DETAIL.bot],
  hills: [{ hill: { slug: 'main', name: 'main' }, entry: entry(DWARF, 2, 145), bot: DWARF }],
  championships: [
    {
      tournament: { id: 't8', slug: 'weekly-8', name: 'Weekly 8', startsAt: T },
      bot: DWARF,
      wins: 4,
      ties: 0,
      losses: 1,
      champion: true,
    },
  ],
}

/**
 * The next championship: open for entries until far past any test run, so `enter` shows whatever
 * the clock says.
 */
export const WEEKLY_9: Tournament = {
  id: 't9',
  slug: 'weekly-9',
  name: 'Weekly 9',
  kind: 'bracket',
  status: 'scheduled',
  config: { rounds: 5, seed: 1, battle: CONFIG, seeding: 'rating', thirdPlace: true },
  bracket: null,
  ownerId: null,
  startsAt: '2026-09-26T18:00:00.000Z',
  createdAt: T,
  entry: 'open',
  entryClosesAt: '2099-09-25T18:00:00.000Z',
  championId: null,
  finishedAt: null,
}

export const TOURNAMENTS: TournamentList = {
  tournaments: [{ tournament: WEEKLY_9, entrants: 1, done: 0, of: 0, champion: null }],
}

/**
 * `GET /api/ticker`: Dwarf took the main hill's top (3 places up), Paper won the last weekly, the
 * next weekly takes entries, and 4 are watching.
 */
export const TICKER: Ticker = {
  at: T,
  hill: {
    hill: { slug: 'main', name: 'main' },
    event: {
      id: 'e1',
      hillId: 'hill-main',
      submissionId: 's1',
      kind: 'entered',
      botVersionId: DWARF.versionId,
      rank: 1,
      score: 30,
      delta: 3,
      at: T,
    },
    bot: DWARF,
  },
  lastChampionship: {
    id: 'weekly-2026-09-19',
    name: 'weekly 2026-09-19',
    status: 'finished',
    startsAt: '2026-09-19T18:00:00.000Z',
    finishedAt: '2026-09-19T19:00:00.000Z',
    entrants: 5,
    champion: PAPER,
  },
  nextChampionship: {
    id: 'weekly-2026-09-26',
    name: 'weekly 2026-09-26',
    status: 'scheduled',
    startsAt: '2026-09-26T18:00:00.000Z',
    finishedAt: null,
    entrants: 3,
    champion: null,
  },
  spectators: 4,
}
