import { CORE_SIZE } from '@asmbots/engine'
import {
  type CreatedTournament,
  CreateTournament,
  EnterTournament,
  liveRoomName,
  MAX_REPLAY_ROUNDS,
  MAX_TOURNAMENT_ENTRANTS,
  MAX_VERIFIED_CYCLES,
  parse,
  type Tournament,
  type TournamentDetail,
  type TournamentEntered,
  type TournamentJob,
  type TournamentKind,
  type TournamentList,
  type TournamentStarted,
} from '@asmbots/protocol'
import { MAX_BRACKET_ENTRANTS, MAX_MELEE_ENTRANTS } from '@asmbots/tourney'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser } from '../auth/session'
import { jsonBody, limitBody } from '../body'
import {
  auditInsert,
  getTournament,
  listSubmittedVersions,
  listTournamentEntrants,
  listTournamentEntries,
  listTournamentMatches,
  listTournaments,
  type SubmittedVersionRow,
} from '../db/queries'
import { runnerOf } from '../do/runner'
import type { AppEnv } from '../env'
import { errorResponse, log } from '../middleware'
import { idParam } from '../params'
import { viewerId } from '../viewer'
import { slugStem } from './bots'

/** The most bots a server tournament of each kind takes. */
export const MOST_ENTRANTS: Readonly<Record<TournamentKind, number>> = {
  roundrobin: MAX_TOURNAMENT_ENTRANTS,
  bracket: MAX_BRACKET_ENTRANTS,
  melee: MAX_MELEE_ENTRANTS,
}

/** How far ahead an open tournament's deadline may be. */
export const MAX_ENTRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const unprocessable = (message: string) => new HTTPException(422, { message })

/** Tournament `:id` of the path, or a 404: a draft is its owner's only. */
async function tournamentOf(c: Context<AppEnv>): Promise<Tournament> {
  const id = idParam(c.req.param('id') ?? '', 'the tournament id')
  const tournament = await getTournament(c.env.DB, id)
  if (
    tournament === null ||
    (tournament.status === 'draft' && tournament.ownerId !== viewerId(c))
  ) {
    throw new HTTPException(404, { message: `no tournament ${id}` })
  }
  return tournament
}

/**
 * Refuses (422) a config the server will not play: more rounds a match than a replay holds, more
 * cycles a round than it checks an upload for, or one the engine refuses.
 */
function checkConfig({ rounds, battle }: CreateTournament['config']): void {
  if (rounds > MAX_REPLAY_ROUNDS) {
    throw unprocessable(`a tournament plays ${MAX_REPLAY_ROUNDS} rounds a match at most`)
  }
  if (battle.maxCycles > MAX_VERIFIED_CYCLES) {
    const most = MAX_VERIFIED_CYCLES.toLocaleString('en-US')
    throw unprocessable(`a tournament plays ${most} cycles a round at most`)
  }
  if (battle.coreSize !== CORE_SIZE) {
    throw unprocessable(`the core is ${CORE_SIZE} bytes in x16c v1, not ${battle.coreSize}`)
  }
  if (battle.minSpacing > CORE_SIZE || battle.maxBotBytes > CORE_SIZE) {
    throw unprocessable(`the spacing and the bot size are ${CORE_SIZE} bytes at most`)
  }
}

/**
 * Refuses a version the signed-in user may not enter, as a hill submission does: one they may not
 * see (404), and one of another user's bots (403), unless `publicOk` and it is public. Refuses one
 * over `cap` bytes (422).
 */
function checkVersion(
  id: string,
  version: SubmittedVersionRow | undefined,
  userId: string,
  cap: number,
  publicOk: boolean,
): SubmittedVersionRow {
  if (
    version === undefined ||
    version.deleted_at !== null ||
    (version.visibility === 'private' && version.owner_id !== userId)
  ) {
    throw new HTTPException(404, { message: `no bot version ${id}` })
  }
  if (version.owner_id !== userId && !(publicOk && version.visibility === 'public')) {
    throw new HTTPException(403, {
      message: publicOk
        ? `bot version ${id} is not yours, and not public`
        : `bot version ${id} is not yours`,
    })
  }
  if (version.size > cap) {
    throw unprocessable(`${version.name} v${version.version} is ${version.size} bytes, over ${cap}`)
  }
  return version
}

