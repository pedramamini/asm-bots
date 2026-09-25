import { Hono } from 'hono'
import type { AppEnv, Env } from '../env'

/** When this isolate first answered a health check: the uptime's start without version metadata. */
let firstAnswer: number | null = null

/**
 * How long this build has served, at `now` (ms): since its version went up, the upload time the
 * version metadata binding gives (`wrangler dev`'s start, locally), else since `fallback`. `uptime`
 * is whole seconds.
 */
export function uptimeOf(
  env: Pick<Env, 'CF_VERSION_METADATA'>,
  now: number,
  fallback: number,
): { uptime: number; since: string } {
  const uploaded = Date.parse(env.CF_VERSION_METADATA?.timestamp ?? '')
  const since = Number.isFinite(uploaded) ? uploaded : fallback
  return {
    uptime: Math.max(0, Math.floor((now - since) / 1000)),
    since: new Date(since).toISOString(),
  }
}

/**
 * `GET /api/health`: the Worker answers, with the build stamp, the ISA its hills run, and its
 * uptime. Touches no storage binding, so it stays cheap for probes.
 */
export const health = new Hono<AppEnv>().get('/', (c) => {
  const now = Date.now()
  firstAnswer ??= now
  return c.json({
    ok: true,
    version: c.env.APP_VERSION,
    isa: c.env.ISA_VERSION,
    ...uptimeOf(c.env, now, firstAnswer),
  })
})
