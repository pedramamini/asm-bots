import type { Me } from '@asmbots/protocol'
import { Hono } from 'hono'
import { endSession, requireUser } from '../auth/session'
import { getUser } from '../db/queries'
import type { AppEnv } from '../env'
import { errorResponse } from '../middleware'

/** `GET /api/me`: the signed-in user; 401 when nobody is. */
export const me = new Hono<AppEnv>().get('/', requireUser, async (c) => {
  const session = c.get('session')
  const user = session && (await getUser(c.env.DB, session.userId))
  if (!user) {
    // The user is gone (deleted account): the session goes with them.
    await endSession(c)
    return errorResponse(c, 'unauthorized', 'sign in first')
  }
  return c.json({ user } satisfies Me)
})
