import { parse, parseReplay, ReplayUpload, replayKey, type StoredReplay } from '@asmbots/protocol'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jsonBody, limitBody } from '../body'
import type { AppEnv } from '../env'
import { finalOwners, replayCard } from '../og/replay'
import { CARD_TTL, type CardFormat, cardHost, sendCard } from '../og/send'
import { keyParam } from '../params'
import { getReplay, IMMUTABLE, ogCacheKey, replayObjectKey } from '../storage'
import { checkResult, checkWork, verifyReplay } from '../verify'

/**
 * The share card of the path's replay (`og/replay.ts`), as SVG, from KV for a day: drawing it runs
 * the last round again. 404 for a replay the server does not have.
 */
async function replaySvg(c: Context<AppEnv>): Promise<string> {
  const key = keyParam(c.req.param('key') ?? '', 'the replay key')
  const kept = await c.env.KV.get(ogCacheKey(key))
  if (kept !== null) return kept
  const replay = await getReplay(c.env.REPLAYS, key)
  if (replay === null) throw new HTTPException(404, { message: `no replay ${key}` })
  const svg = replayCard(replay, finalOwners(replay), cardHost(c.env))
  await c.env.KV.put(ogCacheKey(key), svg, { expirationTtl: CARD_TTL })
  return svg
}

/** The replay's card in `format`: a replay never changes, so clients keep it a day. */
const card = (format: CardFormat) => async (c: Context<AppEnv>) =>
  sendCard(c, await replaySvg(c), format, CARD_TTL)

/**
 * `GET /api/replays/:key`: the protocol `Replay` stored under its `replayKey`, as stored (the
 * write checked it). The key names its content, so the response never changes: a year's cache.
 * `POST /api/replays` `{ replay }`: checks the replay by running its match again (at most 16
 * bots, 10 rounds, and 200,000 cycles a round, else 413; a result that differs is a 422), stores
 * it, and answers `{ key, url }`: 201 when new, 200 when the server had it.
 * `GET /api/replays/:key/og.svg` and `og.png`: the replay's share card (`og/replay.ts`), its link
 * previews' image; KV keeps it a day.
 */
export const replays = new Hono<AppEnv>()
  .get('/:key', async (c) => {
    const key = keyParam(c.req.param('key'), 'the replay key')
    const object = await c.env.REPLAYS.get(replayObjectKey(key))
    if (object === null) throw new HTTPException(404, { message: `no replay ${key}` })
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': IMMUTABLE,
        ETag: `"${key}"`,
      },
    })
  })
  .post('/', limitBody(2 * 1024 * 1024), async (c) => {
    const upload = parse(ReplayUpload, await jsonBody(c), 'the request')
    checkWork(upload.replay)
    const replay = parseReplay(upload.replay)
    const key = await replayKey(replay)
    const answer = { key, url: new URL(`/arena/${key}`, c.req.url).href } satisfies StoredReplay
    // Content-addressed: what is stored under the key was checked, so a match with it is enough.
    const kept = await getReplay(c.env.REPLAYS, key)
    if (kept !== null) {
      checkResult(kept.result, replay.result)
      return c.json(answer, 200)
    }
    await verifyReplay(replay)
    await c.env.REPLAYS.put(replayObjectKey(key), JSON.stringify(replay), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    })
    return c.json(answer, 201)
  })
  .get('/:key/og.svg', card('svg'))
  .get('/:key/og.png', card('png'))
