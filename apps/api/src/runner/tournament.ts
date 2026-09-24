/**
 * Tournament jobs (PRODUCT_SPEC §4): a tournament's matches, one an alarm. A round robin plays its
 * schedule (`roundRobinSchedule`), a melee its one match of everyone, and a bracket the matches
 * that are ready, drawing the next ones from each result (`advance`). A bracket's seeds and its
 * state go to D1 as it runs; standings go to the room after every match.
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
  createBracket,
  MAX_BRACKET_ENTRANTS,
  MAX_MELEE_ENTRANTS,
  type MatchResult,
  type MatchSpec,
  meleeStandings,
  nextMatches,
  roundRobinSchedule,
  standingsFromMatches,
} from '@asmbots/tourney'
import type { TournamentRow } from '../db/queries'
import type { Env } from '../env'
import { battleOf, type JobBot, JobError, type JobSetup, type JobState, loadBots } from './job'

/** An entrant: its bot version, with its bot's name. */
interface EntrantRow {
  version_id: string
  name: string
  bytes_sha256: string
  size: number
}

/** The bracket of `bots` as entered: seeded in their order. */
function drawBracket(bots: readonly JobBot[]): Bracket {
  return createBracket(
    bots.map((bot) => ({ name: bot.name })),
    { seeding: 'given' },
  )
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
 * Sets up tournament `job`: its entrants (in seed order, then by name) and its first matches,
 * and marks it running. A bracket's seeds are the entrants' order, written to its entries.
 * Throws `JobError` when there is no such tournament, it is over, it has too few or too many
 * entrants, or a bot is over its size.
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
  const { results: entrants } = await db
    .prepare(
      `SELECT v.id AS version_id, b.name, v.bytes_sha256, v.size FROM tournament_entries t
       JOIN bot_versions v ON v.id = t.bot_version_id JOIN bots b ON b.id = v.bot_id
       WHERE t.tournament_id = ? ORDER BY t.seed IS NULL, t.seed, b.name, v.id`,
    )
    .bind(id)
    .all<EntrantRow>()
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
  let queue: MatchSpec[]
  let of: number
  const statements: D1PreparedStatement[] = []
  if (tournament.kind === 'bracket') {
    const bracket = drawBracket(bots)
    queue = readySpecs(bracket, new Set())
    of = playable(bracket)
    statements.push(
      db
        .prepare('UPDATE tournaments SET bracket_json = ? WHERE id = ?')
        .bind(JSON.stringify(bracket), id),
      ...bots.map((bot, e) =>
        db
          .prepare(
            'UPDATE tournament_entries SET seed = ? WHERE tournament_id = ? AND bot_version_id = ?',
          )
          .bind(bracket.seeds[e] ?? null, id, bot.versionId),
      ),
    )
  } else if (tournament.kind === 'melee') {
    queue = [{ id: 0, entrants: bots.map((_, e) => e) }]
    of = 1
  } else {
    queue = roundRobinSchedule(n)
    of = queue.length
  }
  statements.push(db.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").bind(id))
  await db.batch(statements)
  return {
    format: tournament.kind,
    room: liveRoomName({ kind: 'tournament', id }),
    hillId: null,
    tournamentId: id,
    prefix: id,
    rounds: config.rounds,
    battle: battleOf(config.battle, config.seed),
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
  let bracket = drawBracket(bots)
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

/** Marks tournament job `state` finished in D1, with its bracket, and returns its standings. */
export async function finalizeTournament(
  env: Env,
  state: JobState,
  bots: readonly JobBot[],
  results: ReadonlyMap<number, MatchResult>,
): Promise<Standing[]> {
  const bracket = state.format === 'bracket' ? bracketOf(state, bots, results) : null
  await env.DB.prepare(
    `UPDATE tournaments SET status = 'finished', bracket_json = COALESCE(?, bracket_json)
     WHERE id = ? AND status = 'running'`,
  )
    .bind(bracket === null ? null : JSON.stringify(bracket), state.tournamentId)
    .run()
  return tournamentStandings(state, bots, results)
}

/** Marks tournament job `state` cancelled in D1: the owner stopped it, or it failed. */
export async function cancelTournament(env: Env, state: JobState): Promise<void> {
  await env.DB.prepare(
    "UPDATE tournaments SET status = 'cancelled' WHERE id = ? AND status NOT IN ('finished', 'cancelled')",
  )
    .bind(state.tournamentId)
    .run()
}
