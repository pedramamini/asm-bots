/**
 * The arena setup in the URL (ARCHITECTURE §6: the URL is the source of truth for shareable
 * state). The query names the bots and the config:
 *
 *     /arena?b=roster:dwarf,local:3f2a…&seed=42&cycles=100000&rounds=3&procs=64&spacing=1024
 *
 * A roster bot is `roster:<slug>`; a bot of this browser is `local:<id>`, its id in the local bot
 * store. No `seed` means a random seed each battle; any other field left out takes its `duel`
 * value. A share link also carries the sources of its local bots in the fragment, `#src=` and the
 * base64url of their deflated JSON, so they load in a browser that does not have them
 * (PRODUCT_SPEC §10).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { ArenaConfig } from '../../../store/settings'
import { DEFAULT_ARENA_CONFIG, MAX_ARENA_BOTS, sanitizeConfig } from './config'
import type { ArenaSearch } from './search'

/** A bot of the setup: a roster bot by slug, or a local bot by id. */
export type BotRef =
  | { readonly kind: 'roster'; readonly slug: string }
  | { readonly kind: 'local'; readonly id: string }

/** A slug or an id as the URL may carry it. */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/

/** `roster:dwarf` or `local:<id>` as a ref; null for anything else. */
export function parseRef(text: string): BotRef | null {
  const colon = text.indexOf(':')
  const kind = text.slice(0, colon)
  const key = text.slice(colon + 1)
  if (colon < 0 || !TOKEN.test(key)) return null
  if (kind === 'roster') return { kind, slug: key }
  if (kind === 'local') return { kind, id: key }
  return null
}

export function formatRef(ref: BotRef): string {
  return ref.kind === 'roster' ? `roster:${ref.slug}` : `local:${ref.id}`
}

/** The refs of a `b` list, in order: the first `MAX_ARENA_BOTS` that parse. */
export function parseRefs(list: string): BotRef[] {
  const refs: BotRef[] = []
  for (const text of list.split(',')) {
    const ref = parseRef(text.trim())
    if (ref !== null && refs.length < MAX_ARENA_BOTS) refs.push(ref)
  }
  return refs
}

/** The setup the URL holds: the bots in order, and the config. */
export interface ArenaSetupSpec {
  readonly bots: readonly BotRef[]
  readonly config: ArenaConfig
}

/**
 * The setup of `search`: the refs that parse, and each count held to its limits. A query with no
 * field at all is a fresh visit: it starts from `fallback` (the config last fought with).
 * Otherwise a field left out takes its `duel` value, so a link means the same battle in every
 * browser. A seed past uint32 is no seed: random.
 */
export function setupFromSearch(
  search: ArenaSearch,
  fallback: ArenaConfig = DEFAULT_ARENA_CONFIG,
): ArenaSetupSpec {
  const bots = search.b === undefined ? [] : parseRefs(search.b)
  if (isBare(search)) return { bots, config: sanitizeConfig(fallback) }
  const config = sanitizeConfig({
    ...DEFAULT_ARENA_CONFIG,
    seed: search.seed ?? null,
    ...(search.cycles !== undefined && { maxCycles: search.cycles }),
    ...(search.rounds !== undefined && { rounds: search.rounds }),
    ...(search.procs !== undefined && { maxProcesses: search.procs }),
    ...(search.spacing !== undefined && { minSpacing: search.spacing }),
  })
  return { bots, config }
}

/** The query of `setup`: the bots, then every config field, so the link keeps its meaning. */
export function searchFromSetup({ bots, config }: ArenaSetupSpec): ArenaSearch {
  return {
    ...(bots.length > 0 && { b: bots.map(formatRef).join(',') }),
    ...(config.seed !== null && { seed: config.seed }),
    cycles: config.maxCycles,
    rounds: config.rounds,
    procs: config.maxProcesses,
    spacing: config.minSpacing,
  }
}

/** Whether `search` has no field: `/arena` as the nav links to it. */
export function isBare(search: ArenaSearch): boolean {
  return Object.values(search).every((value) => value === undefined)
}

/** A local bot as a share link carries it. */
export interface SharedBot {
  readonly id: string
  readonly source: string
}

/** The fragment key of the local bots a share link carries. */
export const SHARE_KEY = 'src'

/** The most source text a share link may unpack to: 16 bots of 16 KB. */
const MAX_SHARED_TEXT = MAX_ARENA_BOTS * 16 * 1024

/** The fragment that carries `bots`, `src=…`; empty for none. */
export function sharedFragment(bots: readonly SharedBot[]): string {
  if (bots.length === 0) return ''
  const json = JSON.stringify(bots.map(({ id, source }) => [id, source]))
  return `${SHARE_KEY}=${toBase64Url(deflateSync(strToU8(json), { level: 9 }))}`
}

/**
 * The bots a fragment carries, by id: none when it has no `src`, or one that does not decode, or
 * one that unpacks past `MAX_SHARED_TEXT` (a deflate bomb stops there).
 */
export function sharedBots(fragment: string): ReadonlyMap<string, string> {
  const shared = new Map<string, string>()
  const payload = new URLSearchParams(fragment.replace(/^#/, '')).get(SHARE_KEY)
  if (payload === null || payload === '') return shared
  try {
    // A fixed buffer: inflate never grows it, and output that fills it is too big.
    const out = inflateSync(fromBase64Url(payload), { out: new Uint8Array(MAX_SHARED_TEXT) })
    if (out.length >= MAX_SHARED_TEXT) return shared
    const list: unknown = JSON.parse(strFromU8(out))
    if (!Array.isArray(list)) return shared
    for (const entry of list.slice(0, MAX_ARENA_BOTS)) {
      if (!Array.isArray(entry)) continue
      const [id, source] = entry as unknown[]
      if (typeof id === 'string' && TOKEN.test(id) && typeof source === 'string') {
        shared.set(id, source)
      }
    }
  } catch {
    // Not base64url, not deflate, or not JSON: a link cut short. It carries nothing.
  }
  return shared
}

/** A share link: the setup's query, and the fragment of the local bots it names. */
export function shareUrl(origin: string, spec: ArenaSetupSpec, bots: readonly SharedBot[]): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchFromSetup(spec))) {
    if (value !== undefined) query.set(key, String(value))
  }
  const text = query.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',')
  const fragment = sharedFragment(bots)
  return `${origin}/arena${text === '' ? '' : `?${text}`}${fragment === '' ? '' : `#${fragment}`}`
}

/** Base64url without padding (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // In slices: String.fromCharCode takes its bytes as arguments, and those have a limit.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The bytes of base64url text, padded or not. Throws on a character outside the alphabet. */
export function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
