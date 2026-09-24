/**
 * The API's bodies: the read routes' responses (`GET /api/...`), which are the records of
 * `models.ts` and the names a page needs beside them, so it draws a table without one request per
 * row; and the write routes' requests and responses.
 */
import * as z from 'zod/mini'
import { JobStatus } from './jobs'
import { LiveMatch } from './live'
import {
  Bot,
  BotVersion,
  Handle,
  Hill,
  HillEntry,
  HillEvent,
  HillSubmission,
  Match,
  SubmissionStatus,
  Tournament,
  TournamentConfig,
  TournamentKind,
  TournamentStatus,
  User,
  Visibility,
} from './models'
import { BASE64, Id, matching, NAME, SHA256, Slug, Timestamp, whole } from './schema'

/** A bot version as a table names it: its bot, its version number, and whose it is. */
export const BotLabel = z.object({
  botId: Id,
  versionId: Id,
  slug: Slug,
  name: z.string(),
  version: whole('version', 1, Number.MAX_SAFE_INTEGER),
  /** The owner's handle. */
  owner: Handle,
  /** The source's `%author`, when it has one. */
  author: z.nullable(z.string()),
})
export type BotLabel = z.output<typeof BotLabel>

/**
 * A line of a hill's standings: the entry, its bot, and the RD of its Glicko-2 rating (the
 * rating's ±), null until a submission has rated it.
 */
export const HillStanding = z.object({
  entry: HillEntry,
  bot: BotLabel,
  rd: z.nullable(z.number()),
})
export type HillStanding = z.output<typeof HillStanding>

/** A hill in the list: its entrant count and its king (rank 1), if it has one. */
export const HillSummary = z.object({
  hill: Hill,
  entrants: whole('entrants', 0, Number.MAX_SAFE_INTEGER),
  king: z.nullable(HillStanding),
})
export type HillSummary = z.output<typeof HillSummary>

/** `GET /api/hills` */
export const HillList = z.object({ hills: z.array(HillSummary) })
export type HillList = z.output<typeof HillList>

/** `GET /api/hills/:slug`: the hill and its standings, king first. */
export const HillDetail = z.object({ hill: Hill, standings: z.array(HillStanding) })
export type HillDetail = z.output<typeof HillDetail>

/** A match and its entrants' labels, in entrant order; null for a version since deleted. */
export const MatchSummary = z.object({ match: Match, bots: z.array(z.nullable(BotLabel)) })
export type MatchSummary = z.output<typeof MatchSummary>

/**
 * `GET /api/matches/:id/verify` (ARCHITECTURE §7, verification model): a published match and what
 * it takes to run it again. `inputs` are its replay's (each bot's name, bytes, and SHA-256, the
 * config, the seed, the rounds), keyed by the `matchHash` its row stores; `match` is the row, the
 * result standings came from. A client runs the inputs itself, then checks the key and each
 * round's result hash (the match's one hash, for a row the launch seed stored without rounds).
 */
export const MatchVerification = z.object({ match: Match, inputs: LiveMatch })
export type MatchVerification = z.output<typeof MatchVerification>

/** `GET /api/hills/:slug/matches`: finished matches, newest first. */
export const MatchList = z.object({ matches: z.array(MatchSummary) })
export type MatchList = z.output<typeof MatchList>

/** A line of a hill's history and its bot's label; null for a version since deleted. */
export const HillEventSummary = z.object({ event: HillEvent, bot: z.nullable(BotLabel) })
export type HillEventSummary = z.output<typeof HillEventSummary>

/** `GET /api/hills/:slug/history`: the hill's events, newest first. */
export const HillHistory = z.object({ events: z.array(HillEventSummary) })
export type HillHistory = z.output<typeof HillHistory>

/** `POST /api/hills/:slug/submit`: a version of one of the signed-in user's bots. */
export const HillSubmitRequest = z.object({ botVersionId: Id })
export type HillSubmitRequest = z.output<typeof HillSubmitRequest>

/**
 * `POST /api/hills/:slug/submit`: the submission, its job started, and the `LiveRoom` of the hill
 * (`liveRoomName`), where its job says how far it is.
 */
export const HillSubmitted = z.object({ submissionId: Id, liveRoom: z.string() })
export type HillSubmitted = z.output<typeof HillSubmitted>

