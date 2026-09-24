import type { UserDetail } from '@asmbots/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getUserByHandle, listBotsByOwner } from '../db/queries'
import type { AppEnv } from '../env'
import { viewerId } from '../viewer'

/**
 * `GET /api/users/:handle` (any case): the user and their public bots; all of them for the user
 * themself.
 */
export const users = new Hono<AppEnv>().get('/:handle', async (c) => {
  const handle = c.req.param('handle')
  const user = await getUserByHandle(c.env.DB, handle)
  if (user === null) throw new HTTPException(404, { message: `no user ${handle}` })
  const bots = await listBotsByOwner(c.env.DB, user.id, user.id !== viewerId(c))
  return c.json({ user, bots } satisfies UserDetail)
})
