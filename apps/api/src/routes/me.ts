import { handleProblem, type Me, type MyBotList, parse, UpdateMe } from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { endSession, requireUser } from '../auth/session'
import { jsonBody, limitBody } from '../body'
import { getUserRow, listMyBots, setUserHandle, toUser, type UserRow } from '../db/queries'
import type { AppEnv } from '../env'
import { errorResponse } from '../middleware'

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
  .patch('/', requireUser, limitBody(1024), async (c) => {
    const asked = parse(UpdateMe, await jsonBody(c), 'the request').handle
    const handle = asked.trim().toLowerCase()
    const problem = handleProblem(handle)
    if (problem !== null) return errorResponse(c, 'bad_request', problem)
    const row = await setUserHandle(c.env.DB, c.get('session')?.userId ?? '', handle)
    if (row === 'taken') return errorResponse(c, 'conflict', `${handle} is taken`)
    return row === null ? gone(c) : c.json(meBody(row))
  })