/** How far a submission's job is: `done` of the `of` matches it knows of ("fighting 24 of 32"). */
export const SubmissionProgress = z.object({
  done: whole('done', 0, Number.MAX_SAFE_INTEGER),
  of: whole('of', 0, Number.MAX_SAFE_INTEGER),
  /**
   * The bots of the match it is fighting (the challenger first), labeled; null when none is: the
   * job is settling, or has ended.
   */
  next: z.nullable(z.array(z.nullable(BotLabel))),
})
export type SubmissionProgress = z.output<typeof SubmissionProgress>

/**
 * `GET /api/hills/:slug/submissions/:id`: the submission, its bot, how far its job is (null once
 * it has finished, or when its `Runner` does not answer), its matches in the order played, and
 * what it did to the board (its events, once it has finished).
 */
export const SubmissionDetail = z.object({
  submission: HillSubmission,
  bot: z.nullable(BotLabel),
  progress: z.nullable(SubmissionProgress),
  matches: z.array(MatchSummary),
  events: z.array(HillEventSummary),
})
export type SubmissionDetail = z.output<typeof SubmissionDetail>

/** A bot version's place on a hill. */
export const BotPlacement = z.object({
  hill: z.object({ slug: Slug, name: z.string() }),
  version: whole('version', 1, Number.MAX_SAFE_INTEGER),
  entry: HillEntry,
})
export type BotPlacement = z.output<typeof BotPlacement>

/** `GET /api/bots/:id`: the bot, its owner, its versions (newest first, no sources), its places. */
export const BotDetail = z.object({
  bot: Bot,
  owner: User,
  versions: z.array(BotVersion),
  placements: z.array(BotPlacement),
})
export type BotDetail = z.output<typeof BotDetail>

/** `GET /api/bots/:id/versions/:v`: with its source when the bot is public or the reader's. */
export const BotVersionDetail = z.object({ version: BotVersion })
export type BotVersionDetail = z.output<typeof BotVersionDetail>

/** A user's best place on a hill: their highest-ranked bot version there. */
export const HillBest = z.object({
  hill: z.object({ slug: Slug, name: z.string() }),
  entry: HillEntry,
  bot: BotLabel,
})
export type HillBest = z.output<typeof HillBest>

/** How a user's bot did in a finished championship, over the matches it played there. */
export const ChampionshipResult = z.object({
  tournament: z.object({ id: Id, slug: Slug, name: z.string(), startsAt: z.nullable(Timestamp) }),
  bot: BotLabel,
  wins: whole('wins', 0, Number.MAX_SAFE_INTEGER),
  ties: whole('ties', 0, Number.MAX_SAFE_INTEGER),
  losses: whole('losses', 0, Number.MAX_SAFE_INTEGER),
  /** Whether it won the championship's last match: the final of a bracket. */
  champion: z.boolean(),
})
export type ChampionshipResult = z.output<typeof ChampionshipResult>

/**
 * `GET /api/users/:handle`: the user, the bots the reader may list, their best place on each hill
 * (in hill order), and their championship results (latest first).
 */
export const UserDetail = z.object({
  user: User,
  bots: z.array(Bot),
  hills: z.array(HillBest),
  championships: z.array(ChampionshipResult),
})
export type UserDetail = z.output<typeof UserDetail>

/**
 * `GET /api/me` and `PATCH /api/me`: the signed-in user; a 401 when nobody is. `onboarded` is
 * false until they pick a handle, which the first-sign-in dialog asks for (PRODUCT_SPEC §9).
 */
export const Me = z.object({ user: User, onboarded: z.boolean() })
export type Me = z.output<typeof Me>

/** `PATCH /api/me`: a new handle (`handleProblem` says which are allowed). */
export const UpdateMe = z.object({ handle: z.string().check(z.maxLength(64)) })
export type UpdateMe = z.output<typeof UpdateMe>

/**
 * A tournament in a list: its entrant count, the matches it has played (`done`) of the ones its
 * entrants make (`of`: every pair of a round robin, one fewer than the entrants of a bracket and
 * its third-place match, one melee), and its champion's label once it has one.
 */
export const TournamentSummary = z.object({
  tournament: Tournament,
  entrants: whole('entrants', 0, Number.MAX_SAFE_INTEGER),
  done: whole('done', 0, Number.MAX_SAFE_INTEGER),
  of: whole('of', 0, Number.MAX_SAFE_INTEGER),
  champion: z.nullable(BotLabel),
})
export type TournamentSummary = z.output<typeof TournamentSummary>

/** `GET /api/tournaments`: running first, then by start, the latest first. */
export const TournamentList = z.object({ tournaments: z.array(TournamentSummary) })
export type TournamentList = z.output<typeof TournamentList>

/**
 * `GET /api/championships`: the championships feed, the finished championships with their
 * champions, the latest first.
 */
