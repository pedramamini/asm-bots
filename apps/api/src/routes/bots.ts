import type { Bot, BotDetail, BotVersionDetail } from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  getBot,
  getBotVersionRow,
  getUser,
  listBotPlacements,
  listBotVersions,
  toBotVersion,
} from '../db/queries'
import type { AppEnv } from '../env'
import { idParam, wholeParam } from '../params'
import { viewerId } from '../viewer'

/** The bot `id`, when the reader may see it: a private bot is its owner's, and 404 to others. */
async function visibleBot(c: Context<AppEnv>, id: string): Promise<Bot> {
  const bot = await getBot(c.env.DB, idParam(id, 'the bot id'))
  if (bot === null || (bot.visibility === 'private' && bot.ownerId !== viewerId(c))) {
    throw new HTTPException(404, { message: `no bot ${id}` })
  }
  return bot
}

/**
 * `GET /api/bots/:id`: the bot, its owner, its versions (no sources), and its hill places.
 * `GET /api/bots/:id/versions/:v`: one version, with its source when the bot is public or the
 * reader owns it. An unlisted bot shows to anyone with its link, but not its source.
 */
export const bots = new Hono<AppEnv>()
  .get('/:id', async (c) => {
    const bot = await visibleBot(c, c.req.param('id'))
    const [owner, versions, placements] = await Promise.all([
      getUser(c.env.DB, bot.ownerId),
      listBotVersions(c.env.DB, bot.id),
      listBotPlacements(c.env.DB, bot.id),
    ])
    if (owner === null) throw new Error(`bot ${bot.id} has no owner ${bot.ownerId}`)
    return c.json({ bot, owner, versions, placements } satisfies BotDetail)
  })
  .get('/:id/versions/:v', async (c) => {
    const bot = await visibleBot(c, c.req.param('id'))
    const v = wholeParam(c.req.param('v'), 'the version', 1, Number.MAX_SAFE_INTEGER, 0)
    const row = await getBotVersionRow(c.env.DB, bot.id, v)
    if (row === null) throw new HTTPException(404, { message: `bot ${bot.id} has no version ${v}` })
    const withSource = bot.visibility === 'public' || bot.ownerId === viewerId(c)
    return c.json({ version: toBotVersion(row, withSource) } satisfies BotVersionDetail)
  })
