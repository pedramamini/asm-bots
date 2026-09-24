/**
 * Replays (PRODUCT_SPEC §2, §10): a match that the arena played, as `@asmbots/protocol`'s `Replay`,
 * so anyone can run it and check the result hashes (ISA §5.6). `download replay` saves one as a
 * `.asmreplay.json` file; `replay link` puts one in a link to `/arena/$replayId`, whose page runs
 * it and checks it:
 *
 *     /arena/<match key>#r=<base64url of the replay's JSON>
 *
 * The arena wrote `asmbots-replay-local/1` before the protocol had a replay. It still reads one,
 * file or link, as the replay it is.
 */
import type { BattleConfig, BattleConfigInput, BotMeta } from '@asmbots/engine'
import {
  buildReplay as buildProtocolReplay,
  decodeReplayFragment,
  encodeReplayFragment,
  encodeShare,
  ISA,
  matchResultHash,
  ProtocolError,
  parseReplay,
  type Replay,
  replayBots,
} from '@asmbots/protocol'
import type { MatchResult, MatchRound } from '@asmbots/tourney'
import { CYCLES, MAX_ARENA_BOTS, MIN_ARENA_BOTS, PROCS, ROUNDS } from '../setup/config'
import type { ArenaBot } from '../worker/protocol'

/** The schema the arena wrote before `@asmbots/protocol`: read, never written. */
export const LOCAL_REPLAY_FORMAT = 'asmbots-replay-local/1'

/** A bot of a local replay. */
interface LocalReplayBot {
  readonly name: string
  readonly bytes: string
  readonly sha256: string
  readonly meta?: BotMeta | undefined
  readonly source?: string | undefined
}

/** A replay as the arena wrote it before `@asmbots/protocol`. */
export interface LocalReplay {
  readonly format: typeof LOCAL_REPLAY_FORMAT
  readonly isa: typeof ISA
  readonly createdAt: string
  /** The config over the engine defaults, its seed the match's. */
  readonly config: BattleConfig
  readonly rounds: number
  readonly bots: readonly LocalReplayBot[]
  readonly match: MatchResult
}

/**
 * The replay of `match`: `bots` loaded with `config` (its seed the match's), and each bot's
 * source where `sources` has it.
 */
export function buildReplay(
  bots: readonly ArenaBot[],
  sources: readonly string[],
  config: BattleConfigInput,
  rounds: number,
  match: MatchResult,
  now: Date = new Date(),
): Promise<Replay> {
  return buildProtocolReplay({
    bots: bots.map((bot, i) => ({ ...bot, source: sources[i] })),
    config,
    rounds,
    match,
    createdAt: now,
  })
}

/** The fragment of a replay link: `r=` and the base64url of `replay`'s JSON, sources left out. */
export const replayFragment = encodeReplayFragment

/** The link of `replay`: its page, named by its match key, and the replay in the fragment. */
export function replayUrl(origin: string, replay: Replay): string {
  return `${origin}${encodeShare({ bots: [], replay })}`
}

/** What a replay link's fragment holds. */
export type ReplayRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'ok'; readonly replay: Replay; readonly bots: readonly ArenaBot[] }

/**
 * The replay of a link's fragment (`#r=…`, the `#` optional): none when it has no `r`; broken,
 * and why, when it does not decode or is not a replay the arena can run.
 */
export function readReplayFragment(fragment: string): ReplayRead {
  try {
    const json = decodeReplayFragment(fragment)
    if (json === null) return { kind: 'none' }
    const replay = readReplay(json)
    return { kind: 'ok', replay, bots: replayBots(replay) }
  } catch (error) {
    if (error instanceof ReplayError || error instanceof ProtocolError) {
      return { kind: 'broken', reason: error.message }
    }
    throw error
  }
}

/**
 * `value` as a replay the arena can run, or a `ReplayError` that says what is wrong: a protocol
 * replay, or a local one (it has a `format`) as the protocol replay it is. The protocol holds the
 * counts to PRODUCT_SPEC §2 (16 bots, 10 rounds, 1M cycles); the arena also holds a bot to 256
 * processes, so a link cannot ask a browser for more.
 */
export function readReplay(value: unknown): Replay {
  const local = typeof value === 'object' && value !== null && 'format' in value
  const replay = local ? fromLocal(parseLocalReplay(value)) : protocol(value)
  integer(replay.config.maxProcesses, 'maxProcesses', PROCS.min, PROCS.max)
  return replay
}

