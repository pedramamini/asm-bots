import { assemble } from '@asmbots/asm'
import {
  type Bot,
  type BotDetail,
  type BotVersionDetail,
  ImportBotsRequest,
  type ImportBotsResult,
  type ImportedBot,
  MAX_BOTS_PER_USER,
  type NewBot,
  parse,
  sha256Hex,
} from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser } from '../auth/session'
import { jsonBody, limitBody } from '../body'
import {
  type BotRow,
  type BotVersionRow,
  getBot,
  getBotVersionRow,
  getUser,
  listBotPlacements,
  listBotSlugs,
  listBotVersions,
  toBot,
  toBotVersion,
} from '../db/queries'
import type { AppEnv } from '../env'
import { errorResponse } from '../middleware'
import { idParam, wholeParam } from '../params'
import { botBytesKey } from '../storage'
import { viewerId } from '../viewer'

/** The bot `id`, when the reader may see it: a private bot is its owner's, and 404 to others. */
async function visibleBot(c: Context<AppEnv>, id: string): Promise<Bot> {
  const bot = await getBot(c.env.DB, idParam(id, 'the bot id'))
  if (bot === null || (bot.visibility === 'private' && bot.ownerId !== viewerId(c))) {
    throw new HTTPException(404, { message: `no bot ${id}` })
  }
  return bot
}

/** A bot's slug from its name: `Dwarf v2!` is `dwarf-v2`, `dwarf-v2-2` when that is taken. */
export function botSlug(name: string, taken: ReadonlySet<string>): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 56)
      .replace(/-+$/, '') || 'bot'
  let slug = stem
  for (let n = 2; taken.has(slug); n++) slug = `${stem}-${n}`
  return slug
}

/**
 * A new bot's source, assembled by the server: its bytes, or why it has none. The assembler holds
 * a bot to its size cap (`size-over-cap`).
 */
async function assembleNew(bot: NewBot) {
  const out = assemble(bot.source)
  const diagnostics = out.diagnostics
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false as const, message: 'it does not assemble', diagnostics }
  }
  if (out.bytes.length === 0) return { ok: false as const, message: 'it has no code', diagnostics }
  return { ok: true as const, out, sha256: await sha256Hex(out.bytes) }
}

/**
 * `POST /api/bots/import` `{ bots: [{ name, source, visibility? }] }`: the signed-in user's local
 * bots, kept in their account, each a new bot at version 1 (private unless it says otherwise). The
 * server assembles each source; one that does not assemble is refused on its own, and the rest are
 * made together. 409 when the account would go over
 * `MAX_BOTS_PER_USER`.
 */
async function importBots(c: Context<AppEnv>): Promise<Response> {
  const { bots } = parse(ImportBotsRequest, await jsonBody(c), 'the request')
  const ownerId = c.get('session')?.userId ?? ''
  const slugs = await listBotSlugs(c.env.DB, ownerId)
  if (slugs.size + bots.length > MAX_BOTS_PER_USER) {
    const room = Math.max(0, MAX_BOTS_PER_USER - slugs.size)
    return errorResponse(
      c,
      'conflict',
      `an account holds ${MAX_BOTS_PER_USER} bots: there is room for ${room} more`,
    )
  }
  const results: (ImportedBot | null)[] = []
  const statements: D1PreparedStatement[] = []
  for (const bot of bots) {
    const made = await assembleNew(bot)
    if (!made.ok) {
      results.push(made)
      continue
    }
    const botId = crypto.randomUUID()
    const slug = botSlug(bot.name, slugs)
    slugs.add(slug)
    await c.env.REPLAYS.put(botBytesKey(made.sha256), made.out.bytes)
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES (?, ?, ?, ?, ?) RETURNING *',
      ).bind(botId, ownerId, slug, bot.name, bot.visibility ?? 'private'),
      c.env.DB.prepare(
        `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, author, strategy, isa)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ).bind(
        crypto.randomUUID(),
        botId,
        bot.source,
        made.sha256,
        made.out.bytes.length,
        made.out.author || null,
        made.out.strategy || null,
        c.env.ISA_VERSION,
      ),
    )
    // Filled in from the batch below.
    results.push(null)
  }
  const made = statements.length === 0 ? [] : await c.env.DB.batch(statements)
  let next = 0
  const filled = results.map((result): ImportedBot => {
    if (result !== null) return result
    const botRow = made[next++]?.results[0] as BotRow
    const versionRow = made[next++]?.results[0] as BotVersionRow
    return { ok: true, bot: toBot(botRow), version: toBotVersion(versionRow, true) }
  })
  return c.json({ results: filled } satisfies ImportBotsResult, 201)
}

/**
 * `GET /api/bots/:id`: the bot, its owner, its versions (no sources), and its hill places.
 * `GET /api/bots/:id/versions/:v`: one version, with its source when the bot is public or the
 * reader owns it. An unlisted bot shows to anyone with its link, but not its source.
 */
export const bots = new Hono<AppEnv>()
  .post('/import', requireUser, limitBody(1024 * 1024), importBots)
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