/**
 * `POST /api/tournaments` `{ name, kind, entrants, config }`: the signed-in user makes a
 * tournament, `scheduled`, that they start (`/start`). `entrants` is an invite of 2..32 bot
 * versions (their own, or anyone's public ones; a melee takes 16), seeded in the list's order, or
 * open entry with a deadline within 30 days. Refused: a config the server does not play, a
 * version named twice (400), a version the user may not enter (404, 403), one over the config's
 * `maxBotBytes` (422). The tournament, its invited entries, and its `tournament.create` audit row
 * go in one batch → 201 `{ tournament }`.
 */
async function create(c: Context<AppEnv>): Promise<Response> {
  const body = parse(CreateTournament, await jsonBody(c), 'the request')
  const userId = viewerId(c) ?? ''
  const db = c.env.DB
  checkConfig(body.config)
  const cap = body.config.battle.maxBotBytes
  const most = MOST_ENTRANTS[body.kind]
  const now = Date.now()
  let closesAt: string | null = null
  let invited: string[] = []
  if (body.entrants.entry === 'invite') {
    invited = body.entrants.botVersionIds
    const twice = invited.find((id, i) => invited.indexOf(id) !== i)
    if (twice !== undefined) {
      return errorResponse(c, 'bad_request', `bot version ${twice} is named twice`)
    }
    if (invited.length > most) throw unprocessable(`a ${body.kind} takes ${most} bots at most`)
    const versions = await listSubmittedVersions(db, invited)
    for (const id of invited) checkVersion(id, versions.get(id), userId, cap, true)
  } else {
    const at = Date.parse(body.entrants.closesAt)
    if (Number.isNaN(at)) {
      return errorResponse(c, 'bad_request', 'entrants.closesAt is not a time')
    }
    if (at <= now) throw unprocessable('the entry deadline has passed')
    if (at > now + MAX_ENTRY_WINDOW_MS) {
      throw unprocessable('the entry deadline is 30 days away at most')
    }
    closesAt = new Date(at).toISOString()
  }

  const id = crypto.randomUUID()
  const slug = `${(slugStem(body.name) || 'tournament').slice(0, 54)}-${id.slice(0, 8)}`
  const enteredAt = new Date(now).toISOString()
  await db.batch([
    db
      .prepare(
        `INSERT INTO tournaments
           (id, slug, name, kind, status, config_json, owner_id, entry, entry_closes_at)
         VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        slug,
        body.name,
        body.kind,
        JSON.stringify(body.config),
        userId,
        body.entrants.entry,
        closesAt,
      ),
    ...(invited.length === 0
      ? []
      : [
          db
            .prepare(
              `INSERT INTO tournament_entries (tournament_id, bot_version_id, seed, entered_at)
               SELECT ?1, value, key + 1, ?2 FROM json_each(?3)`,
            )
            .bind(id, enteredAt, JSON.stringify(invited)),
        ]),
    auditInsert(db, userId, 'tournament.create', id),
  ])
  const tournament = await getTournament(db, id)
  if (tournament === null) throw new Error(`tournament ${id} is not there after its insert`)
  return c.json({ tournament } satisfies CreatedTournament, 201)
}

/**
 * `POST /api/tournaments/:id/enter` `{ botVersionId }`: the signed-in user enters a version of one
 * of their bots in an open tournament before its deadline. One entry a user: a second replaces the
 * first (200, `replaced`), a first is 201. Refused: an invite (409), a tournament started or
 * past its deadline (409), a full one (409), a version not theirs (404, 403) or over the size
 * (422). The entry and its `tournament.enter` audit row go in one batch.
 */
async function enter(c: Context<AppEnv>): Promise<Response> {
  const { botVersionId } = parse(EnterTournament, await jsonBody(c), 'the request')
  const tournament = await tournamentOf(c)
  const userId = viewerId(c) ?? ''
  const db = c.env.DB
  const { id, name } = tournament
  if (tournament.entry !== 'open') {
    return errorResponse(c, 'conflict', `${name} takes the bots its owner invited, no entries`)
  }
  if (tournament.status !== 'scheduled') {
    return errorResponse(c, 'conflict', `${name} is ${tournament.status}: entry is closed`)
  }
  const closesAt = tournament.entryClosesAt
  if (closesAt === null || Date.now() >= Date.parse(closesAt)) {
    return errorResponse(c, 'conflict', `entry to ${name} closed at ${closesAt}`)
  }
  const versions = await listSubmittedVersions(db, [botVersionId])
  checkVersion(
    botVersionId,
    versions.get(botVersionId),
    userId,
    tournament.config.battle.maxBotBytes,
    false,
  )
  const entries = await listTournamentEntries(db, id)
  const mine = entries.find((e) => e.user_id === userId)?.bot_version_id ?? null
  if (mine === botVersionId) {
    const same: TournamentEntered = { tournamentId: id, botVersionId, replaced: null }
    return c.json(same)
  }
  const most = MOST_ENTRANTS[tournament.kind]
  if (mine === null && entries.length >= most) {
    return errorResponse(c, 'conflict', `${name} is full: it takes ${most} bots`)
  }
  if (entries.some((e) => e.bot_version_id === botVersionId)) {
    return errorResponse(c, 'conflict', `bot version ${botVersionId} is in ${name} already`)
  }
  try {
    await db.batch([
      db
        .prepare('DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = ?')
        .bind(id, userId),
      db
        .prepare(
          `INSERT INTO tournament_entries (tournament_id, bot_version_id, user_id, entered_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(id, botVersionId, userId, new Date().toISOString()),
      auditInsert(db, userId, 'tournament.enter', id),
    ])
  } catch (error) {
    // Another request of theirs entered in between the read and the batch.
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: tournament_entries/.test(error.message)
    ) {
      return errorResponse(c, 'conflict', `you entered ${name} from another request: try again`)
    }
    throw error
  }
  const entered: TournamentEntered = { tournamentId: id, botVersionId, replaced: mine }
  return c.json(entered, mine === null ? 201 : 200)
}

