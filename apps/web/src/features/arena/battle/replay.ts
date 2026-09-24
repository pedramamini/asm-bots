/**
 * Replays (PRODUCT_SPEC §2, §10): a match the arena played, as what it takes to run it again and
 * what came out, so anyone can run it and check the result hashes (ISA §5.6). `download replay`
 * saves one as a `.asmreplay.json` file; `replay link` puts one in a link to `/arena/$replayId`,
 * whose page runs it and checks it:
 *
 *     /arena/<match key>#r=<base64url of the replay's JSON>
 *
 * TODO(EXEC 3.1): this is a local schema, `asmbots-replay-local/1`, until `@asmbots/protocol`
 * defines `Replay`. Then write that one, and keep reading this one.
 */
import {
  type BattleConfig,
  type BattleConfigInput,
  type BotMeta,
  DEFAULT_CONFIG,
} from '@asmbots/engine'
import type { MatchResult, MatchRound } from '@asmbots/tourney'
import { CYCLES, MAX_ARENA_BOTS, MIN_ARENA_BOTS, PROCS, ROUNDS } from '../setup/config'
import { fromBase64Url, toBase64Url } from '../setup/url'
import type { ArenaBot } from '../worker/protocol'

/** The schema's name and version. */
export const REPLAY_FORMAT = 'asmbots-replay-local/1'
/** The instruction set the bots are written in. */
export const REPLAY_ISA = 'x16c-v1'

/** A bot of a replay. */
export interface ReplayBot {
  /** Its name in the battle: `Dwarf`, `Dwarf 2`. */
  readonly name: string
  /** Its machine code, base64. */
  readonly bytes: string
  /** SHA-256 of its machine code, lowercase hex. */
  readonly sha256: string
  readonly meta?: BotMeta | undefined
  /** Its source, when the arena had it. A replay link leaves it out. */
  readonly source?: string | undefined
}

/** A match that the arena played, as a file. */
export interface LocalReplay {
  readonly format: typeof REPLAY_FORMAT
  readonly isa: typeof REPLAY_ISA
  /** When the file was made, ISO 8601. */
  readonly createdAt: string
  /** The match's config over the engine defaults: round i is placed with `seed + i`. */
  readonly config: BattleConfig
  readonly rounds: number
  /** In the order they were loaded: round i fights them rotated by i (ISA §5.5). */
  readonly bots: readonly ReplayBot[]
  /** What the arena's rounds came to: each round's seed, order, result hash, and points. */
  readonly match: MatchResult
}

/** Standard base64 of `bytes`. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The bytes of standard base64 text. */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** SHA-256 of `bytes`, lowercase hex. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The replay of `match`: `bots` loaded with `config` (its seed the match's), and each bot's
 * source where `sources` has it (an empty string where it does not).
 */
export async function buildReplay(
  bots: readonly ArenaBot[],
  sources: readonly string[],
  config: BattleConfigInput,
  rounds: number,
  match: MatchResult,
  now: Date = new Date(),
): Promise<LocalReplay> {
  const resolved = { ...DEFAULT_CONFIG }
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) resolved[key as keyof BattleConfig] = value
  }
  return {
    format: REPLAY_FORMAT,
    isa: REPLAY_ISA,
    createdAt: now.toISOString(),
    config: resolved,
    rounds,
    bots: await Promise.all(
      bots.map(async (bot, i) => ({
        name: bot.name,
        bytes: base64(bot.bytes),
        sha256: await sha256(bot.bytes),
        ...(bot.meta !== undefined && { meta: bot.meta }),
        ...(sources[i] ? { source: sources[i] } : {}),
      })),
    ),
    match,
  }
}

/** The bots of `replay` as the Worker loads them. */
export function replayBots(replay: LocalReplay): ArenaBot[] {
  return replay.bots.map(({ name, bytes, meta }) => ({
    name,
    bytes: fromBase64(bytes),
    ...(meta !== undefined && { meta }),
  }))
}

/**
 * Why `replay`'s bytes are not what it says they are: the first bot whose bytes do not hash to
 * its `sha256`. Null when every bot's do.
 */
