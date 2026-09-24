/**
 * Share links (ARCHITECTURE §6, PRODUCT_SPEC §10): the arena's state in a URL. The query names
 * the bots and the config; the fragment carries what a server does not have, so a link works in
 * a browser that has never seen its bots:
 *
 *     /arena?b=roster:dwarf,local:3f2a&seed=42&cycles=100000&rounds=3&procs=64&spacing=1024#src=…
 *     /arena/<match key>#r=…
 *
 * `src=` is the base64url of the deflated JSON `[[id, source], …]` of the local bots the query
 * names. `r=` is the base64url of a replay's JSON, its bots' bytes inline and their sources left
 * out. A fragment never reaches a server, so neither costs a request its size.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import * as z from 'zod/mini'
import { fromBase64Url, toBase64Url } from './bytes'
import { MAX_REPLAY_BOTS, parseReplay, Replay, Seed, withoutSources } from './replay'
import { matching, ProtocolError, whole } from './schema'

/** A slug or an id as a link may carry it. */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/

/** A bot a link names: `roster:<slug>`, a roster bot; `local:<id>`, a bot of the browser. */
export const BotRef = matching(/^(?:roster|local):[A-Za-z0-9_-]{1,64}$/)

/** A local bot's source, as a link carries it. */
export const SharedSource = z.object({ id: matching(TOKEN), source: z.string() })
export type SharedSource = z.output<typeof SharedSource>

/**
 * An arena link. The counts are the query's; each one left out takes the arena's `duel` value,
 * and no `seed` means a random seed each battle. `sources` are the fragment's `src=`; `replay`
 * makes it a replay link, `/arena/<match key>#r=`, which has no query.
 */
export const ShareLink = z.object({
  bots: z.array(BotRef).check(z.maxLength(MAX_REPLAY_BOTS)),
  seed: z.optional(Seed),
  cycles: z.optional(whole('cycles', 0, Number.MAX_SAFE_INTEGER)),
  rounds: z.optional(whole('rounds', 0, Number.MAX_SAFE_INTEGER)),
  procs: z.optional(whole('procs', 0, Number.MAX_SAFE_INTEGER)),
  spacing: z.optional(whole('spacing', 0, Number.MAX_SAFE_INTEGER)),
  sources: z.optional(z.array(SharedSource).check(z.maxLength(MAX_REPLAY_BOTS))),
  replay: z.optional(Replay),
})
export type ShareLink = z.output<typeof ShareLink>

/** The query fields of a link, in the order a link writes them. */
const COUNTS = ['seed', 'cycles', 'rounds', 'procs', 'spacing'] as const

/** The fragment key of the local bots' sources. */
export const SOURCES_KEY = 'src'
/** The fragment key of a replay. */
export const REPLAY_KEY = 'r'

/** The most source text a link may unpack to: 16 bots of 16 KB. */
export const MAX_SHARED_TEXT = MAX_REPLAY_BOTS * 16 * 1024
/** The longest replay fragment read: 16 bots at 512 B with their sources fit many times. */
export const MAX_REPLAY_FRAGMENT = 1 << 20

/** The fragment that carries `sources`, `src=…`; empty for none. */
export function encodeSources(sources: readonly SharedSource[]): string {
  if (sources.length === 0) return ''
  const json = JSON.stringify(sources.map(({ id, source }) => [id, source]))
  return `${SOURCES_KEY}=${toBase64Url(deflateSync(strToU8(json), { level: 9 }))}`
}

/**
 * The sources a fragment carries (`#src=…`, the `#` optional): none when it has no `src`, or one
 * that does not decode, or one that unpacks past `MAX_SHARED_TEXT` (a deflate bomb stops there).
 * An entry that is not an id and a source is left out.
 */
