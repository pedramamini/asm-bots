/**
 * Typed D1 queries: prepared statements, no ORM. Each `*Row` is a table's row as D1 returns it;
 * each `to*` maps one to its protocol record (camelCase, `_json` columns parsed). The rows are
 * ours, so the mappers trust them rather than parse them again.
 */
import type {
  Bot,
  BotVersion,
  Hill,
  HillEntry,
  Match,
  MatchOutcome,
  ReplayConfig,
  Tournament,
  TournamentConfig,
  User,
} from '@asmbots/protocol'

export interface UserRow {
  id: string
  github_id: number | null
  handle: string
  avatar_url: string | null
  created_at: string
}

export interface BotRow {
  id: string
  owner_id: string
  slug: string
  name: string
  visibility: Bot['visibility']
  created_at: string
  updated_at: string
}

export interface BotVersionRow {
  id: string
  bot_id: string
  version: number
  source: string
  bytes_sha256: string
  size: number
  author: string | null
  strategy: string | null
  isa: string
  created_at: string
}

export interface HillRow {
  id: string
  slug: string
  name: string
  description: string
  size: number
  rounds: number
  config_json: string
  created_at: string
}

export interface HillEntryRow {
  hill_id: string
  bot_version_id: string
  score: number
  rating: number
  wins: number
  ties: number
  losses: number
  age: number
  entered_at: string
  rank: number
}

export interface TournamentRow {
  id: string
  slug: string
  name: string
  kind: Tournament['kind']
  status: Tournament['status']
  config_json: string
  bracket_json: string | null
  owner_id: string | null
  starts_at: string | null
  created_at: string
}

export interface MatchRow {
  id: string
  tournament_id: string | null
  hill_id: string | null
  a_version_id: string | null
  b_version_id: string | null
  participants_json: string
  rounds: number
  seed: number
  result_json: string | null
  replay_key: string | null
  finished_at: string | null
}

export function toUser(row: UserRow): User {
  return { id: row.id, handle: row.handle, avatarUrl: row.avatar_url, createdAt: row.created_at }
}

export function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    name: row.name,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** `withSource` is the caller's decision: the bot is public, or the reader owns it. */
export function toBotVersion(row: BotVersionRow, withSource: boolean): BotVersion {
  return {
    id: row.id,
    botId: row.bot_id,
    version: row.version,
    ...(withSource ? { source: row.source } : {}),
    bytesSha256: row.bytes_sha256,
    size: row.size,
    author: row.author,
    strategy: row.strategy,
    isa: row.isa,
    createdAt: row.created_at,
  }
}

export function toHill(row: HillRow): Hill {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    size: row.size,
    rounds: row.rounds,
    config: JSON.parse(row.config_json) as ReplayConfig,
    createdAt: row.created_at,
  }
}

export function toHillEntry(row: HillEntryRow): HillEntry {
  return {
    hillId: row.hill_id,
    botVersionId: row.bot_version_id,
    score: row.score,
    rating: row.rating,
    wins: row.wins,
    ties: row.ties,
    losses: row.losses,
    age: row.age,
    enteredAt: row.entered_at,
    rank: row.rank,
  }
}

export function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    status: row.status,
    config: JSON.parse(row.config_json) as TournamentConfig,
    bracket: row.bracket_json === null ? null : (JSON.parse(row.bracket_json) as unknown),
    ownerId: row.owner_id,
    startsAt: row.starts_at,
    createdAt: row.created_at,
  }
}

export function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    hillId: row.hill_id,
    participants: JSON.parse(row.participants_json) as string[],
    rounds: row.rounds,
    seed: row.seed,
    result: row.result_json === null ? null : (JSON.parse(row.result_json) as MatchOutcome),
    replayKey: row.replay_key,
    finishedAt: row.finished_at,
  }
}

/** The most rows a list query returns. */
export const MAX_LIMIT = 100

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
}

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
  return row && toUser(row)
}

/** Handles match without case: `Pedram` finds `pedram`. */
export async function getUserByHandle(db: D1Database, handle: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE handle = ?').bind(handle).first<UserRow>()
  return row && toUser(row)
}

