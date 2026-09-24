/**
 * The API's bodies: the read routes' responses (`GET /api/...`), which are the records of
 * `models.ts` and the names a page needs beside them, so it draws a table without one request per
 * row; and the write routes' requests and responses.
 */
import * as z from 'zod/mini'
import { Bot, BotVersion, Handle, Hill, HillEntry, Match, Tournament, User } from './models'
import { BASE64, Id, matching, SHA256, Slug, whole } from './schema'

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

/** A line of a hill's standings. */
export const HillStanding = z.object({ entry: HillEntry, bot: BotLabel })
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

/** `GET /api/hills/:slug/matches`: finished matches, newest first. */
export const MatchList = z.object({ matches: z.array(MatchSummary) })
export type MatchList = z.output<typeof MatchList>

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

/** `GET /api/users/:handle`: the user and the bots the reader may list. */
export const UserDetail = z.object({ user: User, bots: z.array(Bot) })
export type UserDetail = z.output<typeof UserDetail>

/** `GET /api/me`: the signed-in user; a 401 when nobody is. */
export const Me = z.object({ user: User })
export type Me = z.output<typeof Me>

/** `GET /api/tournaments` */
export const TournamentList = z.object({ tournaments: z.array(Tournament) })
export type TournamentList = z.output<typeof TournamentList>

/** `GET /api/tournaments/:id`: the tournament, its entrants, and its matches. */
export const TournamentDetail = z.object({
  tournament: Tournament,
  entrants: z.array(BotLabel),
  matches: z.array(Match),
})
export type TournamentDetail = z.output<typeof TournamentDetail>

/** The most source text `POST /api/assemble` takes, in UTF-16 code units. */
export const MAX_SOURCE_TEXT = 64 * 1024

/** `POST /api/assemble` */
export const AssembleRequest = z.object({
  source: z
    .string()
    .check(z.refine((text) => text.length <= MAX_SOURCE_TEXT, 'the source is over 64 KB')),
})
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
