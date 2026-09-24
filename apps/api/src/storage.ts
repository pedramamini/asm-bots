/**
 * Where R2 keeps what the API stores: content-addressed, so an object never changes. And the KV
 * keys of what the API caches.
 */
import { type Replay, replayKey } from '@asmbots/protocol'

/** A replay, by its `replayKey`. */
export function replayObjectKey(key: string): string {
  return `replays/${key}.json`
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

/** A replay's OG image, in KV, by the replay's key. */
export function ogCacheKey(key: string): string {
  return `og:${key}`
}

/** What a response for an object that never changes may be cached as. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
