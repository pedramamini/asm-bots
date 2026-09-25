import {
  type Hill,
  type HillDetail,
  type HillHistory,
  type HillJob,
  type HillList,
  HillSubmitRequest,
  type HillSubmitted,
  liveRoomName,
  type MatchList,
  type MatchSummary,
  parse,
  type SubmissionDetail,
  type SubmissionProgress,
} from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser } from '../auth/session'
import { jsonBody, limitBody } from '../body'
import {
  auditInsert,
  findActiveSubmission,
  findHillEntryOf,
  getHillBySlug,
  getHillSubmission,
  getSubmittedVersion,
  type HillSubmissionRow,
  listBotLabels,
  listHillHistory,
  listHillMatches,
  listHillStandings,
  listHillSummaries,
  listSubmissionEvents,
  listSubmissionMatches,
  MAX_LIMIT,
  toHillSubmission,
} from '../db/queries'
import { runnerOf } from '../do/runner'
import { edgeCached, HILLS_CACHE_SECONDS } from '../edge-cache'
import type { AppEnv, Env } from '../env'
import { errorResponse, log } from '../middleware'
import { hillCard } from '../og/hill'
import { type CardFormat, cardHost, LIVE_CARD_AGE, sendCard } from '../og/send'
import { idParam, slugParam, wholeParam } from '../params'
import { viewerId } from '../viewer'

/** Hill `slug` of the path, or a 404. */
async function hillOf(c: Context<AppEnv>): Promise<Hill> {
  const slug = slugParam(c.req.param('slug') ?? '', 'the hill')
  const hill = await getHillBySlug(c.env.DB, slug)
  if (hill === null) throw new HTTPException(404, { message: `no hill ${slug}` })
  return hill
}

/** The path's hill's share card in `format`, its standings as they are now. */
const card = (format: CardFormat) => async (c: Context<AppEnv>) => {
  const hill = await hillOf(c)
  const standings = await listHillStandings(c.env.DB, hill.id)
  return sendCard(c, hillCard(hill, standings, cardHost(c.env)), format, LIVE_CARD_AGE)
}

/** The 409 of a user who has a submission on the hill already: one at a time. */
function busy(c: Context<AppEnv>, hill: Hill, active: string): Response {
  return errorResponse(
    c,
    'conflict',
    `your submission ${active} is still running on the ${hill.slug} hill: one at a time`,
  )
}

/**
 * `POST /api/hills/:slug/submit` `{ botVersionId }`: the signed-in user challenges the hill with a
 * version of one of their bots. The bytes are the ones the server assembled when the version was
 * saved. Refused: a version that is not theirs (404 when they may not see it, else 403), a hill
 * that scores melees, a version over the hill's size (422), a version on the hill, bytes an entry
 * has (it would take that entry's place and age), and a second submission while one runs (409).
 * The submission row and its `hill.submit` audit row go in one batch; then its `Runner` starts, and
 * the answer is 201 `{ submissionId, liveRoom }`. A job the Runner refuses is marked failed: 409.
 */
async function submit(c: Context<AppEnv>): Promise<Response> {
  const { botVersionId } = parse(HillSubmitRequest, await jsonBody(c), 'the request')
  const hill = await hillOf(c)
  const userId = viewerId(c) ?? ''
  const db = c.env.DB
  if (hill.scoring !== 'duel') {
    return errorResponse(
      c,
      'conflict',
      `the ${hill.slug} hill scores melees, and takes no submissions yet`,
    )
  }
  const version = await getSubmittedVersion(db, botVersionId)
  if (
    version === null ||
    version.deleted_at !== null ||
    (version.visibility === 'private' && version.owner_id !== userId)
  ) {
    throw new HTTPException(404, { message: `no bot version ${botVersionId}` })
  }
  if (version.owner_id !== userId) {
    throw new HTTPException(403, { message: `bot version ${botVersionId} is not yours` })
  }
  const what = `${version.name} v${version.version}`
  const cap = hill.config.maxBotBytes
  if (version.size > cap) {
    return errorResponse(
      c,
      'unprocessable',
      `${what} is ${version.size} bytes, and the ${hill.slug} hill takes ${cap}`,
    )
  }
  const on = await findHillEntryOf(db, hill.id, version.id, version.bytes_sha256)
  if (on !== null) {
    return errorResponse(
      c,
      'conflict',
      on.bot_version_id === version.id
        ? `${what} is on the ${hill.slug} hill already`
        : `the ${hill.slug} hill has these bytes already, as ${on.name}: change the code to challenge it`,
    )
  }
  const active = await findActiveSubmission(db, userId, hill.id)
  if (active !== null) return busy(c, hill, active)

  const id = crypto.randomUUID()
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO hill_submissions (id, hill_id, bot_version_id, user_id) VALUES (?, ?, ?, ?)',
        )
        .bind(id, hill.id, version.id, userId),
      auditInsert(db, userId, 'hill.submit', id),
    ])
  } catch (error) {
    // Another request of theirs got in between the check and the insert.
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: hill_submissions/.test(error.message)
    ) {
      return busy(c, hill, (await findActiveSubmission(db, userId, hill.id)) ?? 'another')
    }
    throw error
  }

  const job: HillJob = { kind: 'hill', hill: hill.slug, submissionId: id, botVersionId: version.id }
  try {
    await runnerOf(c.env, job).start(job)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const row = await getHillSubmission(db, id)
    log('warn', 'hill.submit', { requestId: c.get('requestId'), submission: id, error: message })
    // The runner marks a job it refuses failed; a runner that did not answer leaves it queued,
    // and a queued row would hold the user's place on the hill for good.
    if (row?.status === 'failed') {
      return errorResponse(c, 'conflict', `the ${hill.slug} hill could not take it: ${message}`)
    }
    await db
      .prepare("UPDATE hill_submissions SET status = 'failed' WHERE id = ? AND status = 'queued'")
      .bind(id)
      .run()
    throw error
  }
  const submitted: HillSubmitted = {
    submissionId: id,
    liveRoom: liveRoomName({ kind: 'hill', id: hill.id }),
  }
  return c.json(submitted, 201)
}

