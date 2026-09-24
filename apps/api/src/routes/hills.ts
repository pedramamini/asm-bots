import type { HillDetail, HillList, MatchList } from '@asmbots/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  getHillBySlug,
  listBotLabels,
  listHillMatches,
  listHillStandings,
  listHillSummaries,
  MAX_LIMIT,
} from '../db/queries'
import type { AppEnv } from '../env'
import { idParam, slugParam, wholeParam } from '../params'

/**
 * `GET /api/hills`: every hill, its entrant count, and its king.
 * `GET /api/hills/:slug`: the hill and its standings.
 * `GET /api/hills/:slug/matches?bot=&limit=`: its finished matches, newest first; with `bot` (a
 * bot version id), only the ones that version played. `limit` is 1..100, 50 when left out.
 */
export const hills = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ hills: await listHillSummaries(c.env.DB) } satisfies HillList))
  .get('/:slug', async (c) => {
    const slug = slugParam(c.req.param('slug'), 'the hill')
    const hill = await getHillBySlug(c.env.DB, slug)
    if (hill === null) throw new HTTPException(404, { message: `no hill ${slug}` })
    const standings = await listHillStandings(c.env.DB, hill.id)
    return c.json({ hill, standings } satisfies HillDetail)
  })
  .get('/:slug/matches', async (c) => {
    const slug = slugParam(c.req.param('slug'), 'the hill')
    const bot = c.req.query('bot')
    const botVersionId = bot === undefined ? undefined : idParam(bot, 'the bot version id')
    const limit = wholeParam(c.req.query('limit'), 'the limit', 1, MAX_LIMIT, 50)
    const hill = await getHillBySlug(c.env.DB, slug)
    if (hill === null) throw new HTTPException(404, { message: `no hill ${slug}` })
    const matches = await listHillMatches(c.env.DB, hill.id, { botVersionId, limit })
    const labels = await listBotLabels(
      c.env.DB,
      matches.flatMap((m) => m.participants),
    )
    return c.json({
      matches: matches.map((match) => ({
        match,
        bots: match.participants.map((id) => labels.get(id) ?? null),
      })),
    } satisfies MatchList)
  })
