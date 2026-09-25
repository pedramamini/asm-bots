/**
 * Typed D1 queries: prepared statements, no ORM. Each `*Row` is a table's row as D1 returns it;
 * each `to*` maps one to its protocol record (camelCase, `_json` columns parsed). The rows are
 * ours, so the mappers trust them rather than parse them again.
 */
import {
  type AuditAction,
  type AuditEntry,
  type Bot,
  type BotLabel,
  type BotPlacement,
  type BotVersion,
  type ChampionshipResult,
  DELETED_HANDLE,
  type Hill,
  type HillBest,
  type HillEntry,
  type HillEvent,
  type HillEventSummary,
  type HillStanding,
  type HillSubmission,
  type HillSummary,
  type LiveRoomRef,
  type Match,
  type MatchOutcome,
  type MyBot,
  type ReplayConfig,
  type TickerChampionship,
  type TickerHillEvent,
  type Tournament,
  type TournamentConfig,
  type TournamentSummary,
  type User,
} from '@asmbots/protocol'
import { plannedMatches } from '@asmbots/tourney'

export interface UserRow {
  id: string
  github_id: number | null
  handle: string
  avatar_url: string | null
  created_at: string
  /** The GitHub account's primary verified email; never in a `User`. */
  email: string | null
  /** When the user picked their handle; null until the first-sign-in dialog is done. */
  onboarded_at: string | null
}

export interface BotRow {
  id: string
  owner_id: string
  slug: string
  name: string
  visibility: Bot['visibility']
  created_at: string
  updated_at: string
  /** When its owner deleted it; null while it lives. A deleted bot is no one's to read. */
  deleted_at: string | null
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
  /** The changes its board has had: a Runner writes a board over the revision it read. */
  revision: number
  /** One match per entry, or all in one core. */
  scoring: 'duel' | 'melee'
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

export interface HillSubmissionRow {
  id: string
  hill_id: string
  bot_version_id: string
  user_id: string
  status: 'queued' | 'running' | 'finished' | 'cancelled' | 'failed'
  /** Its score in the field; null until it is finished. */
  score: number | null
  /** Its rank on the new board; null when it did not stay, or is not finished. */
  rank: number | null
  /** When it did not stay: the field score of the lowest entry that did. */
  needed: number | null
  created_at: string
}

export interface HillHistoryRow {
  id: string
  hill_id: string
  submission_id: string | null
  event: HillEvent['kind']
  bot_version_id: string
  rank: number | null
  score: number
  delta: number | null
  at: string
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
  entry: Tournament['entry']
  /** An open tournament's deadline. */
  entry_closes_at: string | null
  /** The winner's bot version, written when it finishes. */
  champion_id: string | null
  finished_at: string | null
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
  /** The match's `matchHash`; null for a seeded match. */
  match_key: string | null
}

/** A bot version's name columns: `LABEL_COLUMNS` from `bot_versions v` and `LABEL_JOINS`. */
export interface BotLabelRow {
  version_id: string
  bot_id: string
  version: number
  author: string | null
  slug: string
  name: string
  handle: string
}

const LABEL_COLUMNS = 'v.id AS version_id, v.bot_id, v.version, v.author, b.slug, b.name, u.handle'
const LABEL_JOINS = 'JOIN bots b ON b.id = v.bot_id JOIN users u ON u.id = b.owner_id'

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
    scoring: row.scoring,
    createdAt: row.created_at,
  }
}

export function toHillSubmission(row: HillSubmissionRow): HillSubmission {
  return {
    id: row.id,
    hillId: row.hill_id,
    botVersionId: row.bot_version_id,
    status: row.status,
    score: row.score,
    rank: row.rank,
    needed: row.needed,
    createdAt: row.created_at,
  }
}