export async function bytesProblem(replay: LocalReplay): Promise<string | null> {
  for (const bot of replay.bots) {
    if ((await sha256(fromBase64(bot.bytes))) !== bot.sha256) {
      return `${bot.name}'s bytes do not match their SHA-256`
    }
  }
  return null
}

/** The fragment key of a replay link. */
export const REPLAY_KEY = 'r'

/** The longest replay link fragment read: 16 bots at 512 B with their sources fit many times. */
const MAX_REPLAY_LINK = 1 << 20

/** `replay` as a link carries it: the sources left out, so the link stays short. */
export function linkReplay(replay: LocalReplay): LocalReplay {
  return { ...replay, bots: replay.bots.map(({ source: _, ...bot }) => bot) }
}

/** The fragment of a replay link: `r=` and the base64url of `replay`'s JSON, sources left out. */
export function replayFragment(replay: LocalReplay): string {
  const json = JSON.stringify(linkReplay(replay))
  return `${REPLAY_KEY}=${toBase64Url(new TextEncoder().encode(json))}`
}

/** The link of `replay`: its page, named by its match key, and the replay in the fragment. */
export function replayUrl(origin: string, replay: LocalReplay): string {
  return `${origin}/arena/${replay.match.key}#${replayFragment(replay)}`
}

/** What a replay link's fragment holds. */
export type ReplayRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'ok'; readonly replay: LocalReplay; readonly bots: readonly ArenaBot[] }

/**
 * The replay of a link's fragment (`#r=…`, the `#` optional): none when it has no `r`; broken,
 * and why, when it does not decode or is not a replay the arena can run.
 */
export function readReplayFragment(fragment: string): ReplayRead {
  const payload = new URLSearchParams(fragment.replace(/^#/, '')).get(REPLAY_KEY)
  if (payload === null || payload === '') return { kind: 'none' }
  try {
    if (payload.length > MAX_REPLAY_LINK) fail('it is longer than any replay link')
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)))
    } catch {
      fail('it does not decode, so the link may be cut short')
    }
    const replay = parseReplay(json)
    return { kind: 'ok', replay, bots: replayBots(replay) }
  } catch (error) {
    if (error instanceof ReplayError) return { kind: 'broken', reason: error.message }
    throw error
  }
}

/** Why a replay does not load: its message says what is wrong, lowercase. */
export class ReplayError extends Error {
  override readonly name = 'ReplayError'
}

function fail(reason: string): never {
  throw new ReplayError(reason)
}

type Fields = Readonly<Record<string, unknown>>

function fields(value: unknown, what: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${what} is missing`)
  return value as Fields
}

function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} is missing`)
  return value
}

/** `value` as an integer in `min..max`. */
function integer(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(
      `${what} must be a whole number in ${min.toLocaleString('en-US')}..${max.toLocaleString('en-US')}`,
    )
  }
  return value
}

function text(value: unknown, what: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern !== undefined && !pattern.test(value))) {
    fail(`${what} is not well formed`)
  }
  return value
}

/** `n` integers in `min..max`. */
function integers(value: unknown, what: string, n: number | null, min = 0, max = UINT32): number[] {
  const items = list(value, what)
  if (n !== null && items.length !== n) fail(`${what} must have ${n} entries`)
  return items.map((item) => integer(item, what, min, max))
}

const botCount = (n: number) => `${n} ${n === 1 ? 'bot' : 'bots'}`

const UINT32 = 0xffff_ffff
const HASH = /^[0-9a-f]{16}$/
const SHA256 = /^[0-9a-f]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
/** A name in the battle: what the arena shows, one line. */
const NAME = /^[^\n\r]{1,64}$/

/**
 * `value` as a replay the arena can run, or a `ReplayError` that says what is wrong. The engine
 * checks the config's values when the battle is made; this holds the counts to what the arena
 * runs (PRODUCT_SPEC §2: 16 bots, 10 rounds, 1M cycles, 256 processes a bot), so a link cannot
 * ask a browser for more.
 */
