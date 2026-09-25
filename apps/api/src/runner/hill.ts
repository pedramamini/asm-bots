/**
 * Hill jobs (PRODUCT_SPEC §5): a submission fights each entry of a duel hill, one match an alarm.
 * Then `submitToHill` ranks the field from the stored results, playing nothing, and the new board
 * goes to D1 over the hill's revision as it was read, in one batch with the submission's status,
 * score, and rank. Other submissions run beside it, so the board can change first: the job then
 * reads it again, and fights any entry that is new to it.
 *
 * The entries' matches with each other come from D1: an entry fights every other when it comes
 * onto the hill, so the latest match of a pair is the one the hill ranks the pair by. A bot
 * version already on the hill is refused, so no challenge of one leaves a later match behind.
 *
 * Each submission is a Glicko-2 rating period (`rateMatches`): the challenger's matches rate it
 * and every entry it fought. The board write carries the new ratings (`ratings`, and each entry's
 * `hill_entries.rating`), the challenge's events (`hill_history`), and the king's reign
 * (`reign.ts`) in its batch.
 */
import {
  type HillJob,
  liveRoomName,
  MAX_REPLAY_ROUNDS,
  type MatchOutcome,
  type ReplayConfig,
  type Standing,
} from '@asmbots/protocol'
import {
  botHash,
  DEFAULT_RATING,
  type HillEntry,
  type HillMatch,
  type HillResult,
  type HillState,
  type MatchResult,
  type MatchSpec,
  type Rating,
  submitToHill,
} from '@asmbots/tourney'
import type {
  HillEntryRow,
  HillHistoryRow,
  HillRow,
  HillSubmissionRow,
  MatchRow,
} from '../db/queries'
import { SEED_MATCH_SEED } from '../db/seed'
import type { Env } from '../env'
import {
  battleOf,
  type HillOutcome,
  type JobBot,
  JobError,
  type JobSetup,
  type JobState,
  loadBots,
  type VersionRef,
} from './job'
import { rateChallenge } from './rating'
import { kingReign } from './reign'

/** Board writes in a row that may find the board changed before a job gives up for now. */
const WRITE_ATTEMPTS = 5

/** A bot version with its bot's name. */
interface VersionRow {
  version_id: string
  name: string
  bytes_sha256: string
  size: number
}

/** An entry of a board, with its bot and its bot's name. */
interface BoardEntry extends HillEntryRow {
  bot_id: string
  name: string
  bytes_sha256: string
}

/** A hill as one read sees it: the hill, its board (king first), its entries' matches. */
interface Board {
  readonly hill: HillRow
  readonly entries: readonly BoardEntry[]
  readonly pairs: readonly HillMatch[]
  /** The job's submission, with its version's bot, as the same read sees it. */
  readonly submission: (HillSubmissionRow & { bot_id: string | null }) | null
  /** The Glicko-2 ratings on the hill of its entries and the challenger, by bot version. */
  readonly ratings: ReadonlyMap<string, Rating>
}

/** A row of `ratings`. */
interface RatingRow {
  bot_version_id: string
  rating: number
  rd: number
  volatility: number
}

function entryRef(entry: BoardEntry): VersionRef {
  return { versionId: entry.bot_version_id, name: entry.name, sha256: entry.bytes_sha256 }
}

/**
 * The match of each pair of entries in `rows`, oldest first: its latest. An entry fights every
 * other when it comes onto the hill, so that is the later of the pair's challenges.
 */
function latestPairs(rows: readonly MatchRow[]): HillMatch[] {
  const pairs = new Map<string, HillMatch>()
  for (const row of rows) {
    const a = row.a_version_id as string
    const b = row.b_version_id as string
    const { points } = JSON.parse(row.result_json as string) as MatchOutcome
    pairs.set(JSON.stringify([a, b].sort()), {
      key: row.match_key ?? row.id,
      entries: [a, b],
      points: [points[0] ?? 0, points[1] ?? 0],
    })
  }
  return [...pairs.values()]
}

/**
 * Hill `hillId`, its board, its entries' matches, submission `submissionId`, and the ratings of
 * the entries and the submission's version, in one read.
 */
