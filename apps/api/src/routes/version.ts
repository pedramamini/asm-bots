import { LIVE_PROTOCOL } from '@asmbots/protocol'
import { Hono } from 'hono'
import type { AppEnv } from '../env'

/**
 * `GET /api/version`: what a client checks before it talks to this Worker: the build stamp, the
 * ISA its hills run, and the `LiveRoom` message protocol.
 */
export const version = new Hono<AppEnv>().get('/', (c) =>
  c.json({ version: c.env.APP_VERSION, isa: c.env.ISA_VERSION, live: LIVE_PROTOCOL }),
)