export function parseReplay(value: unknown): LocalReplay {
  const r = fields(value, 'the replay')
  if (r.format !== REPLAY_FORMAT) fail(`it is not a replay of format ${REPLAY_FORMAT}`)
  if (r.isa !== REPLAY_ISA) fail(`its bots are written for ${String(r.isa)}, not ${REPLAY_ISA}`)
  const createdAt = text(r.createdAt, 'its date')
  const config = parseConfig(r.config)
  const rounds = integer(r.rounds, 'rounds', ROUNDS.min, ROUNDS.max)
  const bots = list(r.bots, 'the bots').map(parseBot)
  if (bots.length < MIN_ARENA_BOTS || bots.length > MAX_ARENA_BOTS) {
    fail(`it has ${botCount(bots.length)}, and a battle has ${MIN_ARENA_BOTS} to ${MAX_ARENA_BOTS}`)
  }
  const match = parseMatch(r.match, bots.length, rounds)
  return { format: REPLAY_FORMAT, isa: REPLAY_ISA, createdAt, config, rounds, bots, match }
}

function parseConfig(value: unknown): BattleConfig {
  const c = fields(value, 'the config')
  return {
    coreSize: integer(c.coreSize, 'coreSize', 1, UINT32),
    maxCycles: integer(c.maxCycles, 'maxCycles', 1, CYCLES.max),
    maxProcesses: integer(c.maxProcesses, 'maxProcesses', 1, PROCS.max),
    minSpacing: integer(c.minSpacing, 'minSpacing', 0, UINT32),
    maxBotBytes: integer(c.maxBotBytes, 'maxBotBytes', 1, UINT32),
    seed: integer(c.seed, 'the seed', 0, UINT32),
  }
}

function parseBot(value: unknown, i: number): ReplayBot {
  const what = `bot ${i + 1}`
  const b = fields(value, what)
  const name = text(b.name, `${what}'s name`, NAME)
  const bytes = text(b.bytes, `${name}'s bytes`, BASE64)
  if (bytes === '') fail(`${name} has no bytes`)
  const bot: ReplayBot = { name, bytes, sha256: text(b.sha256, `${name}'s SHA-256`, SHA256) }
  const meta = b.meta === undefined ? undefined : parseMeta(b.meta, name)
  const source = b.source === undefined ? undefined : text(b.source, `${name}'s source`)
  return {
    ...bot,
    ...(meta !== undefined && { meta }),
    ...(source !== undefined && { source }),
  }
}

function parseMeta(value: unknown, name: string): BotMeta {
  const m = fields(value, `${name}'s metadata`)
  const meta: { -readonly [K in keyof BotMeta]: BotMeta[K] } = {}
  for (const key of ['author', 'strategy', 'version'] as const) {
    if (m[key] !== undefined) meta[key] = text(m[key], `${name}'s ${key}`)
  }
  return meta
}

/** The recorded match: `n` entrants and every one of its `rounds` rounds. */
function parseMatch(value: unknown, n: number, rounds: number): MatchResult {
  const m = fields(value, 'the recorded match')
  const key = text(m.key, 'the match key', HASH)
  const names = list(m.names, 'the match names').map((name) => text(name, 'a match name', NAME))
  if (names.length !== n) fail(`the match names ${botCount(names.length)}, not ${n}`)
  if (m.of !== rounds) fail(`the match has ${String(m.of)} rounds, not ${rounds}`)
  const played = list(m.rounds, 'the rounds')
  if (played.length !== rounds) fail(`it records ${played.length} of its ${rounds} rounds`)
  return {
    key,
    names,
    of: rounds,
    rounds: played.map((round, i) => parseRound(round, i, n)),
    points: integers(m.points, 'the match points', n),
  }
}

function parseRound(value: unknown, i: number, n: number): MatchRound {
  const what = `round ${i + 1}`
  const r = fields(value, what)
  if (r.round !== i) fail(`${what} is out of order`)
  const order = integers(r.order, `${what}'s order`, n, 0, n - 1)
  if (new Set(order).size !== n) fail(`${what}'s order repeats a bot`)
  return {
    round: i,
    seed: integer(r.seed, `${what}'s seed`, 0, UINT32),
    order,
    resultHash: text(r.resultHash, `${what}'s result hash`, HASH),
    durationCycles: integer(r.durationCycles, `${what}'s cycles`, 0, UINT32),
    points: integers(r.points, `${what}'s points`, n),
    survivors: integers(r.survivors, `${what}'s survivors`, null, 0, n - 1),
    survival: integers(r.survival, `${what}'s survival`, n),
  }
}