async function readBoard(db: D1Database, hillId: string, submissionId: string): Promise<Board> {
  const [hills, entries, matches, submissions, ratings] = await db.batch([
    db.prepare('SELECT * FROM hills WHERE id = ?').bind(hillId),
    db
      .prepare(
        `SELECT e.*, v.bot_id, b.name, v.bytes_sha256 FROM hill_entries e
         JOIN bot_versions v ON v.id = e.bot_version_id JOIN bots b ON b.id = v.bot_id
         WHERE e.hill_id = ? ORDER BY e.rank`,
      )
      .bind(hillId),
    db
      .prepare(
        `SELECT * FROM matches WHERE hill_id = ?1 AND result_json IS NOT NULL
           AND a_version_id IN (SELECT bot_version_id FROM hill_entries WHERE hill_id = ?1)
           AND b_version_id IN (SELECT bot_version_id FROM hill_entries WHERE hill_id = ?1)
         ORDER BY finished_at, rowid`,
      )
      .bind(hillId),
    db
      .prepare(
        `SELECT s.*, v.bot_id FROM hill_submissions s
         LEFT JOIN bot_versions v ON v.id = s.bot_version_id WHERE s.id = ?`,
      )
      .bind(submissionId),
    db
      .prepare(
        `SELECT * FROM ratings WHERE hill_id = ?1
           AND (bot_version_id IN (SELECT bot_version_id FROM hill_entries WHERE hill_id = ?1)
             OR bot_version_id = (SELECT bot_version_id FROM hill_submissions WHERE id = ?2))`,
      )
      .bind(hillId, submissionId),
  ])
  const hill = hills?.results[0] as HillRow | undefined
  if (hill === undefined) throw new JobError(`hill ${hillId} is gone`)
  return {
    hill,
    entries: (entries?.results ?? []) as BoardEntry[],
    pairs: latestPairs((matches?.results ?? []) as MatchRow[]),
    submission: (submissions?.results[0] as Board['submission'] | undefined) ?? null,
    ratings: new Map(
      ((ratings?.results ?? []) as RatingRow[]).map((r) => [
        r.bot_version_id,
        { rating: r.rating, rd: r.rd, volatility: r.volatility },
      ]),
    ),
  }
}

/**
 * Sets up submission `job`, and marks it running: the hill, the challenger (bot 0), and the
 * entries (the bots after it). The queue has one match per entry, less one with the challenger's
 * bytes, which it replaces. Throws `JobError` when there is no such hill, submission, or version,
 * the submission is of another hill or version or has ended, the hill scores melees, or the
 * version is over the hill's size or on the hill already.
 */
export async function setupHill(env: Env, job: HillJob): Promise<JobSetup> {
  const db = env.DB
  const hill = await db
    .prepare('SELECT * FROM hills WHERE slug = ?')
    .bind(job.hill)
    .first<HillRow>()
  if (hill === null) throw new JobError(`no hill ${job.hill}`)
  if (hill.scoring !== 'duel') {
    throw new JobError(`the ${hill.slug} hill scores melees, and the runner plays duel hills`)
  }
  if (hill.rounds > MAX_REPLAY_ROUNDS) {
    throw new JobError(`the ${hill.slug} hill has ${hill.rounds} rounds a match, over a replay's`)
  }
  const board = await readBoard(db, hill.id, job.submissionId)
  const { submission } = board
  if (submission === null) throw new JobError(`no submission ${job.submissionId}`)
  if (submission.hill_id !== hill.id || submission.bot_version_id !== job.botVersionId) {
    throw new JobError(
      `submission ${job.submissionId} is not bot version ${job.botVersionId} on the ${hill.slug} hill`,
    )
  }
  if (submission.status !== 'queued' && submission.status !== 'running') {
    throw new JobError(`submission ${job.submissionId} is ${submission.status}`)
  }
  const challenger = await db
    .prepare(
      `SELECT v.id AS version_id, b.name, v.bytes_sha256, v.size FROM bot_versions v
       JOIN bots b ON b.id = v.bot_id WHERE v.id = ?`,
    )
    .bind(job.botVersionId)
    .first<VersionRow>()
  if (challenger === null) throw new JobError(`no bot version ${job.botVersionId}`)
  const config = JSON.parse(hill.config_json) as ReplayConfig
  if (challenger.size > config.maxBotBytes) {
    throw new JobError(
      `bot version ${job.botVersionId} is ${challenger.size} bytes, and the ${hill.slug} hill takes ${config.maxBotBytes}`,
    )
  }
  if (board.entries.some((e) => e.bot_version_id === job.botVersionId)) {
    throw new JobError(`bot version ${job.botVersionId} is on the ${hill.slug} hill already`)
  }
  const bots = await loadBots(env.REPLAYS, [
    { versionId: challenger.version_id, name: challenger.name, sha256: challenger.bytes_sha256 },
    ...board.entries.map(entryRef),
  ])
  const hash = botHash(bots[0] as JobBot)
  const queue = bots.flatMap((bot, i) =>
    i > 0 && botHash(bot) !== hash ? [{ id: i, entrants: [0, i] }] : [],
  )
  await db
    .prepare("UPDATE hill_submissions SET status = 'running' WHERE id = ? AND status = 'queued'")
    .bind(job.submissionId)
    .run()
  return {
    format: 'hill',
    room: liveRoomName({ kind: 'hill', id: hill.id }),
    hillId: hill.id,
    tournamentId: null,
    prefix: job.submissionId,
    rounds: hill.rounds,
    battle: battleOf(config, SEED_MATCH_SEED),
    bots,
    queue,
    of: queue.length,
  }
}

