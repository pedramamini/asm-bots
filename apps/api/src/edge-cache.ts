/**
 * Short-lived answers from this colo's edge cache (the Workers Cache API), for reads a crowd
 * repeats and a short delay does not hurt: the hills and their standings cost the database one
 * read a colo each `seconds`. The production custom domain has the Cache API; `wrangler dev` and
 * the tests have a local one.
 */
import type { Context } from 'hono'
import type { AppEnv } from './env'

/** How long the hills and their standings stay cached, s (web README "Budgets"). */
export const HILLS_CACHE_SECONDS = 30

/**
 * Whether a request asks for a copy no cache kept: a reload (`no-cache`), or a browser's
 * `fetch(…, { cache: 'no-cache' })`, which revalidates with `max-age=0`.
 */
export function wantsFresh(cacheControl: string | undefined): boolean {
  return (
    cacheControl !== undefined && /(^|[\s,])(no-cache|no-store|max-age=0)\b/i.test(cacheControl)
  )
}

/**
 * The GET's answer from this colo's edge cache while it is younger than `seconds`, else `make`'s,
 * kept for the next request. Each answer says `public, max-age=<seconds>`, so a browser keeps it
 * as long, and a kept one carries its `Age`. A request that asks for a fresh copy (`wantsFresh`)
 * skips the cache and refreshes it: the web app asks so when it knows a hill changed. Only a 200
 * is kept, and only its type and body: no cookie, no request id.
 */
export async function edgeCached(
  c: Context<AppEnv>,
  seconds: number,
  make: () => Promise<Response>,
): Promise<Response> {
  const key = new Request(c.req.url, { method: 'GET' })
  const cache = caches.default
  if (!wantsFresh(c.req.header('Cache-Control'))) {
    const kept = await cache.match(key)
    if (kept !== undefined) {
      const hit = new Response(kept.body, kept)
      const stored = Date.parse(kept.headers.get('Date') ?? '')
      const age = Number.isNaN(stored) ? 0 : Math.max(0, Math.floor((Date.now() - stored) / 1000))
      hit.headers.set('Age', String(age))
      return hit
    }
  }
  const answer = await make()
  if (answer.status !== 200) return answer
  const body = await answer.arrayBuffer()
  const headers = {
    'Content-Type': answer.headers.get('Content-Type') ?? 'application/json',
    'Cache-Control': `public, max-age=${seconds}`,
    Date: new Date().toUTCString(),
  }
  c.executionCtx.waitUntil(cache.put(key, new Response(body, { headers })))
  return new Response(body, { headers })
}
