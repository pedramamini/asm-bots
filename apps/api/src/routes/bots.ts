import { assemble } from '@asmbots/asm'
import {
  type Bot,
  type BotDetail,
  type BotVersionDetail,
  ImportBotsRequest,
  type ImportBotsResult,
  type ImportedBot,
  MAX_BOTS_PER_USER,
  MAX_VERSIONS_PER_BOT,
  NewBot,
  NewBotVersion,
  parse,
  type SavedBot,
  type SavedBotVersion,
  sha256Hex,
  UpdateBot,
  type UpdatedBot,
} from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser } from '../auth/session'
import { jsonBody, limitBody } from '../body'
import {
  auditInsert,
  type BotRow,
  type BotVersionRow,
  countBots,
  getBot,
  getBotVersionRow,
  getLatestBotVersionRow,
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

/** The bot `id`, when it is the signed-in user's: 404 when they may not see it, else 403. */
async function ownBot(c: Context<AppEnv>, id: string): Promise<Bot> {
  const bot = await visibleBot(c, id)
  if (bot.ownerId !== viewerId(c))
    throw new HTTPException(403, { message: `bot ${id} is not yours` })
  return bot
}

/** The signed-in user's id; the routes that read it sit behind `requireUser`. */
function userId(c: Context<AppEnv>): string {
  return c.get('session')?.userId ?? ''
}

/** The 409 of an account with no room for `adding` more bots, or null when it has room. */
async function noRoom(c: Context<AppEnv>, adding: number): Promise<Response | null> {
  const room = MAX_BOTS_PER_USER - (await countBots(c.env.DB, userId(c)))
  if (adding <= room) return null
  return errorResponse(
    c,
    'conflict',
    `an account holds ${MAX_BOTS_PER_USER} bots: there is room for ${Math.max(0, room)} more`,
  )
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
 * A bot's source, assembled by the server: its bytes, or why it has none. The assembler holds a
 * bot to its size cap (`size-over-cap`); a hill's own caps apply when the bot is submitted there.
 */
async function assembleSource(source: string) {
  const out = assemble(source)
  const diagnostics = out.diagnostics
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false as const, message: 'it does not assemble', diagnostics }
  }
  if (out.bytes.length === 0) return { ok: false as const, message: 'it has no code', diagnostics }
  return { ok: true as const, out, sha256: await sha256Hex(out.bytes) }
}

type Assembled = Extract<Awaited<ReturnType<typeof assembleSource>>, { ok: true }>
type Refused = Extract<Awaited<ReturnType<typeof assembleSource>>, { ok: false }>

/** The 422 of a source that makes no bot: why, and its first error, so the message stands alone. */
function refused(c: Context<AppEnv>, made: Refused): Response {
  const first = made.diagnostics.find((d) => d.severity === 'error')
  const where = first === undefined ? '' : `: line ${first.line}: ${first.message}`
  return errorResponse(c, 'unprocessable', `${made.message}${where}`)
}

/**
 * Keeps the assembled bytes in R2 (content-addressed, so a put of bytes it has is harmless) and
 * returns the statement that inserts version `version` of bot `botId`.
 */
async function versionInsert(
  c: Context<AppEnv>,
  botId: string,
  version: number,
  source: string,
  made: Assembled,
): Promise<D1PreparedStatement> {
  await c.env.REPLAYS.put(botBytesKey(made.sha256), made.out.bytes)
  return c.env.DB.prepare(
    `INSERT INTO bot_versions (id, bot_id, version, source, bytes_sha256, size, author, strategy, isa)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).bind(
    crypto.randomUUID(),
    botId,
    version,
    source,
    made.sha256,
    made.out.bytes.length,
    made.out.author || null,
    made.out.strategy || null,
    c.env.ISA_VERSION,
  )
}

/** The statement that inserts a new bot of the signed-in user, slugged clear of `slugs`. */
function botInsert(
  c: Context<AppEnv>,
  botId: string,
  bot: NewBot,
  slugs: Set<string>,
): D1PreparedStatement {
  const slug = botSlug(bot.name, slugs)
  slugs.add(slug)
  return c.env.DB.prepare(
    'INSERT INTO bots (id, owner_id, slug, name, visibility) VALUES (?, ?, ?, ?, ?) RETURNING *',
  ).bind(botId, userId(c), slug, bot.name, bot.visibility ?? 'private')
}

/**
 * `POST /api/bots` `{ name, source, visibility? }`: a new bot of the signed-in user at version 1,
 * private unless it says otherwise. 422 when the source does not assemble; 409 when the account
 * holds `MAX_BOTS_PER_USER`.
 */
async function createBot(c: Context<AppEnv>): Promise<Response> {
  const bot = parse(NewBot, await jsonBody(c), 'the request')
  const full = await noRoom(c, 1)
  if (full !== null) return full
  const made = await assembleSource(bot.source)
  if (!made.ok) return refused(c, made)
  const botId = crypto.randomUUID()
  const slugs = await listBotSlugs(c.env.DB, userId(c))
  const [botRows, versionRows] = await c.env.DB.batch([
    botInsert(c, botId, bot, slugs),
    await versionInsert(c, botId, 1, bot.source, made),
    auditInsert(c.env.DB, userId(c), 'bot.create', botId),
  ])
  const saved: SavedBot = {
    bot: toBot(botRows?.results[0] as BotRow),
    version: toBotVersion(versionRows?.results[0] as BotVersionRow, true),
  }
  return c.json(saved, 201)
}

/** `PATCH /api/bots/:id` `{ name?, visibility? }`: the owner renames the bot or shows it. */
async function updateBot(c: Context<AppEnv>): Promise<Response> {
  const bot = await ownBot(c, c.req.param('id') ?? '')
  const { name, visibility } = parse(UpdateBot, await jsonBody(c), 'the request')
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE bots SET name = COALESCE(?, name), visibility = COALESCE(?, visibility),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? RETURNING *`,
    ).bind(name ?? null, visibility ?? null, bot.id),
    auditInsert(c.env.DB, userId(c), 'bot.update', bot.id),
  ])
  const row = (updated?.results[0] as BotRow | undefined) ?? null
  if (row === null) throw new HTTPException(404, { message: `no bot ${bot.id}` })
  return c.json({ bot: toBot(row) } satisfies UpdatedBot)
}