/** A submission's line of the batch that writes its board. */
export interface SubmissionScore {
  readonly id: string
  readonly score: number
  readonly rank: number | null
  /** When it did not stay: the score it had to beat. */
  readonly needed: number | null
}

/** A line of `hill_history`: what a challenge did to one bot. */
export type HistoryEvent = Pick<
  HillHistoryRow,
  'event' | 'bot_version_id' | 'rank' | 'score' | 'delta'
>

/** What a submission's board write carries beside the board. */
export interface BoardWrite {
  readonly submission: SubmissionScore
  /** The rating period's new ratings, by bot version: the challenger's and its defenders'. */
  readonly ratings: ReadonlyMap<string, Rating>
  /** The challenge's events, the challenger's first. */
  readonly events: readonly HistoryEvent[]
}

/** An entry of a board to write: the king's carries its reign. */
export type BoardEntryWrite = HillEntry & { readonly reign?: number | null | undefined }

/**
 * Writes `entries` (best first) as hill `hill`'s board, over `hill.revision`: entries not in it
 * leave the hill, new ones come on, and the rest keep their `entered_at`. An entry's rating is its
 * `rating`, the default when null; its reign its `reign`, null when it has none. With `write`, the
 * same batch marks the submission finished with its score, rank, and needed score, keeps the new
 * ratings, and adds the events. False, with nothing written, when another job wrote the board
 * since `hill` was read.
 *
 * Each table takes one statement whatever the hill's size (rows as JSON, `json_each`): a batch
 * counts each statement against the Worker's queries per invocation.
 */
