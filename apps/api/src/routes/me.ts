import {
  type ApiTokenList,
  type AuditList,
  type CreatedApiToken,
  handleProblem,
  MAX_API_TOKENS,
  type Me,
  type MyBotList,
  NewApiToken,
  parse,
  UpdateMe,
} from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { endAllSessions, endSession, refuseToken, requireUser } from '../auth/session'
import { newToken } from '../auth/token'
import { jsonBody, limitBody } from '../body'
import {
  countApiTokens,
  deleteAccount,
  deleteApiToken,
  getUserRow,
  insertApiToken,
  listApiTokens,
  listAudit,
  listMyBots,
  setUserHandle,
  toUser,
  type UserRow,
} from '../db/queries'
import type { AppEnv } from '../env'
import { errorResponse, log } from '../middleware'
import { idParam, wholeParam } from '../params'

function meBody(row: UserRow): Me {
  return { user: toUser(row), onboarded: row.onboarded_at !== null }
}

/** The user is gone (deleted account): the session goes with them. */
async function gone(c: Context<AppEnv>): Promise<Response> {
  await endSession(c)
  return errorResponse(c, 'unauthorized', 'sign in first')
}

/**
 * `GET /api/me`: the signed-in user; 401 when nobody is.
 * `PATCH /api/me` `{ handle }`: a new handle (lowercased; `handleProblem` says which are allowed),
 * 409 when someone else has it. The first one marks the user onboarded. The avatar is GitHub's,
 * refreshed at each sign-in.
 * `GET /api/me/bots`: the signed-in user's bots, private ones too, each with its latest version.
 * `GET /api/me/audit?limit=`: the signed-in user's changes (`AUDIT_ACTIONS`), newest first; `limit`
 * is 1..100, 50 when left out.
 * `DELETE /api/me`: deletes the account (`deleteAccount`) and ends every session it has. 204.
 * `GET /api/me/tokens`: the signed-in user's API tokens (`token.ts`), the newest first; never a
 * token itself, nor its hash.
 * `POST /api/me/tokens` `{ name }`: a new API token, named 1..40 characters once trimmed → 201
 * `{ token, secret }`. `secret` is the token, shown this once. 409 past `MAX_API_TOKENS`.
 * `DELETE /api/me/tokens/:id`: revokes the token at once. 204; 404 when it is not theirs.
 * What only a person on the site may do refuses an API token (`refuseToken`, 403): deleting the
 * account and the tokens routes, so a leaked token cannot make more tokens or lock its user out.
 */
export const me = new Hono<AppEnv>()
  .get('/', requireUser, async (c) => {
    const row = await getUserRow(c.env.DB, c.get('session')?.userId ?? '')
    return row === null ? gone(c) : c.json(meBody(row))
  })
  .get('/bots', requireUser, async (c) => {
    const bots = await listMyBots(c.env.DB, c.get('session')?.userId ?? '')
    return c.json({ bots } satisfies MyBotList)
  })
  .get('/audit', requireUser, async (c) => {
    const limit = wholeParam(c.req.query('limit'), 'the limit', 1, 100, 50)
    const entries = await listAudit(c.env.DB, c.get('session')?.userId ?? '', limit)
    return c.json({ entries } satisfies AuditList)
  })
  .get('/tokens', requireUser, refuseToken, async (c) => {
    const tokens = await listApiTokens(c.env.DB, c.get('session')?.userId ?? '')
    return c.json({ tokens } satisfies ApiTokenList)
  })
  .post('/tokens', requireUser, refuseToken, limitBody(1024), async (c) => {
    const userId = c.get('session')?.userId ?? ''
    const name = parse(NewApiToken, await jsonBody(c), 'the request').name.trim()
    if ((await countApiTokens(c.env.DB, userId)) >= MAX_API_TOKENS) {
      return errorResponse(
        c,
        'conflict',
        `an account holds ${MAX_API_TOKENS} api tokens: revoke one to make another`,
      )
    }
    const { secret, hash, prefix } = await newToken()
    const token = await insertApiToken(c.env.DB, {
      id: crypto.randomUUID(),
      userId,
      name,
      prefix,
      hash,
    })
    return c.json({ token, secret } satisfies CreatedApiToken, 201)
  })
  .delete('/tokens/:id', requireUser, refuseToken, async (c) => {
    const id = idParam(c.req.param('id'), 'the token id')
    const deleted = await deleteApiToken(c.env.DB, c.get('session')?.userId ?? '', id)
    if (!deleted) return errorResponse(c, 'not_found', `no api token ${id}`)
    return c.body(null, 204)
  })
  .delete('/', requireUser, refuseToken, async (c) => {
    const userId = c.get('session')?.userId ?? ''
    const deleted = await deleteAccount(c.env.DB, userId)
    const sessions = await endAllSessions(c.env.KV, userId)
    await endSession(c)
    log('info', 'account deleted', { requestId: c.get('requestId'), userId, deleted, sessions })
    return c.body(null, 204)
  })
  .patch('/', requireUser, limitBody(1024), async (c) => {
    const asked = parse(UpdateMe, await jsonBody(c), 'the request').handle
    const handle = asked.trim().toLowerCase()
    const problem = handleProblem(handle)
    if (problem !== null) return errorResponse(c, 'bad_request', problem)
    const row = await setUserHandle(c.env.DB, c.get('session')?.userId ?? '', handle)
    if (row === 'taken') return errorResponse(c, 'conflict', `${handle} is taken`)
    return row === null ? gone(c) : c.json(meBody(row))
  })
