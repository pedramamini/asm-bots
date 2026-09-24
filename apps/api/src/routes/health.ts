import { Hono } from 'hono'
import type { AppEnv } from '../env'

/** `GET /api/health`: the Worker answers. Touches no binding, so it stays cheap for probes. */
export const health = new Hono<AppEnv>().get('/', (c) =>
  c.json({ ok: true, version: c.env.APP_VERSION, isa: c.env.ISA_VERSION }),
)
