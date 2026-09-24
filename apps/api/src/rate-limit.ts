/**
 * A fixed-window rate limit per client IP, counted in KV. KV is eventually consistent and has no
 * atomic increment, so a burst across edge locations can slip a few requests past the limit: fine
 * for abuse control, not for billing.
 */
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './env'
import { errorResponse } from './middleware'

export interface RateLimit {
  /** Names the counter, so two limits on one IP do not share it. */
  scope: string
  /** Requests allowed per window. */
  limit: number
  /** The window, in seconds; at least 60 (KV's shortest expiry). */
  windowSeconds: number
}

/** The limit on every write route: 60 requests a minute per IP. */
export const WRITE_LIMIT: RateLimit = { scope: 'write', limit: 60, windowSeconds: 60 }

/** The client's IP as Cloudflare saw it; `unknown` only outside Cloudflare's edge. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

export function rateLimit({ scope, limit, windowSeconds }: RateLimit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const now = Math.floor(Date.now() / 1000)
    const window = Math.floor(now / windowSeconds)
    const key = `rl:${scope}:${clientIp(c.req.raw)}:${window}`
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
