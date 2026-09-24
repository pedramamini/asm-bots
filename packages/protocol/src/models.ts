/**
 * The API's records (ARCHITECTURE §7, data model): D1's rows as JSON, camelCase. A `_json` column
 * is its parsed value; a nullable column is `null`, never left out.
 */
import * as z from 'zod/mini'
import { ReplayConfig, RoundResult, Seed } from './replay'
import { HASH64, Id, matching, SHA256, Slug, Timestamp, whole } from './schema'

/** Who may see a bot: its owner only, anyone with its link, or everyone. */
export const Visibility = z.enum(['private', 'unlisted', 'public'])
export type Visibility = z.output<typeof Visibility>

/** A GitHub handle: letters, digits, and single hyphens, 1..39 characters. */
export const Handle = matching(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/)

export const User = z.object({
  id: Id,
  handle: Handle,
  avatarUrl: z.nullable(z.string()),
  createdAt: Timestamp,
})
export type User = z.output<typeof User>

export const Bot = z.object({
  id: Id,
  ownerId: Id,
  slug: Slug,
  name: z.string().check(z.minLength(1), z.maxLength(64)),
  visibility: Visibility,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Bot = z.output<typeof Bot>

/**
 * A version of a bot: what a hill or a tournament enters. Its bytes are in R2 by `bytesSha256`;
 * its `source` is there only when the bot is public or the reader owns it.
 */
export const BotVersion = z.object({
  id: Id,
  botId: Id,
  version: whole('version', 1, Number.MAX_SAFE_INTEGER),
  source: z.optional(z.string()),
  bytesSha256: matching(SHA256),
  size: whole('size', 1, 0x10000),
  author: z.nullable(z.string()),
  strategy: z.nullable(z.string()),
  isa: z.string(),
  createdAt: Timestamp,
})
export type BotVersion = z.output<typeof BotVersion>

/** A king-of-the-hill ladder (PRODUCT_SPEC §5): `size` places, `rounds` rounds a match. */
export const Hill = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  description: z.string(),
  size: whole('size', 2, 1000),
  rounds: whole('rounds', 1, 100),
  config: ReplayConfig,
  createdAt: Timestamp,
})
export type Hill = z.output<typeof Hill>

/** A bot version's place on a hill. */
export const HillEntry = z.object({
  hillId: Id,
  botVersionId: Id,
  score: z.number(),
  rating: z.number(),
  wins: whole('wins', 0, Number.MAX_SAFE_INTEGER),
  ties: whole('ties', 0, Number.MAX_SAFE_INTEGER),
  losses: whole('losses', 0, Number.MAX_SAFE_INTEGER),
  /** The challengers it has outlasted since it entered. */
  age: whole('age', 0, Number.MAX_SAFE_INTEGER),
  enteredAt: Timestamp,
  /** 1 is the king. */
  rank: whole('rank', 1, Number.MAX_SAFE_INTEGER),
})
export type HillEntry = z.output<typeof HillEntry>

export const TournamentKind = z.enum(['roundrobin', 'bracket', 'melee'])
export type TournamentKind = z.output<typeof TournamentKind>

export const TournamentStatus = z.enum(['draft', 'scheduled', 'running', 'finished', 'cancelled'])
export type TournamentStatus = z.output<typeof TournamentStatus>

/** How a tournament's matches are played. */
export const TournamentConfig = z.object({
  rounds: whole('rounds', 1, 100),
  seed: Seed,
  battle: ReplayConfig,
})
export type TournamentConfig = z.output<typeof TournamentConfig>

export const Tournament = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  kind: TournamentKind,
  status: TournamentStatus,
  config: TournamentConfig,
  /** The bracket's state, as `@asmbots/tourney` keeps it; null for other kinds. */
  bracket: z.nullable(z.unknown()),
  /** Null for a scheduled championship. */
  ownerId: z.nullable(Id),
  startsAt: z.nullable(Timestamp),
  createdAt: Timestamp,
})
export type Tournament = z.output<typeof Tournament>

/** What a finished match came to, entrant order as in `participants`. */
export const MatchOutcome = z.object({
  points: z.array(z.number()),
  survivors: z.array(whole('a survivor', 0, 0xff)),
  resultHash: matching(HASH64),
  rounds: z.optional(z.array(RoundResult)),
})
export type MatchOutcome = z.output<typeof MatchOutcome>

/** A match of a tournament or a hill: bot versions, by id, in entrant order. */
export const Match = z.object({
  id: Id,
  tournamentId: z.nullable(Id),
  hillId: z.nullable(Id),
  participants: z.array(Id).check(z.minLength(2)),
  rounds: whole('rounds', 1, 100),
  seed: Seed,
  /** Null until it has finished. */
  result: z.nullable(MatchOutcome),
  /** Its replay's `replayKey`, once stored. */
  replayKey: z.nullable(matching(SHA256)),
  finishedAt: z.nullable(Timestamp),
})
export type Match = z.output<typeof Match>
