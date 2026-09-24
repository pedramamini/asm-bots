/**
 * A fixed-window rate limit per client, counted in KV: per user when the request carries a
 * session (`loadSession` runs first), else per IP. KV is eventually consistent and has no atomic
 * increment, so a burst across edge locations can slip a few requests past the limit: fine for
 * abuse control, not for billing.
 */
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'
import { errorResponse } from './middleware'

export interface RateLimit {
  /** Names the counter, so two limits on one client do not share it. */
  scope: string
  /** Requests allowed per window. */
  limit: number
  /** The window, in seconds; at least 60 (KV's shortest expiry). */
  windowSeconds: number
}

/** Every write route: 60 requests a minute. The limits below apply on top of it. */
export const WRITE_LIMIT: RateLimit = { scope: 'write', limit: 60, windowSeconds: 60 }
/** `POST /api/assemble` */
export const ASSEMBLE_LIMIT: RateLimit = { scope: 'assemble', limit: 30, windowSeconds: 60 }
/** `POST /api/bots` and every `POST` under it (import, versions). */
export const BOTS_LIMIT: RateLimit = { scope: 'bots', limit: 20, windowSeconds: 60 }
/** `POST /api/replays`: each one runs a match again. */
export const REPLAYS_LIMIT: RateLimit = { scope: 'replays', limit: 10, windowSeconds: 60 }
/** Every `/api/auth/*` request, reads too: a sign-in is two (start, callback). */
export const AUTH_LIMIT: RateLimit = { scope: 'auth', limit: 10, windowSeconds: 60 }

/** The client's IP as Cloudflare saw it; `unknown` only outside Cloudflare's edge. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

export function rateLimit({ scope, limit, windowSeconds }: RateLimit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const now = Math.floor(Date.now() / 1000)
    const window = Math.floor(now / windowSeconds)
    const userId = c.get('session')?.userId
    const client = userId === undefined ? `ip:${clientIp(c.req.raw)}` : `u:${userId}`
    const key = `rl:${scope}:${client}:${window}`
    const used = Number((await c.env.KV.get(key)) ?? 0)
    const resetIn = (window + 1) * windowSeconds - now
    c.header('X-RateLimit-Limit', String(limit))
    if (used >= limit) {
      c.header('Retry-After', String(resetIn))
      c.header('X-RateLimit-Remaining', '0')
      return errorResponse(c, 'rate_limited', `too many requests: try again in ${resetIn} s`)
    }
    c.header('X-RateLimit-Remaining', String(limit - used - 1))
    // Expire with the window (plus a minute of slack); KV refuses a TTL under 60 s.
    await c.env.KV.put(key, String(used + 1), { expirationTtl: windowSeconds + 60 })
    await next()
  }
}
