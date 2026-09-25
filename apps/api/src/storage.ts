/**
 * Where R2 keeps what the API stores: content-addressed, so an object never changes. And the KV
 * keys of what the API caches.
 */
import { parseReplay, type Replay, replayKey } from '@asmbots/protocol'

/** A replay, by its `replayKey`. */
export function replayObjectKey(key: string): string {
  return `replays/${key}.json`
}

/** The replay stored under `key`, or null. */
export async function getReplay(bucket: R2Bucket, key: string): Promise<Replay | null> {
  const object = await bucket.get(replayObjectKey(key))
  return object === null ? null : parseReplay(await object.json())
}

/**
 * Stores `replay` of a match the server ran itself, unless the bucket has its key already: the
 * key names the inputs, so what is there is the same match. Returns the key.
 */
export async function putReplay(bucket: R2Bucket, replay: Replay): Promise<string> {
  const key = await replayKey(replay)
  const objectKey = replayObjectKey(key)
  if ((await bucket.head(objectKey)) === null) {
    await bucket.put(objectKey, JSON.stringify(replay), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    })
  }
  return key
}

/** A bot version's machine code, by its SHA-256. */
export function botBytesKey(sha256: string): string {
  return `bots/${sha256}.bin`
}

/** A replay's share card, as SVG, in KV, by the replay's key. */
export function ogCacheKey(key: string): string {
  return `og:${key}`
}

/** A share card's PNG, in KV, by the SHA-256 of its SVG. */
export function pngCacheKey(svgSha256: string): string {
  return `og:png:${svgSha256}`
}

/** What a response for an object that never changes may be cached as. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
