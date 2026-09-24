import type { ChampionshipList } from '@asmbots/protocol'
import { Hono } from 'hono'
import { listChampionships, MAX_LIMIT } from '../db/queries'
import type { AppEnv } from '../env'
import { wholeParam } from '../params'

/**
 * `GET /api/championships?limit=`: the championships feed, the finished championships with their
 * champions, the latest first; `limit` is 1..100, 20 when left out. A championship lands here when
 * its `Runner` finishes it.
 */
export const championships = new Hono<AppEnv>().get('/', async (c) => {
  const limit = wholeParam(c.req.query('limit'), 'the limit', 1, MAX_LIMIT, 20)
  return c.json({
    championships: await listChampionships(c.env.DB, limit),
  } satisfies ChampionshipList)
})