/**
 * `POST /api/bots/:id/versions` `{ source }`: the owner's next version of the bot. A source that
 * assembles to the latest version's bytes makes none: 200 with that version, not `created`. 422
 * when it does not assemble; 409 at `MAX_VERSIONS_PER_BOT`, or when another save took the number.
 */
async function addVersion(c: Context<AppEnv>): Promise<Response> {
  const bot = await ownBot(c, c.req.param('id') ?? '')
  const { source } = parse(NewBotVersion, await jsonBody(c), 'the request')
  const made = await assembleSource(source)
  if (!made.ok) return refused(c, made)
  const latest = await getLatestBotVersionRow(c.env.DB, bot.id)
  if (latest !== null && latest.bytes_sha256 === made.sha256) {
    const same: SavedBotVersion = { bot, version: toBotVersion(latest, true), created: false }
    return c.json(same)
  }
  const next = (latest?.version ?? 0) + 1
  if (next > MAX_VERSIONS_PER_BOT) {
    return errorResponse(c, 'conflict', `a bot holds ${MAX_VERSIONS_PER_BOT} versions`)
  }
  let rows: D1Result[]
  try {
    rows = await c.env.DB.batch([
      await versionInsert(c, bot.id, next, source, made),
      c.env.DB.prepare(
        `UPDATE bots SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
         RETURNING *`,
      ).bind(bot.id),
      auditInsert(c.env.DB, userId(c), 'bot.version', `${bot.id}/v${next}`),
    ])
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: bot_versions/.test(err.message)) {
      return errorResponse(c, 'conflict', `another save made version ${next} first: save again`)
    }
    throw err
  }
  const saved: SavedBotVersion = {
    bot: toBot(rows[1]?.results[0] as BotRow),
    version: toBotVersion(rows[0]?.results[0] as BotVersionRow, true),
    created: true,
  }
  return c.json(saved, 201)
}

/**
 * `DELETE /api/bots/:id`: the owner deletes the bot. Soft: its versions stay, so the hills and
 * matches they played keep their history, but the bot is no one's to read or change. 204.
 */
async function deleteBot(c: Context<AppEnv>): Promise<Response> {
  const bot = await ownBot(c, c.req.param('id') ?? '')
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE bots SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ).bind(bot.id),
    auditInsert(c.env.DB, userId(c), 'bot.delete', bot.id),
  ])
  return c.body(null, 204)
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
  const full = await noRoom(c, bots.length)
  if (full !== null) return full
  const slugs = await listBotSlugs(c.env.DB, userId(c))
  const results: (ImportedBot | null)[] = []
  const statements: D1PreparedStatement[] = []
  // After the bots, so each bot's two rows stay a pair in the batch's results.
  const audits: D1PreparedStatement[] = []
  for (const bot of bots) {
    const made = await assembleSource(bot.source)
    if (!made.ok) {
      results.push(made)
      continue
    }
    const botId = crypto.randomUUID()
    statements.push(
      botInsert(c, botId, bot, slugs),
      await versionInsert(c, botId, 1, bot.source, made),
    )
    audits.push(auditInsert(c.env.DB, userId(c), 'bot.create', botId))
    // Filled in from the batch below.
    results.push(null)
  }
  const made = statements.length === 0 ? [] : await c.env.DB.batch([...statements, ...audits])
  let next = 0
  const filled = results.map((result): ImportedBot => {
    if (result !== null) return result
    const botRow = made[next++]?.results[0] as BotRow
    const versionRow = made[next++]?.results[0] as BotVersionRow
    return { ok: true, bot: toBot(botRow), version: toBotVersion(versionRow, true) }
  })
  return c.json({ results: filled } satisfies ImportBotsResult, 201)
}

/** The most a request that carries one source may be: `MAX_SOURCE_TEXT` UTF-16 units as UTF-8. */
const ONE_SOURCE_BODY = 256 * 1024

/**
 * The write routes above, and the reads. `GET /api/bots/:id`: the bot, its owner, its versions (no
 * sources), and its hill places. `GET /api/bots/:id/versions/:v`: one version, with its source
 * when the bot is public or the reader owns it. An unlisted bot shows to anyone with its link, but
 * not its source. A private or deleted bot is a 404, to its owner too once it is deleted.
 */
export const bots = new Hono<AppEnv>()
  .post('/', requireUser, limitBody(ONE_SOURCE_BODY), createBot)
  .post('/import', requireUser, limitBody(1024 * 1024), importBots)
  .patch('/:id', requireUser, limitBody(1024), updateBot)
  .post('/:id/versions', requireUser, limitBody(ONE_SOURCE_BODY), addVersion)
  .delete('/:id', requireUser, deleteBot)
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