export const ChampionshipList = z.object({ championships: z.array(TournamentSummary) })
export type ChampionshipList = z.output<typeof ChampionshipList>

/** A challenge as the ticker names it: its challenger's event, its bot, and its hill. */
export const TickerHillEvent = z.object({
  hill: z.object({ slug: Slug, name: z.string() }),
  event: HillEvent,
  bot: z.nullable(BotLabel),
})
export type TickerHillEvent = z.output<typeof TickerHillEvent>

/** A championship as the ticker names it: when it starts or finished, its entrants, its champion. */
export const TickerChampionship = z.object({
  id: Id,
  name: z.string(),
  status: TournamentStatus,
  startsAt: z.nullable(Timestamp),
  finishedAt: z.nullable(Timestamp),
  entrants: whole('entrants', 0, Number.MAX_SAFE_INTEGER),
  /** Its champion's label, once it has finished; null for a version since deleted. */
  champion: z.nullable(BotLabel),
})
export type TickerChampionship = z.output<typeof TickerChampionship>

/**
 * `GET /api/ticker`: the ticker's feed (PRODUCT_SPEC §1). The latest challenge on any hill (its
 * challenger's event: `entered` or `rejected`), the last championship to finish, the next one
 * (running, else the first scheduled), and the spectators in the live rooms now. The server reads
 * it again at most every `TICKER_TTL_MS`; `at` is when it last did.
 */
export const Ticker = z.object({
  at: Timestamp,
  hill: z.nullable(TickerHillEvent),
  lastChampionship: z.nullable(TickerChampionship),
  nextChampionship: z.nullable(TickerChampionship),
  spectators: whole('spectators', 0, Number.MAX_SAFE_INTEGER),
})
export type Ticker = z.output<typeof Ticker>

/** How long the server answers the ticker from its cache before it reads the feed again, ms. */
export const TICKER_TTL_MS = 30_000

/**
 * `GET /api/tournaments/:id`: the tournament, its entrants, and its matches. The entrants are in
 * the order its `Runner` plays them once it has started (by seed): a bracket's entrant indices and
 * a round robin's schedule index this list.
 */
export const TournamentDetail = z.object({
  tournament: Tournament,
  entrants: z.array(BotLabel),
  matches: z.array(Match),
})
export type TournamentDetail = z.output<typeof TournamentDetail>

/** The most bots a server tournament takes: a bracket's 32 (a melee takes 16). */
export const MAX_TOURNAMENT_ENTRANTS = 32

/**
 * How a new tournament takes its entrants (`TournamentEntry`): the bot versions named here, in
 * seed order, or anyone's until `closesAt`.
 */
export const TournamentEntrants = z.discriminatedUnion('entry', [
  z.object({
    entry: z.literal('invite'),
    botVersionIds: z.array(Id).check(z.minLength(2), z.maxLength(MAX_TOURNAMENT_ENTRANTS)),
  }),
  z.object({ entry: z.literal('open'), closesAt: Timestamp }),
])
export type TournamentEntrants = z.output<typeof TournamentEntrants>

/** `POST /api/tournaments`: a tournament the signed-in user owns, and starts. */
export const CreateTournament = z.object({
  name: matching(NAME),
  kind: TournamentKind,
  entrants: TournamentEntrants,
  config: TournamentConfig,
})
export type CreateTournament = z.output<typeof CreateTournament>

/** `POST /api/tournaments`: the tournament made, `scheduled`. */
export const CreatedTournament = z.object({ tournament: Tournament })
export type CreatedTournament = z.output<typeof CreatedTournament>

/** `POST /api/tournaments/:id/enter`: a version of one of the signed-in user's bots. */
export const EnterTournament = z.object({ botVersionId: Id })
export type EnterTournament = z.output<typeof EnterTournament>

/**
 * `POST /api/tournaments/:id/enter`: the user's entry, and the version it replaced when they had
 * entered another before (one entry a user).
 */
export const TournamentEntered = z.object({
  tournamentId: Id,
  botVersionId: Id,
  replaced: z.nullable(Id),
})
export type TournamentEntered = z.output<typeof TournamentEntered>

/** `POST /api/tournaments/:id/start`: the job started, and the tournament's `LiveRoom`. */
export const TournamentStarted = z.object({ tournamentId: Id, liveRoom: z.string() })
export type TournamentStarted = z.output<typeof TournamentStarted>

/** The most source text `POST /api/assemble` takes, in UTF-16 code units. */
export const MAX_SOURCE_TEXT = 64 * 1024

