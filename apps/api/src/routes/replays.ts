import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../env'
import { keyParam } from '../params'
import { IMMUTABLE, replayObjectKey } from '../storage'

/**
 * `GET /api/replays/:key`: the protocol `Replay` stored under its `replayKey`, as stored (the
 * write checked it). The key names its content, so the response never changes: a year's cache.
 */
export const replays = new Hono<AppEnv>().get('/:key', async (c) => {
  const key = keyParam(c.req.param('key'), 'the replay key')
  const object = await c.env.REPLAYS.get(replayObjectKey(key))
  if (object === null) throw new HTTPException(404, { message: `no replay ${key}` })
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': IMMUTABLE,
      ETag: `"${key}"`,
    },
  })
})
