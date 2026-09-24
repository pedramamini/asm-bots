/**
 * Where R2 keeps what the API stores: content-addressed, so an object never changes. And the KV
 * keys of what the API caches.
 */

/** A replay, by its `replayKey`. */
export function replayObjectKey(key: string): string {
  return `replays/${key}.json`
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
