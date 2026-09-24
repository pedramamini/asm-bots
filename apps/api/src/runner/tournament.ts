/**
 * Tournament jobs (PRODUCT_SPEC §4): a tournament's matches, one an alarm. A round robin plays its
 * schedule (`roundRobinSchedule`), a melee its one match of everyone, and a bracket the matches
 * that are ready, drawing the next ones from each result (`advance`). The entrants' order (their
 * seeds) and a bracket's state go to D1 as it runs; standings go to the room after every match.
 * The end writes the champion, which puts a championship in the championships feed.
 */
import {
  liveRoomName,
  MAX_REPLAY_ROUNDS,
  type Standing,
  type TournamentConfig,
  type TournamentJob,
} from '@asmbots/protocol'
import {
  advance,
  type Bracket,
  champion,
  createBracket,
  DEFAULT_RATING,
  MAX_BRACKET_ENTRANTS,
  MAX_MELEE_ENTRANTS,
  type MatchResult,
  type MatchSpec,
  meleeStandings,
  nextMatches,
  roundRobinSchedule,
  standingsFromMatches,
} from '@asmbots/tourney'
import { ENTRY_ORDER, type TournamentRow } from '../db/queries'
import type { Env } from '../env'
import { battleOf, type JobBot, JobError, type JobSetup, type JobState, loadBots } from './job'

/** An entrant: its bot version, with its bot's name and its best rating on any hill. */
interface EntrantRow {
  version_id: string
  name: string
  bytes_sha256: string
  size: number
  /** Null when no hill has rated it. */
  rating: number | null
}

/** The bracket of `bots` in their order, seed 1 first, with its third-place match or not. */
function drawBracket(bots: readonly JobBot[], thirdPlace: boolean): Bracket {
  return createBracket(
    bots.map((bot) => ({ name: bot.name })),
    { seeding: 'given', thirdPlace },
  )
}

/** `rows` by rating, highest first (an unrated one at 1500); a tie keeps their order. */
function byRating(rows: readonly EntrantRow[]): EntrantRow[] {
  const rating = (row: EntrantRow) => row.rating ?? DEFAULT_RATING.rating
  return [...rows].sort((a, b) => rating(b) - rating(a))
}

/** `bracket`'s ready matches that are not in `taken`, as specs. */
function readySpecs(bracket: Bracket, taken: ReadonlySet<number>): MatchSpec[] {
  return nextMatches(bracket)
    .filter((m) => !taken.has(m.id))
    .map((m) => ({ id: m.id, entrants: m.slots.map((s) => s.entrant as number) }))
}

/** The matches of `bracket` that are played, or will be: all but walkovers and empty ones. */
function playable(bracket: Bracket): number {
  return bracket.matches.filter((m) => m.status !== 'walkover' && m.status !== 'empty').length
}

/**
 * Sets up tournament `job`: its entrants and its first matches, and marks it running (and started
 * now, when it had no start time). The entrants' order is their seeds (`ENTRY_ORDER`), or their
 * ratings for a bracket seeded by rating; it is written to their entries as their seeds, 1 first,
 * so the tournament's entrant list is the order its matches index. Throws `JobError` when there is
 * no such tournament, it is over, it has too few or too many entrants, or a bot is over its size.
 */
export async function setupTournament(env: Env, job: TournamentJob): Promise<JobSetup> {
  const db = env.DB
  const id = job.tournamentId
  const tournament = await db
    .prepare('SELECT * FROM tournaments WHERE id = ?')
    .bind(id)
    .first<TournamentRow>()
  if (tournament === null) throw new JobError(`no tournament ${id}`)
  if (tournament.status === 'finished' || tournament.status === 'cancelled') {
    throw new JobError(`tournament ${id} is ${tournament.status}`)
  }
  const config = JSON.parse(tournament.config_json) as TournamentConfig
  if (config.rounds > MAX_REPLAY_ROUNDS) {
    throw new JobError(`tournament ${id} has ${config.rounds} rounds a match, over a replay's`)
  }
  const { results: rows } = await db
    .prepare(
      `SELECT v.id AS version_id, b.name, v.bytes_sha256, v.size,
         (SELECT MAX(r.rating) FROM ratings r WHERE r.bot_version_id = v.id) AS rating
       FROM tournament_entries t JOIN bot_versions v ON v.id = t.bot_version_id
       JOIN bots b ON b.id = v.bot_id
       WHERE t.tournament_id = ? ORDER BY ${ENTRY_ORDER}`,
    )
    .bind(id)
    .all<EntrantRow>()
  const bracketKind = tournament.kind === 'bracket'
  const entrants = bracketKind && config.seeding === 'rating' ? byRating(rows) : rows
  const n = entrants.length
  const most = tournament.kind === 'bracket' ? MAX_BRACKET_ENTRANTS : MAX_MELEE_ENTRANTS
  if (n < 2 || (tournament.kind !== 'roundrobin' && n > most)) {
    throw new JobError(
      `tournament ${id} has ${n} entrants, and a ${tournament.kind} takes 2..${most}`,
    )
  }
  const big = entrants.find((e) => e.size > config.battle.maxBotBytes)
  if (big !== undefined) {
    throw new JobError(
      `bot version ${big.version_id} is ${big.size} bytes, and tournament ${id} takes ${config.battle.maxBotBytes}`,
    )
  }
  const bots = await loadBots(
    env.REPLAYS,
    entrants.map((e) => ({ versionId: e.version_id, name: e.name, sha256: e.bytes_sha256 })),
  )
  const thirdPlace = bracketKind && (config.thirdPlace ?? false) && n >= 3
  let queue: MatchSpec[]
  let of: number
  const statements: D1PreparedStatement[] = [
    // One statement for every entry's seed: a D1 batch counts each statement as a query.
    db
      .prepare(
        `UPDATE tournament_entries SET seed = (SELECT key + 1 FROM json_each(?2)
           WHERE value = tournament_entries.bot_version_id) WHERE tournament_id = ?1`,
      )
      .bind(id, JSON.stringify(bots.map((bot) => bot.versionId))),
  ]
  if (bracketKind) {
    const bracket = drawBracket(bots, thirdPlace)
    queue = readySpecs(bracket, new Set())
    of = playable(bracket)
    statements.push(
      db
        .prepare('UPDATE tournaments SET bracket_json = ? WHERE id = ?')
        .bind(JSON.stringify(bracket), id),
    )
  } else if (tournament.kind === 'melee') {
    queue = [{ id: 0, entrants: bots.map((_, e) => e) }]
    of = 1
  } else {
    queue = roundRobinSchedule(n)
    of = queue.length
  }
  statements.push(
    db
      .prepare(
        "UPDATE tournaments SET status = 'running', starts_at = COALESCE(starts_at, ?) WHERE id = ?",
      )
      .bind(new Date().toISOString(), id),
  )
  await db.batch(statements)
  return {
    format: tournament.kind,
    room: liveRoomName({ kind: 'tournament', id }),
    hillId: null,
    tournamentId: id,
    prefix: id,
    rounds: config.rounds,
    battle: battleOf(config.battle, config.seed),
    thirdPlace,
    bots,
    queue,
    of,
  }
}