/**
 * How far submission `row`'s job is, from its `Runner`: null once the submission has finished,
 * and when the Runner has no such job or does not answer (the page can do without it).
 */
async function progressOf(
  env: Env,
  hill: Hill,
  row: HillSubmissionRow,
): Promise<{ done: number; of: number; next: readonly string[] | null } | null> {
  if (row.status === 'finished') return null
  const job: HillJob = {
    kind: 'hill',
    hill: hill.slug,
    submissionId: row.id,
    botVersionId: row.bot_version_id,
  }
  try {
    const status = await runnerOf(env, job).status()
    return status && { done: status.done, of: status.of, next: status.next }
  } catch (error) {
    log('warn', 'hill.progress', {
      submission: row.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** `GET /api/hills/:slug/submissions/:id`: the submission, as `SubmissionDetail` says. */
async function submission(c: Context<AppEnv>): Promise<Response> {
  const hill = await hillOf(c)
  const id = idParam(c.req.param('id') ?? '', 'the submission id')
  const db = c.env.DB
  const row = await getHillSubmission(db, id)
  if (row === null || row.hill_id !== hill.id) {
    throw new HTTPException(404, { message: `the ${hill.slug} hill has no submission ${id}` })
  }
  const [matches, events, job] = await Promise.all([
    listSubmissionMatches(db, hill.id, id),
    listSubmissionEvents(db, id),
    progressOf(c.env, hill, row),
  ])
  const labels = await listBotLabels(db, [
    row.bot_version_id,
    ...matches.flatMap((m) => m.participants),
    ...(job?.next ?? []),
  ])
  const label = (versionId: string) => labels.get(versionId) ?? null
  const progress: SubmissionProgress | null = job && {
    done: job.done,
    of: job.of,
    next: job.next?.map(label) ?? null,
  }
  const detail: SubmissionDetail = {
    submission: toHillSubmission(row),
    bot: label(row.bot_version_id),
    progress,
    matches: matches.map((match): MatchSummary => ({ match, bots: match.participants.map(label) })),
    events,
  }
  return c.json(detail)
}

/**
 * `GET /api/hills`: every hill, its entrant count, and its king.
 * `GET /api/hills/:slug`: the hill and its standings, each with its rating's RD.
 * Both are cached 30 s (`edgeCached`): a request with `Cache-Control: no-cache` gets them as they
 * are, as the web app asks once it knows a board changed.
 * `GET /api/hills/:slug/matches?bot=&limit=`: its finished matches, newest first; with `bot` (a
 * bot version id), only the ones that version played. `limit` is 1..100, 50 when left out.
 * `GET /api/hills/:slug/history?limit=`: what its submissions did to its board (`HillEvent`s),
 * newest first; `limit` is 1..100, 20 when left out.
 * `POST /api/hills/:slug/submit` and `GET /api/hills/:slug/submissions/:id`: above.
 * `GET /api/hills/:slug/og.svg` and `og.png`: its share card (`og/hill.ts`), the standings as they
 * are.
 */
export const hills = new Hono<AppEnv>()
  .get('/', (c) =>
    edgeCached(c, HILLS_CACHE_SECONDS, async () =>
      c.json({ hills: await listHillSummaries(c.env.DB) } satisfies HillList),
    ),
  )
  .get('/:slug', (c) =>
    edgeCached(c, HILLS_CACHE_SECONDS, async () => {
      const hill = await hillOf(c)
      const standings = await listHillStandings(c.env.DB, hill.id)
      return c.json({ hill, standings } satisfies HillDetail)
    }),
  )
  .get('/:slug/matches', async (c) => {
    const bot = c.req.query('bot')
    const botVersionId = bot === undefined ? undefined : idParam(bot, 'the bot version id')
    const limit = wholeParam(c.req.query('limit'), 'the limit', 1, MAX_LIMIT, 50)
    const hill = await hillOf(c)
    const matches = await listHillMatches(c.env.DB, hill.id, { botVersionId, limit })
    const labels = await listBotLabels(
      c.env.DB,
      matches.flatMap((m) => m.participants),
    )
    return c.json({
      matches: matches.map((match) => ({
        match,
        bots: match.participants.map((id) => labels.get(id) ?? null),
      })),
    } satisfies MatchList)
  })
  .get('/:slug/history', async (c) => {
    const limit = wholeParam(c.req.query('limit'), 'the limit', 1, MAX_LIMIT, 20)
    const hill = await hillOf(c)
    return c.json({ events: await listHillHistory(c.env.DB, hill.id, limit) } satisfies HillHistory)
  })
  .get('/:slug/og.svg', card('svg'))
  .get('/:slug/og.png', card('png'))
  .post('/:slug/submit', requireUser, limitBody(1024), submit)
  .get('/:slug/submissions/:id', submission)