export function toHillEvent(row: HillHistoryRow): HillEvent {
  return {
    id: row.id,
    hillId: row.hill_id,
    submissionId: row.submission_id,
    kind: row.event,
    botVersionId: row.bot_version_id,
    rank: row.rank,
    score: row.score,
    delta: row.delta,
    at: row.at,
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

export function toBotLabel(row: BotLabelRow): BotLabel {
  return {
    botId: row.bot_id,
    versionId: row.version_id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    owner: row.handle,
    author: row.author,
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
    entry: row.entry,
    entryClosesAt: row.entry_closes_at,
    championId: row.champion_id,
    finishedAt: row.finished_at,
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
    key: row.match_key,
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

export async function getUserRowByGithubId(
  db: D1Database,
  githubId: number,
): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first<UserRow>()
}

/** Whether `handle` is someone's, in any case. */
export async function isHandleTaken(db: D1Database, handle: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM users WHERE handle = ?').bind(handle).first()
  return row !== null
}

/** What sign-in learns from GitHub each time. */
export interface GithubProfile {
  githubId: number
  avatarUrl: string | null
  email: string | null
}

/**
 * The user for a GitHub account: made with `id` and `handle` the first time; after that, the same
 * row with the avatar and email refreshed (its handle is the user's to change, not GitHub's).
 */
export async function upsertGithubUser(
  db: D1Database,
  { id, handle, githubId, avatarUrl, email }: GithubProfile & { id: string; handle: string },
): Promise<UserRow> {
  const row = await db
    .prepare(
      `INSERT INTO users (id, github_id, handle, avatar_url, email) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (github_id) DO UPDATE
         SET avatar_url = excluded.avatar_url, email = excluded.email
       RETURNING *`,
    )
    .bind(id, githubId, handle, avatarUrl, email)
    .first<UserRow>()
  if (row === null) throw new Error(`upserting github user ${githubId} returned no row`)
  return row
}

export async function updateGithubUser(
  db: D1Database,
  { githubId, avatarUrl, email }: GithubProfile,
): Promise<UserRow | null> {
  return db
    .prepare('UPDATE users SET avatar_url = ?, email = ? WHERE github_id = ? RETURNING *')
    .bind(avatarUrl, email, githubId)
    .first<UserRow>()
}

export async function getUserRow(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
}

/**
 * Gives user `id` the handle `handle` and marks them onboarded. Null when the user is gone;
 * `taken` when someone else has the handle in any case.
 */
export async function setUserHandle(
  db: D1Database,
  id: string,
  handle: string,
): Promise<UserRow | 'taken' | null> {
  try {
    return await db
      .prepare(
        `UPDATE users SET handle = ?,
           onboarded_at = COALESCE(onboarded_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE id = ? RETURNING *`,
      )
      .bind(handle, id)
      .first<UserRow>()
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: users\.handle/.test(err.message)) {
      return 'taken'
    }
    throw err
  }
}

/** The bot `id`; null when there is none, or its owner deleted it. */
export async function getBot(db: D1Database, id: string): Promise<Bot | null> {
  const row = await db
    .prepare('SELECT * FROM bots WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<BotRow>()
  return row && toBot(row)
}

/** An owner's bots, newest change first; `publicOnly` for anyone but the owner. */
export async function listBotsByOwner(
  db: D1Database,
  ownerId: string,
  publicOnly: boolean,
): Promise<Bot[]> {
  const sql = `SELECT * FROM bots WHERE owner_id = ? AND deleted_at IS NULL
    ${publicOnly ? "AND visibility = 'public'" : ''} ORDER BY updated_at DESC`
  const { results } = await db.prepare(sql).bind(ownerId).all<BotRow>()
  return results.map(toBot)
}

/** The public bots the sitemap lists: each one's id and last change, the latest first. */
export async function listPublicBotPages(
  db: D1Database,
  limit: number,
): Promise<{ id: string; updatedAt: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, updated_at FROM bots WHERE visibility = 'public' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; updated_at: string }>()
  return results.map((row) => ({ id: row.id, updatedAt: row.updated_at }))
}

/** How many bots `ownerId` has, not counting deleted ones: what `MAX_BOTS_PER_USER` holds. */
export async function countBots(db: D1Database, ownerId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM bots WHERE owner_id = ? AND deleted_at IS NULL')
    .bind(ownerId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** An owner's bots, each with its latest version (no source), the latest change first. */
export async function listMyBots(db: D1Database, ownerId: string): Promise<MyBot[]> {
  const [bots, { results }] = await Promise.all([
    listBotsByOwner(db, ownerId, false),
    db
      .prepare(
        `SELECT v.* FROM bot_versions v JOIN bots b ON b.id = v.bot_id
         WHERE b.owner_id = ? AND b.deleted_at IS NULL
         AND v.version = (SELECT MAX(version) FROM bot_versions WHERE bot_id = v.bot_id)`,
      )
      .bind(ownerId)
      .all<BotVersionRow>(),
  ])
  const latest = new Map(results.map((row) => [row.bot_id, toBotVersion(row, false)]))
  return bots.map((bot) => ({ bot, latest: latest.get(bot.id) ?? null }))
}

/** The slugs of `ownerId`'s bots, deleted ones too (a slug stays taken): as many as they have. */
export async function listBotSlugs(db: D1Database, ownerId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT slug FROM bots WHERE owner_id = ?')
    .bind(ownerId)
    .all<{ slug: string }>()
  return new Set(results.map((row) => row.slug))
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

/** A bot's latest version, as a row; null when it has none. */
export async function getLatestBotVersionRow(
  db: D1Database,
  botId: string,
): Promise<BotVersionRow | null> {
  return db
    .prepare('SELECT * FROM bot_versions WHERE bot_id = ? ORDER BY version DESC LIMIT 1')
    .bind(botId)
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

/** An entry's rating deviation: `RD_COLUMN` from `hill_entries e` and `RD_JOIN`. */
const RD_COLUMN = 'r.rd'
const RD_JOIN =
  'LEFT JOIN ratings r ON r.bot_version_id = e.bot_version_id AND r.hill_id = e.hill_id'

/** A standing from a row of `hill_entries e`, its label, and its `RD_COLUMN`. */
function toHillStanding(row: HillEntryRow & BotLabelRow & { rd: number | null }): HillStanding {
  return { entry: toHillEntry(row), bot: toBotLabel(row), rd: row.rd }
}

/** A hill's standings with each entry's label and RD, king first. */
export async function listHillStandings(db: D1Database, hillId: string): Promise<HillStanding[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*, ${LABEL_COLUMNS}, ${RD_COLUMN} FROM hill_entries e
       JOIN bot_versions v ON v.id = e.bot_version_id ${LABEL_JOINS} ${RD_JOIN}
       WHERE e.hill_id = ? ORDER BY e.rank`,
    )
    .bind(hillId)
    .all<HillEntryRow & BotLabelRow & { rd: number | null }>()
  return results.map(toHillStanding)
}

/** Every hill, with its entrant count and its king. */
export async function listHillSummaries(db: D1Database): Promise<HillSummary[]> {
  const [hills, counts, kings] = await Promise.all([
    listHills(db),
    db
      .prepare('SELECT hill_id, COUNT(*) AS n FROM hill_entries GROUP BY hill_id')
      .all<{ hill_id: string; n: number }>(),
    db
      .prepare(
        `SELECT e.*, ${LABEL_COLUMNS}, ${RD_COLUMN} FROM hill_entries e
         JOIN bot_versions v ON v.id = e.bot_version_id ${LABEL_JOINS} ${RD_JOIN}
         WHERE e.rank = 1 ORDER BY e.entered_at`,
      )
      .all<HillEntryRow & BotLabelRow & { rd: number | null }>(),
  ])
  const count = new Map(counts.results.map((row) => [row.hill_id, row.n]))
  const king = new Map<string, HillStanding>()
  for (const row of kings.results) {
    if (!king.has(row.hill_id)) king.set(row.hill_id, toHillStanding(row))
  }
  return hills.map((hill) => ({
    hill,
    entrants: count.get(hill.id) ?? 0,
    king: king.get(hill.id) ?? null,
  }))
}

/** The labels of bot versions by id; an id with no version (deleted) is left out. */
export async function listBotLabels(
  db: D1Database,
  versionIds: readonly string[],
): Promise<Map<string, BotLabel>> {
  if (versionIds.length === 0) return new Map()
  const { results } = await db
    .prepare(
      `SELECT ${LABEL_COLUMNS} FROM bot_versions v ${LABEL_JOINS}
       WHERE v.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify([...new Set(versionIds)]))
    .all<BotLabelRow>()
  return new Map(results.map((row) => [row.version_id, toBotLabel(row)]))
}

/** Where a bot's versions stand, hill by hill. */
export async function listBotPlacements(db: D1Database, botId: string): Promise<BotPlacement[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*, v.version, h.slug AS hill_slug, h.name AS hill_name FROM hill_entries e
       JOIN bot_versions v ON v.id = e.bot_version_id JOIN hills h ON h.id = e.hill_id
       WHERE v.bot_id = ? ORDER BY h.created_at, h.slug, e.rank`,
    )
    .bind(botId)
    .all<HillEntryRow & { version: number; hill_slug: string; hill_name: string }>()
  return results.map((row) => ({
    hill: { slug: row.hill_slug, name: row.hill_name },
    version: row.version,
    entry: toHillEntry(row),
  }))
}

/** A user's best place on each hill they are on, in hill order. */
export async function listUserHillBests(db: D1Database, userId: string): Promise<HillBest[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*, ${LABEL_COLUMNS}, h.slug AS hill_slug, h.name AS hill_name
       FROM hill_entries e JOIN bot_versions v ON v.id = e.bot_version_id ${LABEL_JOINS}
       JOIN hills h ON h.id = e.hill_id
       WHERE b.owner_id = ? ORDER BY h.created_at, h.slug, e.rank`,
    )
    .bind(userId)
    .all<HillEntryRow & BotLabelRow & { hill_slug: string; hill_name: string }>()
  const best = new Map<string, HillBest>()
  for (const row of results) {
    if (best.has(row.hill_id)) continue
    best.set(row.hill_id, {
      hill: { slug: row.hill_slug, name: row.hill_name },
      entry: toHillEntry(row),
      bot: toBotLabel(row),
    })
  }
  return [...best.values()]
}

/**
 * How a user's bots did in finished championships (tournaments with no owner), latest first. W/T/L
 * count as the tourney scores them: most points wins, a shared top ties. The champion is the one
 * the `Runner` wrote; a championship finished without one (the rows of a test) names the winner of
 * its last match.
 */
export async function listUserChampionships(
  db: D1Database,
  userId: string,
): Promise<ChampionshipResult[]> {
  const { results: entries } = await db
    .prepare(
      `SELECT ${LABEL_COLUMNS}, t.id AS tournament_id, t.slug AS tournament_slug,
         t.name AS tournament_name, t.starts_at, t.champion_id
       FROM tournaments t JOIN tournament_entries te ON te.tournament_id = t.id
       JOIN bot_versions v ON v.id = te.bot_version_id ${LABEL_JOINS}
       WHERE t.owner_id IS NULL AND t.status = 'finished' AND b.owner_id = ?
       ORDER BY t.starts_at DESC, t.created_at DESC LIMIT ?`,
    )
    .bind(userId, MAX_LIMIT)
    .all<
      BotLabelRow & {
        tournament_id: string
        tournament_slug: string
        tournament_name: string
        starts_at: string | null
        champion_id: string | null
      }
    >()
  if (entries.length === 0) return []
  const { results: matches } = await db
    .prepare(
      `SELECT tournament_id, participants_json, result_json FROM matches
       WHERE tournament_id IN (SELECT value FROM json_each(?)) AND result_json IS NOT NULL
       ORDER BY finished_at`,
    )
    .bind(JSON.stringify([...new Set(entries.map((e) => e.tournament_id))]))
    .all<{ tournament_id: string; participants_json: string; result_json: string }>()
  return entries.map((row) => {
    const out = { wins: 0, ties: 0, losses: 0 }
    let wonLast = false
    for (const m of matches) {
      if (m.tournament_id !== row.tournament_id) continue
      const at = (JSON.parse(m.participants_json) as string[]).indexOf(row.version_id)
      if (at < 0) {
        wonLast = false
        continue
      }
      const { points } = JSON.parse(m.result_json) as MatchOutcome
      const top = Math.max(...points)
      const mine = points[at] ?? 0
      const won = mine === top && points.filter((p) => p === top).length === 1
      if (won) out.wins++
      else if (mine === top) out.ties++
      else out.losses++
      wonLast = won
    }
    return {
      tournament: {
        id: row.tournament_id,
        slug: row.tournament_slug,
        name: row.tournament_name,
        startsAt: row.starts_at,
      },
      bot: toBotLabel(row),
      ...out,
      champion: row.champion_id === null ? wonLast : row.champion_id === row.version_id,
    }
  })
}

export async function getMatchRow(db: D1Database, id: string): Promise<MatchRow | null> {
  return db.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<MatchRow>()
}

/** A hill's finished matches, newest first; with `botVersionId`, only the ones it played. */
export async function listHillMatches(
  db: D1Database,
  hillId: string,
  { botVersionId, limit = 50 }: { botVersionId?: string | undefined; limit?: number } = {},
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

/** A bot version, with what a hill submission needs of its bot. */
export interface SubmittedVersionRow extends BotVersionRow {
  owner_id: string
  visibility: Bot['visibility']
  deleted_at: string | null
  /** The bot's name. */
  name: string
}

export async function getSubmittedVersion(
  db: D1Database,
  versionId: string,
): Promise<SubmittedVersionRow | null> {
  return db
    .prepare(
      `SELECT v.*, b.owner_id, b.visibility, b.deleted_at, b.name FROM bot_versions v
       JOIN bots b ON b.id = v.bot_id WHERE v.id = ?`,
    )
    .bind(versionId)
    .first<SubmittedVersionRow>()
}

/** Bot versions by id, as `getSubmittedVersion` reads one; an id with no version is left out. */
export async function listSubmittedVersions(
  db: D1Database,
  versionIds: readonly string[],
): Promise<Map<string, SubmittedVersionRow>> {
  const { results } = await db
    .prepare(
      `SELECT v.*, b.owner_id, b.visibility, b.deleted_at, b.name FROM bot_versions v
       JOIN bots b ON b.id = v.bot_id WHERE v.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify([...new Set(versionIds)]))
    .all<SubmittedVersionRow>()
  return new Map(results.map((row) => [row.id, row]))
}

/**
 * The entry of hill `hillId` that is bot version `versionId`, else one with the bytes `sha256`;
 * null when there is none. With its bot's name.
 */
export async function findHillEntryOf(
  db: D1Database,
  hillId: string,
  versionId: string,
  sha256: string,
): Promise<{ bot_version_id: string; name: string } | null> {
  return db
    .prepare(
      `SELECT e.bot_version_id, b.name FROM hill_entries e
       JOIN bot_versions v ON v.id = e.bot_version_id JOIN bots b ON b.id = v.bot_id
       WHERE e.hill_id = ?1 AND (e.bot_version_id = ?2 OR v.bytes_sha256 = ?3)
       ORDER BY e.bot_version_id = ?2 DESC LIMIT 1`,
    )
    .bind(hillId, versionId, sha256)
    .first<{ bot_version_id: string; name: string }>()
}

/** The id of `userId`'s submission queued or running on hill `hillId`; null when none is. */
export async function findActiveSubmission(
  db: D1Database,
  userId: string,
  hillId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM hill_submissions
       WHERE user_id = ? AND hill_id = ? AND status IN ('queued', 'running') LIMIT 1`,
    )
    .bind(userId, hillId)
    .first<{ id: string }>()
  return row?.id ?? null
}

export async function getHillSubmission(
  db: D1Database,
  id: string,
): Promise<HillSubmissionRow | null> {
  return db
    .prepare('SELECT * FROM hill_submissions WHERE id = ?')
    .bind(id)
    .first<HillSubmissionRow>()
}

/**
 * The matches submission `submissionId` has played on hill `hillId`, in the order played. Its
 * `Runner` names them `<submission id>-<n>`, the ids from `<id>-` to just before `<id>.` (`.`
 * follows `-`), which the primary key's index finds. The route makes submission ids as UUIDs, all
 * one length, so no id is another's with a tail.
 */
export async function listSubmissionMatches(
  db: D1Database,
  hillId: string,
  submissionId: string,
): Promise<Match[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM matches WHERE id >= ?2 AND id < ?3 AND hill_id = ?1
       ORDER BY finished_at, rowid`,
    )
    .bind(hillId, `${submissionId}-`, `${submissionId}.`)
    .all<MatchRow>()
  return results.map(toMatch)
}

async function eventSummaries(
  db: D1Database,
  rows: readonly HillHistoryRow[],
): Promise<HillEventSummary[]> {
  const labels = await listBotLabels(
    db,
    rows.map((row) => row.bot_version_id),
  )
  return rows.map((row) => ({
    event: toHillEvent(row),
    bot: labels.get(row.bot_version_id) ?? null,
  }))
}

/** Hill `hillId`'s history, newest first, each event with its bot's label. */
export async function listHillHistory(
  db: D1Database,
  hillId: string,
  limit = 20,
): Promise<HillEventSummary[]> {
  const { results } = await db
    .prepare('SELECT * FROM hill_history WHERE hill_id = ? ORDER BY at DESC, rowid LIMIT ?')
    .bind(hillId, clampLimit(limit))
    .all<HillHistoryRow>()
  return eventSummaries(db, results)
}

/**
 * The latest challenge on any hill, as the ticker names it: its challenger's event (`entered` or
 * `rejected`), each hill's newest found through `hill_history_hill_at`, and the latest of those.
 * Null before any submission.
 */
export async function latestHillChallenge(db: D1Database): Promise<TickerHillEvent | null> {
  const row = await db
    .prepare(
      `SELECT e.*, h.slug AS hill_slug, h.name AS hill_name FROM hills h
       JOIN hill_history e ON e.rowid = (
         SELECT x.rowid FROM hill_history x
         WHERE x.hill_id = h.id AND x.event IN ('entered', 'rejected')
         ORDER BY x.at DESC, x.rowid DESC LIMIT 1)
       ORDER BY e.at DESC, e.rowid DESC LIMIT 1`,
    )
    .first<HillHistoryRow & { hill_slug: string; hill_name: string }>()
  if (row === null) return null
  const labels = await listBotLabels(db, [row.bot_version_id])
  return {
    hill: { slug: row.hill_slug, name: row.hill_name },
    event: toHillEvent(row),
    bot: labels.get(row.bot_version_id) ?? null,
  }
}

/** A championship row as the ticker reads it. */
interface TickerChampionshipRow {
  id: string
  name: string
  status: Tournament['status']
  starts_at: string | null
  finished_at: string | null
  champion_id: string | null
  entrants: number
}

/**
 * The championships the ticker names: the last to finish, and the next, the one running, else the
 * first scheduled (a championship due that the cron has not started yet included). Null for none.
 */
export async function tickerChampionships(
  db: D1Database,
): Promise<{ last: TickerChampionship | null; next: TickerChampionship | null }> {
  const columns = `t.id, t.name, t.status, t.starts_at, t.finished_at, t.champion_id,
    (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants`
  const [last, next] = await db.batch<TickerChampionshipRow>([
    db.prepare(
      `SELECT ${columns} FROM tournaments t WHERE t.owner_id IS NULL AND t.status = 'finished'
       ORDER BY t.finished_at DESC, t.starts_at DESC LIMIT 1`,
    ),
    db.prepare(
      `SELECT ${columns} FROM tournaments t
       WHERE t.owner_id IS NULL AND t.status IN ('running', 'scheduled')
       ORDER BY t.status = 'running' DESC, t.starts_at IS NULL, t.starts_at LIMIT 1`,
    ),
  ])
  const rows = [last?.results[0] ?? null, next?.results[0] ?? null]
  const labels = await listBotLabels(
    db,
    rows.flatMap((row) => (row?.champion_id ? [row.champion_id] : [])),
  )
  const [lastChampionship = null, nextChampionship = null] = rows.map(
    (row): TickerChampionship | null =>
      row && {
        id: row.id,
        name: row.name,
        status: row.status,
        startsAt: row.starts_at,
        finishedAt: row.finished_at,
        entrants: row.entrants,
        champion: row.champion_id === null ? null : (labels.get(row.champion_id) ?? null),
      },
  )
  return { last: lastChampionship, next: nextChampionship }
}

/** Submission `submissionId`'s events, the challenger's first. */
export async function listSubmissionEvents(
  db: D1Database,
  submissionId: string,
): Promise<HillEventSummary[]> {
  const { results } = await db
    .prepare('SELECT * FROM hill_history WHERE submission_id = ? ORDER BY rowid')
    .bind(submissionId)
    .all<HillHistoryRow>()
  return eventSummaries(db, results)
}

/** A tournament row with its entrant count and its finished matches: `SUMMARY_COLUMNS` of `t`. */
type TournamentSummaryRow = TournamentRow & { entrants: number; done: number }

const SUMMARY_COLUMNS = `t.*,
  (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants,
  (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.finished_at IS NOT NULL) AS done`

/** Summaries of `rows`, with their champions' labels. */
async function tournamentSummaries(
  db: D1Database,
  rows: readonly TournamentSummaryRow[],
): Promise<TournamentSummary[]> {
  const labels = await listBotLabels(
    db,
    rows.flatMap((row) => (row.champion_id === null ? [] : [row.champion_id])),
  )
  return rows.map((row) => {
    const tournament = toTournament(row)
    const thirdPlace = tournament.config.thirdPlace ?? false
    return {
      tournament,
      entrants: row.entrants,
      done: row.done,
      of: Math.max(row.done, plannedMatches(row.kind, row.entrants, thirdPlace)),
      champion: row.champion_id === null ? null : (labels.get(row.champion_id) ?? null),
    }
  })
}

/**
 * Tournaments: running ones first, then by start time, latest first; unscheduled ones last. A
 * draft shows to its owner only.
 */
export async function listTournaments(
  db: D1Database,
  { limit = 50, viewerId = null }: { limit?: number; viewerId?: string | null } = {},
): Promise<TournamentSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM tournaments t WHERE t.status != 'draft' OR t.owner_id = ?
       ORDER BY (t.status = 'running') DESC, t.starts_at IS NULL, t.starts_at DESC,
         t.created_at DESC
       LIMIT ?`,
    )
    .bind(viewerId, clampLimit(limit))
    .all<TournamentSummaryRow>()
  return tournamentSummaries(db, results)
}

/** The championships feed: finished championships (no owner), the latest to finish first. */
export async function listChampionships(db: D1Database, limit = 20): Promise<TournamentSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM tournaments t
       WHERE t.owner_id IS NULL AND t.status = 'finished'
       ORDER BY t.finished_at DESC, t.starts_at DESC LIMIT ?`,
    )
    .bind(clampLimit(limit))
    .all<TournamentSummaryRow>()
  return tournamentSummaries(db, results)
}

export async function getTournament(db: D1Database, id: string): Promise<Tournament | null> {
  const row = await db
    .prepare('SELECT * FROM tournaments WHERE id = ?')
    .bind(id)
    .first<TournamentRow>()
  return row && toTournament(row)
}

/** Whether `room` has something to watch: a hill, or a tournament past its draft. */
export async function isWatchable(db: D1Database, room: LiveRoomRef): Promise<boolean> {
  const sql =
    room.kind === 'hill'
      ? 'SELECT 1 AS found FROM hills WHERE id = ?'
      : "SELECT 1 AS found FROM tournaments WHERE id = ? AND status != 'draft'"
  return (await db.prepare(sql).bind(room.id).first()) !== null
}

/** A tournament's entries: each bot version, and who entered it (null for an invited one). */
export async function listTournamentEntries(
  db: D1Database,
  tournamentId: string,
): Promise<{ bot_version_id: string; user_id: string | null }[]> {
  const { results } = await db
    .prepare('SELECT bot_version_id, user_id FROM tournament_entries WHERE tournament_id = ?')
    .bind(tournamentId)
    .all<{ bot_version_id: string; user_id: string | null }>()
  return results
}

/**
 * The order of a tournament's entries (`tournament_entries t`): by seed, which an invite has from
 * its list and every entry has once its `Runner` starts, then by entry, then by name.
 */
export const ENTRY_ORDER = 't.seed IS NULL, t.seed, t.entered_at, b.name, v.id'

/** A tournament's entrants, in `ENTRY_ORDER`: once it has started, the order its matches index. */
export async function listTournamentEntrants(
  db: D1Database,
  tournamentId: string,
): Promise<BotLabel[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LABEL_COLUMNS} FROM tournament_entries t
       JOIN bot_versions v ON v.id = t.bot_version_id ${LABEL_JOINS}
       WHERE t.tournament_id = ? ORDER BY ${ENTRY_ORDER}`,
    )
    .bind(tournamentId)
    .all<BotLabelRow>()
  return results.map(toBotLabel)
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

export interface AuditRow {
  id: string
  user_id: string
  action: AuditAction
  target: string
  at: string
}

/** The statement that records `action` on `target` by `userId`; batch it with the change. */
export function auditInsert(
  db: D1Database,
  userId: string,
  action: AuditAction,
  target: string,
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit (id, user_id, action, target) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, action, target)
}

/** The latest `limit` changes of `userId`, newest first. */
export async function listAudit(
  db: D1Database,
  userId: string,
  limit: number,
): Promise<AuditEntry[]> {
  const { results } = await db
    .prepare('SELECT * FROM audit WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT ?')
    .bind(userId, limit)
    .all<AuditRow>()
  return results.map((row) => ({ id: row.id, action: row.action, target: row.target, at: row.at }))
}

/** The user that owns what deleted accounts leave on hills and in tournaments. */
export const DELETED_USER = { id: 'deleted', handle: DELETED_HANDLE } as const

/** What a deleted account leaves behind in place of a name, an author, and a source. */
const GONE = '[deleted]'

/** A bot of `?1` with a version on a hill or in a tournament: it stays, anonymized. */
const KEPT_BOT = `owner_id = ?1 AND id IN (
  SELECT v.bot_id FROM bot_versions v
  WHERE v.id IN (SELECT bot_version_id FROM hill_entries)
     OR v.id IN (SELECT bot_version_id FROM tournament_entries))`

/** A tournament that has not started: its entries and its owner may still change. */
const UNSTARTED = "SELECT id FROM tournaments WHERE status IN ('draft', 'scheduled')"

/**
 * Deletes user `userId` in one batch (a transaction). First what has not started goes: their
 * tournaments not started yet, and their entries (and their bots' entries) in anyone's. Then their
 * bots are hard-deleted with their versions, but for bots with a version on a hill or in a
 * tournament: those stay, so standings and brackets keep their shape, owned by `DELETED_USER`,
 * named and authored `[deleted]`, with no source, and deleted (404 to all). Their other
 * tournaments pass to `DELETED_USER`, as do their hill submissions and tournament entries of the
 * versions that stay (the others go with their versions). Their audit rows go with them
 * (cascade). Sessions are in KV: the caller ends them. False when there was no such user.
 */
export async function deleteAccount(db: D1Database, userId: string): Promise<boolean> {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
  const results = await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO users (id, handle) VALUES (?, ?)')
      .bind(DELETED_USER.id, DELETED_USER.handle),
    db
      .prepare(
        `DELETE FROM tournament_entries WHERE tournament_id IN (${UNSTARTED}) AND (user_id = ?1
           OR bot_version_id IN (SELECT v.id FROM bot_versions v JOIN bots b ON b.id = v.bot_id
             WHERE b.owner_id = ?1))`,
      )
      .bind(userId),
    db.prepare(`DELETE FROM tournaments WHERE owner_id = ? AND id IN (${UNSTARTED})`).bind(userId),
    db
      .prepare(
        `UPDATE bot_versions SET source = '', author = ?2, strategy = NULL
         WHERE bot_id IN (SELECT id FROM bots WHERE ${KEPT_BOT})`,
      )
      .bind(userId, GONE),
    db
      .prepare(
        `UPDATE bots SET owner_id = ?2, slug = id, name = ?3, visibility = 'private',
           updated_at = ${now}, deleted_at = COALESCE(deleted_at, ${now})
         WHERE ${KEPT_BOT}`,
      )
      .bind(userId, DELETED_USER.id, GONE),
    db.prepare('DELETE FROM bots WHERE owner_id = ?').bind(userId),
    db
      .prepare('UPDATE tournaments SET owner_id = ? WHERE owner_id = ?')
      .bind(DELETED_USER.id, userId),
    db
      .prepare('UPDATE hill_submissions SET user_id = ? WHERE user_id = ?')
      .bind(DELETED_USER.id, userId),
    db
      .prepare('UPDATE tournament_entries SET user_id = ? WHERE user_id = ?')
      .bind(DELETED_USER.id, userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ])
  return (results.at(-1)?.meta.changes ?? 0) > 0
}