export async function writeBoard(
  db: D1Database,
  hill: Pick<HillRow, 'id' | 'revision'>,
  entries: readonly BoardEntryWrite[],
  write?: BoardWrite,
): Promise<boolean> {
  const at = new Date().toISOString()
  const rows = entries.map((e) => ({
    id: e.id,
    points: e.points,
    rating: e.rating ?? DEFAULT_RATING.rating,
    wins: e.wins,
    ties: e.ties,
    losses: e.losses,
    age: e.age,
    reign: e.reign ?? null,
  }))
  const statements = [
    // A stale revision becomes -1, which the column's CHECK refuses: the batch fails whole.
    db
      .prepare(
        'UPDATE hills SET revision = CASE revision WHEN ?2 THEN ?2 + 1 ELSE -1 END WHERE id = ?1',
      )
      .bind(hill.id, hill.revision),
    db
      .prepare(
        `DELETE FROM hill_entries
         WHERE hill_id = ? AND bot_version_id NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(hill.id, JSON.stringify(entries.map((e) => e.id))),
    // An upsert from a SELECT needs its WHERE, `true` or not, to parse.
    db
      .prepare(
        `INSERT INTO hill_entries
           (hill_id, bot_version_id, score, rating, wins, ties, losses, age, rank, reign)
         SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.points'),
           json_extract(value, '$.rating'), json_extract(value, '$.wins'),
           json_extract(value, '$.ties'), json_extract(value, '$.losses'),
           json_extract(value, '$.age'), key + 1, json_extract(value, '$.reign')
         FROM json_each(?2) WHERE true
         ON CONFLICT (hill_id, bot_version_id) DO UPDATE SET score = excluded.score,
           rating = excluded.rating, wins = excluded.wins, ties = excluded.ties,
           losses = excluded.losses, age = excluded.age, rank = excluded.rank,
           reign = excluded.reign`,
      )
      .bind(hill.id, JSON.stringify(rows)),
  ]
  if (write !== undefined) {
    const { submission, ratings, events } = write
    statements.push(
      db
        .prepare(
          `UPDATE hill_submissions SET status = 'finished', score = ?, rank = ?, needed = ?
           WHERE id = ?`,
        )
        .bind(submission.score, submission.rank, submission.needed, submission.id),
      db
        .prepare(
          `INSERT INTO ratings (bot_version_id, hill_id, rating, rd, volatility, updated_at)
           SELECT json_extract(value, '$[0]'), ?1, json_extract(value, '$[1]'),
             json_extract(value, '$[2]'), json_extract(value, '$[3]'), ?2
           FROM json_each(?3) WHERE true
           ON CONFLICT (bot_version_id, hill_id) DO UPDATE SET rating = excluded.rating,
             rd = excluded.rd, volatility = excluded.volatility, updated_at = excluded.updated_at`,
        )
        .bind(
          hill.id,
          at,
          JSON.stringify([...ratings].map(([id, r]) => [id, r.rating, r.rd, r.volatility])),
        ),
      db
        .prepare(
          `INSERT INTO hill_history
             (id, hill_id, submission_id, event, bot_version_id, rank, score, delta, at)
           SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.event'),
             json_extract(value, '$.bot_version_id'), json_extract(value, '$.rank'),
             json_extract(value, '$.score'), json_extract(value, '$.delta'), ?3
           FROM json_each(?4)`,
        )
        .bind(
          hill.id,
          submission.id,
          at,
          JSON.stringify(events.map((e) => ({ ...e, id: crypto.randomUUID() }))),
        ),
    )
  }
  try {
    await db.batch(statements)
    return true
  } catch (error) {
    if (error instanceof Error && /CHECK constraint failed: revision/.test(error.message)) {
      return false
    }
    throw error
  }
}

/** A board as the room's standings. */
function standingsOf(rows: readonly { rank: number; entry: HillEntry }[]): Standing[] {
  return rows.map(({ rank, entry }) => ({
    botVersionId: entry.id,
    rank,
    score: entry.points,
    wins: entry.wins,
    ties: entry.ties,
    losses: entry.losses,
  }))
}

/** What a hill job's last step comes to. */
export type HillFinal =
  /** Entries the challenger has not fought came onto the hill: fight them first. */
  | { readonly kind: 'more'; readonly bots: readonly JobBot[]; readonly queue: MatchSpec[] }
  /** The board is written: the challenger's outcome, and the board as standings. */
  | { readonly kind: 'done'; readonly outcome: HillOutcome; readonly standings: Standing[] }

/**
 * The events of `result` on `board`: the challenger `entered` (with the rank its bot gained over
 * its best place before) or was `rejected`; the entry `evicted`, and the one `replaced`, at their
 * old ranks.
 */
function challengeEvents(board: Board, result: HillResult): HistoryEvent[] {
  const oldRank = new Map(board.entries.map((e) => [e.bot_version_id, e.rank]))
  const { challenger, evicted, replaced } = result
  const events: HistoryEvent[] = []
  if (result.rank === null) {
    events.push({
      event: 'rejected',
      bot_version_id: challenger.id,
      rank: null,
      score: challenger.points,
      delta: null,
    })
  } else {
    const botId = board.submission?.bot_id ?? null
    const places = board.entries
      .filter((e) => (botId !== null && e.bot_id === botId) || e.bot_version_id === replaced?.id)
      .map((e) => e.rank)
    events.push({
      event: 'entered',
      bot_version_id: challenger.id,
      rank: result.rank,
      score: challenger.points,
      delta: places.length === 0 ? null : Math.min(...places) - result.rank,
    })
  }
  if (evicted !== null && evicted.id !== challenger.id) {
    events.push({
      event: 'evicted',
      bot_version_id: evicted.id,
      rank: oldRank.get(evicted.id) ?? null,
      score: evicted.points,
      delta: null,
    })
  }
  if (replaced !== null) {
    events.push({
      event: 'replaced',
      bot_version_id: replaced.id,
      rank: oldRank.get(replaced.id) ?? null,
      score: replaced.points,
      delta: null,
    })
  }
  return events
}

/**
 * Settles hill job `state`: ranks the field from the challenger's stored `results` (keyed by spec
 * id, the defender's bot index) and the entries' matches in D1, rates the period, then writes the
 * board with the ratings and the events. An entry new to the job is loaded into its bots; one it
 * has not fought comes back as `more`. A submission marked finished means the board has the
 * challenge already: it is not written again.
 */
export async function finalizeHill(
  env: Env,
  state: JobState,
  bots: readonly JobBot[],
  results: ReadonlyMap<number, MatchResult>,
): Promise<HillFinal> {
  if (state.spec.kind !== 'hill') throw new Error(`job ${state.id} is not a hill job`)
  const submissionId = state.spec.submissionId
  const all = [...bots]
  const index = new Map(all.map((bot, i) => [bot.versionId, i]))
  const at = (id: string) => index.get(id) as number
  const challenger = all[0] as JobBot
  const hash = botHash(challenger)
  const resultOf = (defender: HillEntry): MatchResult => {
    const stored = results.get(at(defender.id))
    if (stored === undefined) throw new Error(`no result against ${defender.id}`)
    return stored
  }
  for (let attempt = 1; ; attempt++) {
    const board = await readBoard(env.DB, state.hillId as string, submissionId)
    const fresh = board.entries.filter((e) => !index.has(e.bot_version_id))
    for (const bot of await loadBots(env.REPLAYS, fresh.map(entryRef))) {
      index.set(bot.versionId, all.length)
      all.push(bot)
    }
    const entries: HillEntry[] = board.entries.map((e) => {
      const bot = all[at(e.bot_version_id)] as JobBot
      return {
        id: e.bot_version_id,
        name: bot.name,
        hash: botHash(bot),
        points: e.score,
        wins: e.wins,
        ties: e.ties,
        losses: e.losses,
        age: e.age,
        rating: e.rating,
      }
    })
    if (board.submission?.status === 'finished') {
      // The job wrote its board, then was cut off before it knew.
      const { score, rank, needed } = board.submission
      return {
        kind: 'done',
        outcome: { accepted: rank !== null, rank, score: score ?? 0, needed, evicted: null },
        standings: standingsOf(entries.map((entry, i) => ({ rank: i + 1, entry }))),
      }
    }
    const defenders = entries.filter((e) => e.hash !== hash)
    const missing = defenders.filter((e) => !results.has(at(e.id)))
    if (missing.length > 0) {
      const queue = missing.map((e) => ({ id: at(e.id), entrants: [0, at(e.id)] }))
      return { kind: 'more', bots: all, queue }
    }
    const field: HillState = {
      config: { size: board.hill.size, rounds: board.hill.rounds, battle: state.battle },
      entries,
      matches: board.pairs,
    }
    let result: HillResult | null = null
    const steps = submitToHill(
      field,
      { id: challenger.versionId, bot: { name: challenger.name, bytes: challenger.bytes } },
      (_, defender) => resultOf(defender),
    )
    for await (const step of steps) result = step.final ?? result
    if (result === null) throw new Error(`the ${board.hill.slug} hill did not settle`)
    const ratings = rateChallenge(
      (id) => board.ratings.get(id),
      challenger.versionId,
      defenders.map((d) => d.id),
      defenders.map(resultOf),
    )
    const outcome: HillOutcome = {
      accepted: result.accepted,
      rank: result.rank,
      score: result.challenger.points,
      // Rejected, the challenger is last in the field: the entry above it is the score to beat.
      needed: result.accepted ? null : (result.field.at(-2)?.points ?? null),
      evicted: result.evicted?.id ?? null,
    }
    const king = board.entries[0]
    const reign = kingReign(
      king === undefined ? null : { id: king.bot_version_id, reign: king.reign },
      result,
      challenger.versionId,
    )
    const rated = result.state.entries.map((e, i) => ({
      ...e,
      rating: ratings.get(e.id)?.rating ?? e.rating,
      reign: i === 0 ? reign : null,
    }))
    const write: BoardWrite = {
      submission: {
        id: submissionId,
        score: outcome.score,
        rank: outcome.rank,
        needed: outcome.needed,
      },
      ratings,
      events: challengeEvents(board, result),
    }
    if (await writeBoard(env.DB, board.hill, rated, write)) {
      return { kind: 'done', outcome, standings: standingsOf(result.board) }
    }
    if (attempt >= WRITE_ATTEMPTS) {
      throw new Error(`the ${board.hill.slug} board changed under ${WRITE_ATTEMPTS} writes`)
    }
  }
}

/** Marks hill job `state`'s submission `status` in D1, unless it has ended. */
export async function endSubmission(
  env: Env,
  state: JobState,
  status: 'cancelled' | 'failed',
): Promise<void> {
  if (state.spec.kind !== 'hill') return
  await env.DB.prepare(
    "UPDATE hill_submissions SET status = ? WHERE id = ? AND status IN ('queued', 'running')",
  )
    .bind(status, state.spec.submissionId)
    .run()
}