export function decodeSources(fragment: string): SharedSource[] {
  const payload = new URLSearchParams(fragment.replace(/^#/, '')).get(SOURCES_KEY)
  if (payload === null || payload === '') return []
  const sources: SharedSource[] = []
  try {
    // A fixed buffer: inflate never grows it, and output that fills it is too big.
    const out = inflateSync(fromBase64Url(payload), { out: new Uint8Array(MAX_SHARED_TEXT) })
    if (out.length >= MAX_SHARED_TEXT) return []
    const list: unknown = JSON.parse(strFromU8(out))
    if (!Array.isArray(list)) return []
    for (const entry of list.slice(0, MAX_REPLAY_BOTS)) {
      if (!Array.isArray(entry)) continue
      const [id, source] = entry as unknown[]
      if (typeof id === 'string' && TOKEN.test(id) && typeof source === 'string') {
        sources.push({ id, source })
      }
    }
  } catch {
    // Not base64url, not deflate, or not JSON: a link cut short. It carries nothing.
  }
  return sources
}

/** The fragment of a replay link: `r=` and the base64url of `replay`'s JSON, sources left out. */
export function encodeReplayFragment(replay: Replay): string {
  const json = JSON.stringify(withoutSources(replay))
  return `${REPLAY_KEY}=${toBase64Url(new TextEncoder().encode(json))}`
}

/**
 * The JSON a replay fragment carries (`#r=…`, the `#` optional), not yet read as a replay; null
 * when it has no `r`. A `ProtocolError` when it is too long or does not decode.
 */
export function decodeReplayFragment(fragment: string): unknown {
  const payload = new URLSearchParams(fragment.replace(/^#/, '')).get(REPLAY_KEY)
  if (payload === null || payload === '') return null
  if (payload.length > MAX_REPLAY_FRAGMENT) {
    throw new ProtocolError('it is longer than any replay link')
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)))
  } catch {
    throw new ProtocolError('it does not decode, so the link may be cut short')
  }
}

/**
 * `link` as a path, query, and fragment, to put after an origin: `/arena?b=…#src=…`, or a replay
 * link, `/arena/<match key>#r=…`. The query keeps `:` and `,` as they are, so it reads.
 */
export function encodeShare(link: ShareLink): string {
  if (link.replay !== undefined) {
    return `/arena/${link.replay.result.key}#${encodeReplayFragment(link.replay)}`
  }
  const query = new URLSearchParams()
  if (link.bots.length > 0) query.set('b', link.bots.join(','))
  for (const key of COUNTS) {
    const value = link[key]
    if (value !== undefined) query.set(key, String(value))
  }
  const text = query.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',')
  const fragment = encodeSources(link.sources ?? [])
  return `/arena${text === '' ? '' : `?${text}`}${fragment === '' ? '' : `#${fragment}`}`
}

/**
 * The link `href` holds: an absolute URL, or a path as `encodeShare` makes one. A bot ref or a
 * count that does not parse is left out, as the arena leaves it out; a replay fragment that does
 * not read is a `ProtocolError`.
 */
export function decodeShare(href: string): ShareLink {
  const url = new URL(href, 'https://asmbots.invalid')
  const link: { -readonly [K in keyof ShareLink]: ShareLink[K] } = { bots: [] }
  const replay = decodeReplayFragment(url.hash)
  if (replay !== null) {
    link.replay = parseReplay(replay)
    return link
  }
  const b = url.searchParams.get('b')
  if (b !== null) {
    link.bots = b
      .split(',')
      .map((ref) => ref.trim())
      .filter((ref) => BotRef.safeParse(ref).success)
      .slice(0, MAX_REPLAY_BOTS)
  }
  for (const key of COUNTS) {
    const text = url.searchParams.get(key)
    if (text === null || !/^\d{1,16}$/.test(text)) continue
    const n = Number(text)
    if (key === 'seed' ? Seed.safeParse(n).success : Number.isSafeInteger(n)) link[key] = n
  }
  const sources = decodeSources(url.hash)
  if (sources.length > 0) link.sources = sources
  return link
}