/** Assembly source text, at most `MAX_SOURCE_TEXT`. */
const SourceText = z
  .string()
  .check(z.refine((text) => text.length <= MAX_SOURCE_TEXT, 'the source is over 64 KB'))

/** `POST /api/assemble` */
export const AssembleRequest = z.object({ source: SourceText })
export type AssembleRequest = z.output<typeof AssembleRequest>

/** An assembler finding, located in the source (ISA §6.5; `@asmbots/asm`'s `Diag`). */
export const Diagnostic = z.object({
  severity: z.enum(['error', 'warning']),
  /** 1-based. */
  line: whole('line', 1, Number.MAX_SAFE_INTEGER),
  /** 1-based, in UTF-16 code units. */
  col: whole('col', 1, Number.MAX_SAFE_INTEGER),
  /** Columns covered. */
  len: whole('len', 0, Number.MAX_SAFE_INTEGER),
  message: z.string(),
  /** A `DiagCode`, or a newer one this client does not know. */
  code: z.string(),
  fix: z.optional(z.string()),
})
export type Diagnostic = z.output<typeof Diagnostic>

/**
 * `POST /api/assemble`: the bot the server assembled. A source with an error has no bytes: its
 * `bytes` and `sha256` are null, and its `diagnostics` say why.
 */
export const AssembleResult = z.object({
  /** The machine code, standard base64. */
  bytes: z.nullable(z.string().check(z.regex(BASE64))),
  /** The machine code's length in bytes; 0 when there is none. */
  size: whole('size', 0, 0x10000),
  /** SHA-256 of the machine code, lowercase hex. */
  sha256: z.nullable(matching(SHA256)),
  diagnostics: z.array(Diagnostic),
})
export type AssembleResult = z.output<typeof AssembleResult>

/**
 * The most cycles a round of an uploaded replay may run: the server runs the match again to check
 * it, and bounds the work of one request (16 bots × 10 rounds × this). More is a 413.
 */
export const MAX_VERIFIED_CYCLES = 200_000

/** `POST /api/replays`: the replay is a protocol `Replay`, which the route reads itself. */
export const ReplayUpload = z.object({ replay: z.unknown() })
export type ReplayUpload = z.output<typeof ReplayUpload>

/** `POST /api/replays`: where the server keeps the replay. */
export const StoredReplay = z.object({
  /** Its `replayKey`. */
  key: matching(SHA256),
  /** Its page: `/arena/<key>`, absolute. */
  url: z.string(),
})
export type StoredReplay = z.output<typeof StoredReplay>

/** The most bots a user may have. */
export const MAX_BOTS_PER_USER = 200
/** The most bots one `POST /api/bots/import` takes. */
export const MAX_IMPORT = 50

/** The most versions a bot may have. */
export const MAX_VERSIONS_PER_BOT = 100

/**
 * `POST /api/bots`, and each bot of an import: a bot to make from its source, private unless it
 * says otherwise.
 */
export const NewBot = z.object({
  name: matching(NAME),
  source: SourceText,
  visibility: z.optional(Visibility),
})
export type NewBot = z.output<typeof NewBot>

/** `POST /api/bots`: the bot the server made, and its version 1 (with its source). */
export const SavedBot = z.object({ bot: Bot, version: BotVersion })
export type SavedBot = z.output<typeof SavedBot>

/** `PATCH /api/bots/:id`: a new name, a new visibility, or both. */
export const UpdateBot = z
  .object({ name: z.optional(matching(NAME)), visibility: z.optional(Visibility) })
  .check(
    z.refine(
      (update) => update.name !== undefined || update.visibility !== undefined,
      'the update changes nothing: send a name or a visibility',
    ),
  )
export type UpdateBot = z.output<typeof UpdateBot>

/** `PATCH /api/bots/:id` */
export const UpdatedBot = z.object({ bot: Bot })
export type UpdatedBot = z.output<typeof UpdatedBot>

/** `POST /api/bots/:id/versions`: a new source for the bot. */
export const NewBotVersion = z.object({ source: SourceText })
export type NewBotVersion = z.output<typeof NewBotVersion>

/**
 * `POST /api/bots/:id/versions`: the version the source made (`created`), or the latest version
 * when the source assembles to the same bytes (not `created`), each with its source.
 */
export const SavedBotVersion = z.object({ bot: Bot, version: BotVersion, created: z.boolean() })
export type SavedBotVersion = z.output<typeof SavedBotVersion>

/** One of the signed-in user's bots: the bot and its latest version, without its source. */
export const MyBot = z.object({ bot: Bot, latest: z.nullable(BotVersion) })
export type MyBot = z.output<typeof MyBot>

