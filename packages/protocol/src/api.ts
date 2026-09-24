/**
 * The read API's responses (`GET /api/...`): the records of `models.ts`, and the names a page
 * needs beside them, so it draws a table without one request per row.
 */
import * as z from 'zod/mini'
import { Bot, BotVersion, Handle, Hill, HillEntry, Match, Tournament, User } from './models'
import { Id, Slug, whole } from './schema'

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