/** `parseReplay`, its `ProtocolError` a `ReplayError`. */
function protocol(value: unknown): Replay {
  try {
    return parseReplay(value)
  } catch (error) {
    if (error instanceof ProtocolError) fail(error.message)
    throw error
  }
}

/** A local replay as the protocol has it: the seed out of the config, the match as its result. */
export function fromLocal({ createdAt, config, rounds, bots, match }: LocalReplay): Replay {
  const { seed, ...rest } = config
  return protocol({
    isa: ISA,
    createdAt,
    config: rest,
    seed,
    rounds,
    bots,
    result: {
      key: match.key,
      survivors: match.rounds[match.rounds.length - 1]?.survivors ?? [],
      points: match.points,
      resultHash: matchResultHash(match.rounds),
      rounds: match.rounds,
    },
  })
}

/**
 * Why a replay, or another link built on these checks (a tournament link), does not load: its
 * message says what is wrong, lowercase.
 */
export class ReplayError extends Error {
  override readonly name = 'ReplayError'
}

export function fail(reason: string): never {
  throw new ReplayError(reason)
}

type Fields = Readonly<Record<string, unknown>>

export function fields(value: unknown, what: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${what} is missing`)
  return value as Fields
}

export function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} is missing`)
  return value
}

/** `value` as an integer in `min..max`. */
export function integer(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(
      `${what} must be a whole number in ${min.toLocaleString('en-US')}..${max.toLocaleString('en-US')}`,
    )
  }
  return value
}

export function text(value: unknown, what: string, pattern?: RegExp): string {
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

export const UINT32 = 0xffff_ffff
const HASH = /^[0-9a-f]{16}$/
const SHA256 = /^[0-9a-f]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
/** A name in the battle: what the arena shows, one line. */
export const NAME = /^[^\n\r]{1,64}$/

/**
 * `value` as a local replay (`asmbots-replay-local/1`), or a `ReplayError` that says what is
 * wrong. The engine checks the config's values when the battle is made; this holds the counts to
 * what the arena runs (PRODUCT_SPEC §2: 16 bots, 10 rounds, 1M cycles, 256 processes a bot).
 */
export function parseLocalReplay(value: unknown): LocalReplay {
  const r = fields(value, 'the replay')
  if (r.format !== LOCAL_REPLAY_FORMAT) fail(`it is not a replay of format ${LOCAL_REPLAY_FORMAT}`)
  if (r.isa !== ISA) fail(`its bots are written for ${String(r.isa)}, not ${ISA}`)
  const createdAt = text(r.createdAt, 'its date')
  const config = parseConfig(r.config)
  const rounds = integer(r.rounds, 'rounds', ROUNDS.min, ROUNDS.max)
  const bots = list(r.bots, 'the bots').map(parseBot)
  if (bots.length < MIN_ARENA_BOTS || bots.length > MAX_ARENA_BOTS) {
    fail(`it has ${botCount(bots.length)}, and a battle has ${MIN_ARENA_BOTS} to ${MAX_ARENA_BOTS}`)
  }
  const match = parseMatch(r.match, bots.length, rounds)
  return { format: LOCAL_REPLAY_FORMAT, isa: ISA, createdAt, config, rounds, bots, match }
}

export function parseConfig(value: unknown): BattleConfig {
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

function parseBot(value: unknown, i: number): LocalReplayBot {
  const what = `bot ${i + 1}`
  const b = fields(value, what)
  const name = text(b.name, `${what}'s name`, NAME)
  const bytes = text(b.bytes, `${name}'s bytes`, BASE64)
  if (bytes === '') fail(`${name} has no bytes`)
  const bot: LocalReplayBot = { name, bytes, sha256: text(b.sha256, `${name}'s SHA-256`, SHA256) }
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

/**
 * The recorded match: `n` entrants and every one of its `rounds` rounds; with `partial`, the first
 * rounds of them (a melee in progress).
 */
export function parseMatch(
  value: unknown,
  n: number,
  rounds: number,
  partial = false,
): MatchResult {
  const m = fields(value, 'the recorded match')
  const key = text(m.key, 'the match key', HASH)
  const names = list(m.names, 'the match names').map((name) => text(name, 'a match name', NAME))
  if (names.length !== n) fail(`the match names ${botCount(names.length)}, not ${n}`)
  if (m.of !== rounds) fail(`the match has ${String(m.of)} rounds, not ${rounds}`)
  const played = list(m.rounds, 'the rounds')
  if (partial ? played.length > rounds : played.length !== rounds) {
    fail(`it records ${played.length} of its ${rounds} rounds`)
  }
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