/** `GET /api/me/bots`: the signed-in user's bots, every visibility, the latest change first. */
export const MyBotList = z.object({ bots: z.array(MyBot) })
export type MyBotList = z.output<typeof MyBotList>

/** `POST /api/bots/import`: local bots to keep in the account, each made at version 1. */
export const ImportBotsRequest = z.object({
  bots: z.array(NewBot).check(z.minLength(1), z.maxLength(MAX_IMPORT)),
})
export type ImportBotsRequest = z.output<typeof ImportBotsRequest>

/** One bot of an import: made, or refused with the reason (and the assembler's findings). */
export const ImportedBot = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), bot: Bot, version: BotVersion }),
  z.object({ ok: z.literal(false), message: z.string(), diagnostics: z.array(Diagnostic) }),
])
export type ImportedBot = z.output<typeof ImportedBot>

/** `POST /api/bots/import`: one result per bot, in the request's order. */
export const ImportBotsResult = z.object({ results: z.array(ImportedBot) })
export type ImportBotsResult = z.output<typeof ImportBotsResult>

/** What the audit log records, one row per change a user makes. */
export const AUDIT_ACTIONS = [
  'bot.create',
  'bot.update',
  'bot.version',
  'bot.delete',
  'hill.submit',
  'tournament.create',
  'tournament.enter',
] as const
export const AuditAction = z.enum(AUDIT_ACTIONS)
export type AuditAction = z.output<typeof AuditAction>

/**
 * One change the user made: `target` is what it changed, a bot id for `bot.*` (`<bot id>/v<n>`
 * for `bot.version`), a submission id for `hill.submit`, a tournament id for `tournament.*`.
 */
export const AuditEntry = z.object({
  id: Id,
  action: AuditAction,
  target: z.string(),
  at: Timestamp,
})
export type AuditEntry = z.output<typeof AuditEntry>

/** `GET /api/me/audit?limit=`: the signed-in user's changes, newest first. */
export const AuditList = z.object({ entries: z.array(AuditEntry) })
export type AuditList = z.output<typeof AuditList>

const COUNT = whole('a count', 0, Number.MAX_SAFE_INTEGER)

/** What a `Runner` says of its job: where it is, the matches played of those it knows, its alarms. */
export const RunnerReport = z.object({
  status: JobStatus,
  done: COUNT,
  of: COUNT,
  alarms: COUNT,
  /** The last error, when the job failed or is trying again. */
  error: z.nullable(z.string()),
})
export type RunnerReport = z.output<typeof RunnerReport>

/** A job queued or running: its `Runner`, its row, and what the Runner says of it. */
export const AdminJob = z.object({
  /** Its `Runner`'s name (`runnerJobId`). */
  job: z.string(),
  kind: z.enum(['hill', 'tournament']),
  /** Its row's status: a submission's `queued` or `running`, a tournament's `running`. */
  status: z.enum(['queued', 'running']),
  /** A submission's `createdAt`, a tournament's `startsAt`. */
  since: z.nullable(Timestamp),
  /** Its Runner's report; null when the Runner has no job, or did not answer. */
  runner: z.nullable(RunnerReport),
})
export type AdminJob = z.output<typeof AdminJob>

/** A live room (`liveRoomName`) and its open sockets. */
export const AdminRoom = z.object({ room: z.string(), spectators: COUNT })
export type AdminRoom = z.output<typeof AdminRoom>

/**
 * `GET /api/admin/stats`, for the handles in `ADMIN_HANDLES` only: hill submissions and
 * tournaments by status; the job queue, oldest first (at most 50), each job with its `Runner`'s
 * report; and the Durable Objects. A `Runner` is one job: each hill submission, and each
 * tournament that started (`runners`), of which `activeRunners` are queued or running. A
 * `LiveRoom` is one hill or one tournament past its draft (`liveRooms`); `askedRooms` were asked
 * for their spectators (the ones a page may have open), and `rooms` lists those with any.
 */
export const AdminStats = z.object({
  at: Timestamp,
  submissions: z.record(SubmissionStatus, COUNT),
  tournaments: z.record(TournamentStatus, COUNT),
  queue: z.array(AdminJob),
  durableObjects: z.object({
    runners: COUNT,
    activeRunners: COUNT,
    liveRooms: COUNT,
    askedRooms: COUNT,
  }),
  rooms: z.array(AdminRoom),
  spectators: COUNT,
})
export type AdminStats = z.output<typeof AdminStats>