/**
 * `POST /api/tournaments/:id/start`: its owner starts a scheduled tournament; its `Runner` plays
 * it (the cron starts the championships, which have no owner). Refused: another user (403), a
 * tournament not scheduled, one still taking entries, one of fewer than 2 bots (409). A job the
 * Runner refuses cancels the tournament: 409 with the reason. → 200 `{ tournamentId, liveRoom }`.
 */
async function start(c: Context<AppEnv>): Promise<Response> {
  const tournament = await tournamentOf(c)
  const { id, name } = tournament
  if (tournament.ownerId === null) {
    throw new HTTPException(403, { message: `${name} is a championship: the cron starts it` })
  }
  if (tournament.ownerId !== viewerId(c)) {
    throw new HTTPException(403, { message: `${name} is not yours` })
  }
  if (tournament.status !== 'scheduled' && tournament.status !== 'draft') {
    return errorResponse(c, 'conflict', `${name} is ${tournament.status}`)
  }
  const closesAt = tournament.entryClosesAt
  if (closesAt !== null && Date.now() < Date.parse(closesAt)) {
    return errorResponse(c, 'conflict', `${name} takes entries until ${closesAt}: start it then`)
  }
  const entrants = (await listTournamentEntries(c.env.DB, id)).length
  if (entrants < 2) {
    return errorResponse(c, 'conflict', `${name} has ${entrants} bots: it needs 2 to start`)
  }
  const job: TournamentJob = { kind: 'tournament', tournamentId: id }
  try {
    await runnerOf(c.env, job).start(job)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('warn', 'tournament.start', {
      requestId: c.get('requestId'),
      tournament: id,
      error: message,
    })
    // The runner cancels a tournament it refuses; one it did not answer for stays scheduled.
    if ((await getTournament(c.env.DB, id))?.status === 'cancelled') {
      return errorResponse(c, 'conflict', `${name} could not start: ${message}`)
    }
    throw error
  }
  const started: TournamentStarted = {
    tournamentId: id,
    liveRoom: liveRoomName({ kind: 'tournament', id }),
  }
  return c.json(started)
}

/**
 * `GET /api/tournaments`: running first, then by start time (`listTournaments`), each with its
 * entrant count, how far it is, and its champion.
 * `GET /api/tournaments/:id`: the tournament, its entrants (in the order its matches index once it
 * has started), and its matches. A draft is its owner's: 404 to anyone else.
 * `POST /api/tournaments`, `POST /api/tournaments/:id/enter`, `POST /api/tournaments/:id/start`:
 * above.
 */
export const tournaments = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json({
      tournaments: await listTournaments(c.env.DB, { viewerId: viewerId(c) }),
    } satisfies TournamentList),
  )
  .post('/', requireUser, limitBody(16 * 1024), create)
  .get('/:id', async (c) => {
    const tournament = await tournamentOf(c)
    const [entrants, matches] = await Promise.all([
      listTournamentEntrants(c.env.DB, tournament.id),
      listTournamentMatches(c.env.DB, tournament.id),
    ])
    return c.json({ tournament, entrants, matches } satisfies TournamentDetail)
  })
  .post('/:id/enter', requireUser, limitBody(1024), enter)
  .post('/:id/start', requireUser, limitBody(1024), start)
