import { DELETED_HANDLE, type UserDetail } from '@asmbots/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  getUserByHandle,
  listBotsByOwner,
  listUserChampionships,
  listUserHillBests,
} from '../db/queries'
import type { AppEnv } from '../env'
import { viewerId } from '../viewer'

/**
 * `GET /api/users/:handle` (any case): the user and their public bots (all of them for the user
 * themself), their best place on each hill, and their championship results. `deleted`, the
 * owner of what deleted accounts leave on hills, is a 404.
 */
export const users = new Hono<AppEnv>().get('/:handle', async (c) => {
  const handle = c.req.param('handle')
  const user = await getUserByHandle(c.env.DB, handle)
  // The owner of deleted accounts' hill bots is no one's profile.
  if (user === null || user.handle === DELETED_HANDLE)
    throw new HTTPException(404, { message: `no user ${handle}` })
  const [bots, hills, championships] = await Promise.all([
    listBotsByOwner(c.env.DB, user.id, user.id !== viewerId(c)),
    listUserHillBests(c.env.DB, user.id),
    listUserChampionships(c.env.DB, user.id),
  ])
  return c.json({ user, bots, hills, championships } satisfies UserDetail)
})
