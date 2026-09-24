import {
  parse,
  parseReplay,
  type Replay,
  ReplayUpload,
  replayKey,
  type StoredReplay,
} from '@asmbots/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jsonBody, limitBody } from '../body'
import type { AppEnv, Env } from '../env'
import { finalOwners, ogSvg } from '../og'
import { keyParam } from '../params'
import { IMMUTABLE, ogCacheKey, replayObjectKey } from '../storage'
import { checkResult, checkWork, verifyReplay } from '../verify'

/** How long an OG image stays cached, in KV and in the response, seconds: a day. */
export const OG_TTL = 24 * 60 * 60

/** The replay stored under `key`, or null. */
async function storedReplay(env: Env, key: string): Promise<Replay | null> {
  const object = await env.REPLAYS.get(replayObjectKey(key))
  return object === null ? null : parseReplay(await object.json())
}

/**
 * `GET /api/replays/:key`: the protocol `Replay` stored under its `replayKey`, as stored (the
 * write checked it). The key names its content, so the response never changes: a year's cache.
 * `POST /api/replays` `{ replay }`: checks the replay by running its match again (at most 16
 * bots, 10 rounds, and 200,000 cycles a round, else 413; a result that differs is a 422), stores
 * it, and answers `{ key, url }`: 201 when new, 200 when the server had it.
 * `GET /api/replays/:key/og.svg`: the replay's Open Graph image (`og.ts`), cached a day in KV.
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
    const kept = await storedReplay(c.env, key)
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
  .get('/:key/og.svg', async (c) => {
    const key = keyParam(c.req.param('key'), 'the replay key')
    let svg = await c.env.KV.get(ogCacheKey(key))
    if (svg === null) {
      const replay = await storedReplay(c.env, key)
      if (replay === null) throw new HTTPException(404, { message: `no replay ${key}` })
      svg = ogSvg(replay, finalOwners(replay))
      await c.env.KV.put(ogCacheKey(key), svg, { expirationTtl: OG_TTL })
    }
    return c.body(svg, 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${OG_TTL}`,
      // An SVG opened as a page runs no script and loads nothing.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    })
  })