/** A bracket job's bracket: drawn again, with its played matches advanced in turn. */
export function bracketOf(
  state: JobState,
  bots: readonly JobBot[],
  results: ReadonlyMap<number, MatchResult>,
): Bracket {
  let bracket = drawBracket(bots, state.thirdPlace ?? false)
  for (const spec of state.played) {
    const result = results.get(spec.id)
    if (result === undefined) throw new Error(`no result of bracket match ${spec.id}`)
    bracket = advance(bracket, spec.id, result)
  }
  return bracket
}

/**
 * After a bracket job's match: queues the matches its result made ready, and writes the bracket
 * to D1 so the tournament's page shows it.
 */
export async function advanceBracket(
  env: Env,
  state: JobState,
  bots: readonly JobBot[],
  results: ReadonlyMap<number, MatchResult>,
): Promise<void> {
  const bracket = bracketOf(state, bots, results)
  const taken = new Set([...state.queue, ...state.played].map((spec) => spec.id))
  state.queue.push(...readySpecs(bracket, taken))
  state.of = playable(bracket)
  await env.DB.prepare('UPDATE tournaments SET bracket_json = ? WHERE id = ?')
    .bind(JSON.stringify(bracket), state.tournamentId)
    .run()
}

/**
 * The standings of tournament job `state` so far: points and W/T/L per match, or, for a melee, per
 * round (`meleeStandings`).
 */
export function tournamentStandings(
  state: JobState,
  bots: readonly JobBot[],
  results: ReadonlyMap<number, MatchResult>,
): Standing[] {
  const melee = state.format === 'melee' ? results.get(0) : undefined
  const rows =
    melee === undefined
      ? standingsFromMatches(
          bots.map((bot) => bot.name),
          state.played.map((spec) => ({ entrants: spec.entrants, result: spec })),
        )
      : meleeStandings(melee, state.battle)
  return rows.map((row, i) => ({
    botVersionId: (bots[row.entrant] as JobBot).versionId,
    rank: i + 1,
    score: row.points,
    wins: row.wins,
    ties: row.ties,
    losses: row.losses,
  }))
}

/**
 * Marks tournament job `state` finished in D1, with its bracket, its champion (a bracket's, else
 * the first in the standings), and the time, and returns its standings.
 */
export async function finalizeTournament(
  env: Env,
  state: JobState,
  bots: readonly JobBot[],
  results: ReadonlyMap<number, MatchResult>,
): Promise<Standing[]> {
  const bracket = state.format === 'bracket' ? bracketOf(state, bots, results) : null
  const standings = tournamentStandings(state, bots, results)
  const winner = bracket === null ? null : champion(bracket)
  const championId =
    bracket === null
      ? (standings[0]?.botVersionId ?? null)
      : winner === null
        ? null
        : (bots[winner]?.versionId ?? null)
  await env.DB.prepare(
    `UPDATE tournaments SET status = 'finished', bracket_json = COALESCE(?, bracket_json),
       champion_id = ?, finished_at = ?
     WHERE id = ? AND status = 'running'`,
  )
    .bind(
      bracket === null ? null : JSON.stringify(bracket),
      championId,
      new Date().toISOString(),
      state.tournamentId,
    )
    .run()
  return standings
}

/** Marks tournament job `state` cancelled in D1: the owner stopped it, or it failed. */
export async function cancelTournament(env: Env, state: JobState): Promise<void> {
  await env.DB.prepare(
    "UPDATE tournaments SET status = 'cancelled' WHERE id = ? AND status NOT IN ('finished', 'cancelled')",
  )
    .bind(state.tournamentId)
    .run()
}