export async function getBot(db: D1Database, id: string): Promise<Bot | null> {
  const row = await db.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first<BotRow>()
  return row && toBot(row)
}

/** An owner's bots, newest change first; `publicOnly` for anyone but the owner. */
export async function listBotsByOwner(
  db: D1Database,
  ownerId: string,
  publicOnly: boolean,
): Promise<Bot[]> {
  const sql = publicOnly
    ? "SELECT * FROM bots WHERE owner_id = ? AND visibility = 'public' ORDER BY updated_at DESC"
    : 'SELECT * FROM bots WHERE owner_id = ? ORDER BY updated_at DESC'
  const { results } = await db.prepare(sql).bind(ownerId).all<BotRow>()
  return results.map(toBot)
}

/** The row, not the record: the caller decides whether its source shows (`toBotVersion`). */
export async function getBotVersionRow(
  db: D1Database,
  botId: string,
  version: number,
): Promise<BotVersionRow | null> {
  return db
    .prepare('SELECT * FROM bot_versions WHERE bot_id = ? AND version = ?')
    .bind(botId, version)
    .first<BotVersionRow>()
}

/** A bot's versions, newest first, without their sources. */
export async function listBotVersions(db: D1Database, botId: string): Promise<BotVersion[]> {
  const { results } = await db
    .prepare('SELECT * FROM bot_versions WHERE bot_id = ? ORDER BY version DESC')
    .bind(botId)
    .all<BotVersionRow>()
  return results.map((row) => toBotVersion(row, false))
}

export async function listHills(db: D1Database): Promise<Hill[]> {
  const { results } = await db
    .prepare('SELECT * FROM hills ORDER BY created_at, slug')
    .all<HillRow>()
  return results.map(toHill)
}

export async function getHillBySlug(db: D1Database, slug: string): Promise<Hill | null> {
  const row = await db.prepare('SELECT * FROM hills WHERE slug = ?').bind(slug).first<HillRow>()
  return row && toHill(row)
}

/** A hill's standings, king first. */
export async function listHillEntries(db: D1Database, hillId: string): Promise<HillEntry[]> {
  const { results } = await db
    .prepare('SELECT * FROM hill_entries WHERE hill_id = ? ORDER BY rank')
    .bind(hillId)
    .all<HillEntryRow>()
  return results.map(toHillEntry)
}

/** A hill's finished matches, newest first; with `botVersionId`, only the ones it played. */
export async function listHillMatches(
  db: D1Database,
  hillId: string,
  { botVersionId, limit = 50 }: { botVersionId?: string; limit?: number } = {},
): Promise<Match[]> {
  const statement =
    botVersionId === undefined
      ? db
          .prepare(
            `SELECT * FROM matches WHERE hill_id = ? AND finished_at IS NOT NULL
             ORDER BY finished_at DESC LIMIT ?`,
          )
          .bind(hillId, clampLimit(limit))
      : db
          .prepare(
            `SELECT m.* FROM matches m WHERE m.hill_id = ? AND m.finished_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM json_each(m.participants_json) WHERE value = ?)
             ORDER BY m.finished_at DESC LIMIT ?`,
          )
          .bind(hillId, botVersionId, clampLimit(limit))
  const { results } = await statement.all<MatchRow>()
  return results.map(toMatch)
}

/** Tournaments: running ones first, then by start time, latest first; unscheduled ones last. */
export async function listTournaments(db: D1Database, limit = 50): Promise<Tournament[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM tournaments
       ORDER BY (status = 'running') DESC, starts_at IS NULL, starts_at DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(clampLimit(limit))
    .all<TournamentRow>()
  return results.map(toTournament)
}

export async function getTournament(db: D1Database, id: string): Promise<Tournament | null> {
  const row = await db
    .prepare('SELECT * FROM tournaments WHERE id = ?')
    .bind(id)
    .first<TournamentRow>()
  return row && toTournament(row)
}

export async function listTournamentMatches(
  db: D1Database,
  tournamentId: string,
): Promise<Match[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM matches WHERE tournament_id = ? ORDER BY finished_at IS NULL, finished_at',
    )
    .bind(tournamentId)
    .all<MatchRow>()
  return results.map(toMatch)
}
