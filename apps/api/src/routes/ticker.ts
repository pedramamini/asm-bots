import { TICKER_TTL_MS, type Ticker } from '@asmbots/protocol'
import { Hono } from 'hono'
import { latestHillChallenge, tickerChampionships } from '../db/queries'
import type { AppEnv, Env } from '../env'
import { countSpectators, openableRooms } from '../rooms'

/** Where KV keeps the ticker's feed. */
export const TICKER_KEY = 'ticker'

/** How long KV keeps the key, seconds: its least. The feed is read again after `TICKER_TTL_MS`. */
const KV_TTL_SECONDS = 60

/** The feed as KV keeps it, with when it was read (ms since the epoch). */
interface CachedTicker {
  readonly at: number
  readonly ticker: Ticker
}

/**
 * The ticker's feed as of `now`: the latest challenge on any hill, the last championship to
 * finish and the next, and the spectators in the rooms a page may have open.
 */
export async function readTicker(env: Env, now: Date): Promise<Ticker> {
  const [hill, championships, rooms] = await Promise.all([
    latestHillChallenge(env.DB),
    tickerChampionships(env.DB),
    openableRooms(env.DB),
  ])
  const counts = await countSpectators(env, rooms)
  return {
    at: now.toISOString(),
    hill,
    lastChampionship: championships.last,
    nextChampionship: championships.next,
    spectators: counts.reduce((sum, room) => sum + room.spectators, 0),
  }
}

/**
 * `GET /api/ticker` (PRODUCT_SPEC §1): the ticker's feed, which every page reads. It comes from KV
 * while it is younger than `TICKER_TTL_MS` (30 s), so a crowd costs the database and the live
 * rooms one read each half minute; then it is read again and kept.
 */
export const ticker = new Hono<AppEnv>().get('/', async (c) => {
  const now = Date.now()
  const cached = await c.env.KV.get<CachedTicker>(TICKER_KEY, 'json')
  if (cached !== null && now >= cached.at && now - cached.at < TICKER_TTL_MS) {
    return c.json(cached.ticker)
  }
  const feed = await readTicker(c.env, new Date(now))
  await c.env.KV.put(TICKER_KEY, JSON.stringify({ at: now, ticker: feed } satisfies CachedTicker), {
    expirationTtl: KV_TTL_SECONDS,
  })
  return c.json(feed)
})
