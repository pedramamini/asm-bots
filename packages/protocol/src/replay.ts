/**
 * Replays (ARCHITECTURE §7, PRODUCT_SPEC §2, §10): a match as what it takes to run it again, and
 * what came out. The engine is deterministic, so the inputs are the replay; the result is there to
 * check a run against (ISA §5.6). The arena writes one to a `.asmreplay.json` file and into replay
 * links; the API stores one in R2 at `replays/<replayKey>.json`.
 *
 * A match of K rounds places round i with seed `seed + i` and the bots rotated by i (ISA §5.5).
 */
import {
  type BattleConfig,
  type BattleConfigInput,
  type BotMeta,
  DEFAULT_CONFIG,
  fnv1a64,
  type LoadedBot,
} from '@asmbots/engine'
import type { MatchResult } from '@asmbots/tourney'
import * as z from 'zod/mini'
import { fromBase64, sha256Hex, toBase64 } from './bytes'
import { canonicalJson } from './canonical'
import { BASE64, HASH64, matching, NAME, parse, SHA256, UINT32, whole } from './schema'

/** The instruction set every replay's bots are written in. */
export const ISA = 'x16c-v1'
/** The fewest bots that make a match. */
export const MIN_REPLAY_BOTS = 2
/** The most bots in a match: a melee's cap (PRODUCT_SPEC §2). */
export const MAX_REPLAY_BOTS = 16
/** The most rounds in a match (PRODUCT_SPEC §2). */
export const MAX_REPLAY_ROUNDS = 10
/** The most cycles a round may run (PRODUCT_SPEC §2). */
export const MAX_REPLAY_CYCLES = 1_000_000

const botCount = (n: number) => `${n} ${n === 1 ? 'bot' : 'bots'}`

/** A seed: uint32 (ISA §5.5). */
export const Seed = whole('the seed', 0, UINT32)

/** What a bot's author says of it (`@author`, `@strategy`, `@version`). */
export const BotMetaSchema = z.object({
  author: z.optional(z.string()),
  strategy: z.optional(z.string()),
  version: z.optional(z.string()),
})

/** A bot of a replay. */
export const ReplayBot = z.object({
  /** Its name in the battle: `Dwarf`, `Dwarf 2`. */
  name: matching(NAME),
  /** Its machine code, standard base64. */
  bytes: z.string().check(z.minLength(1), z.regex(BASE64)),
  /** SHA-256 of its machine code, lowercase hex. */
  sha256: matching(SHA256),
  meta: z.optional(BotMetaSchema),
  /** Its source, when the maker had it. A replay link leaves it out. */
  source: z.optional(z.string()),
})
export type ReplayBot = z.output<typeof ReplayBot>

/** The battle parameters of a match, less the seed, which each round sets (ISA §5.5). */
export const ReplayConfig = z.object({
  coreSize: whole('coreSize', 1, UINT32),
  maxCycles: whole('maxCycles', 1, MAX_REPLAY_CYCLES),
  maxProcesses: whole('maxProcesses', 1, 0x10000),
  minSpacing: whole('minSpacing', 0, UINT32),
  maxBotBytes: whole('maxBotBytes', 1, UINT32),
})
export type ReplayConfig = z.output<typeof ReplayConfig>

/** One round of a match. Indices are entrant indices: positions in the replay's `bots`. */
export const RoundResult = z.object({
  /** The round number, from 0. */
  round: whole('a round number', 0, MAX_REPLAY_ROUNDS - 1),
  /** The placement seed: the match seed + `round`, mod 2^32. */
  seed: Seed,
  /** The fighting order: `order[j]` is the entrant placed j-th. */
  order: z.array(whole('an entrant', 0, MAX_REPLAY_BOTS - 1)),
  /** The engine result's hash (ISA §5.6), for the bots in fighting order. */
  resultHash: matching(HASH64),
  /** The cycles the battle ran. */
  durationCycles: whole('the cycles', 0, UINT32),
  /** Round points per entrant. */
  points: z.array(whole('points', 0, UINT32)),
  /** The entrants alive at the end, ascending. */
  survivors: z.array(whole('a survivor', 0, MAX_REPLAY_BOTS - 1)),
  /** Cycles each entrant lived through: its death cycle, or `durationCycles` if it survived. */
  survival: z.array(whole('survival', 0, UINT32)),
})
export type RoundResult = z.output<typeof RoundResult>

/** What a match came to. */
export const ReplayResult = z.object({
  /** `matchHash` of the inputs (`@asmbots/tourney`): the arena's name for the match. */
  key: matching(HASH64),
  /** The entrants alive at the end of the last round, ascending. */
  survivors: z.array(whole('a survivor', 0, MAX_REPLAY_BOTS - 1)),
  /** Match points per entrant: the sum of its round points. */
  points: z.array(whole('points', 0, UINT32)),
  /** `matchResultHash` of the rounds: one hash for the whole match. */
  resultHash: matching(HASH64),
  /** Every round, in order. */
  rounds: z.array(RoundResult),
})
export type ReplayResult = z.output<typeof ReplayResult>

/** A replay's fields, before the checks that tie them together. */
const ReplayShape = z.object({
  isa: z.literal(ISA),
  /** When it was made, ISO 8601. */
  createdAt: z.optional(z.string()),
  config: ReplayConfig,
  /** The match seed: round i is placed with `seed + i`, mod 2^32. */
  seed: Seed,
  rounds: whole('rounds', 1, MAX_REPLAY_ROUNDS),
  /** In the order they were loaded: round i fights them rotated by i (ISA §5.5). */
  bots: z.array(ReplayBot),
  result: ReplayResult,
})

/** A match, as inputs and the result they gave. */
export const Replay = ReplayShape.check(
  z.superRefine((replay, ctx) => {
    const problem = consistency(replay)
    if (problem !== null) ctx.addIssue({ code: 'custom', message: problem, input: replay })
  }),
)
export type Replay = z.output<typeof Replay>

/** The first way `replay`'s parts disagree with each other, or null. */
function consistency(replay: z.output<typeof ReplayShape>): string | null {
  const n = replay.bots.length
  if (n < MIN_REPLAY_BOTS || n > MAX_REPLAY_BOTS) {
    return `it has ${botCount(n)}, and a battle has ${MIN_REPLAY_BOTS} to ${MAX_REPLAY_BOTS}`
  }
  const { result } = replay
  if (result.rounds.length !== replay.rounds) {
    return `it records ${result.rounds.length} of its ${replay.rounds} rounds`
  }
  if (result.points.length !== n)
    return `the match points name ${botCount(result.points.length)}, not ${n}`
  if (result.survivors.some((i) => i >= n)) return 'a survivor is not one of the bots'
  for (const [i, round] of result.rounds.entries()) {
    const what = `round ${i + 1}`
    if (round.round !== i) return `${what} is out of order`
    if (
      round.order.length !== n ||
      new Set(round.order).size !== n ||
      round.order.some((j) => j >= n)
    ) {
      return `${what}'s order is not the ${n} bots`
    }
    if (round.points.length !== n || round.survival.length !== n)
      return `${what} does not name ${botCount(n)}`
    if (round.survivors.some((j) => j >= n)) return `${what}'s survivors are not all bots`
  }
  return null
}

/** `value` as a replay, or a `ProtocolError` that says what is wrong with it. */
export function parseReplay(value: unknown): Replay {
  return parse(Replay, value, 'the replay')
}

/** One hash for a match: FNV-1a 64 of the canonical JSON of its rounds' result hashes, in order. */
export function matchResultHash(rounds: readonly { readonly resultHash: string }[]): string {
  return fnv1a64(new TextEncoder().encode(canonicalJson(rounds.map((r) => r.resultHash))))
}

/**
 * The content key of `replay`: SHA-256, lowercase hex, of the canonical JSON of its inputs (the
 * ISA, config, seed, rounds, and each bot's name and bytes). Its result, sources, metadata, and
 * date do not count: the same match always has the same key, whoever made the file.
 */
export function replayKey(replay: Replay): Promise<string> {
  const inputs = {
    isa: replay.isa,
    config: replay.config,
    seed: replay.seed,
    rounds: replay.rounds,
    bots: replay.bots.map(({ name, bytes }) => ({ name, bytes })),
  }
  return sha256Hex(new TextEncoder().encode(canonicalJson(inputs)))
}

/** The engine config of `replay`'s first round: its config and its seed. */
export function replayConfig(replay: Replay): BattleConfig {
  return { ...replay.config, seed: replay.seed }
}

/** The bots of `replay` as the engine loads them. */
export function replayBots(replay: Replay): LoadedBot[] {
  return replay.bots.map(({ name, bytes, meta }) => ({
    name,
    bytes: fromBase64(bytes),
    ...(meta !== undefined && { meta }),
  }))
}

/** `replay`'s result as `@asmbots/tourney` has a match. */
export function replayMatch(replay: Replay): MatchResult {
  const { key, rounds, points } = replay.result
  return { key, names: replay.bots.map((bot) => bot.name), of: replay.rounds, rounds, points }
}

/** `replay` less its bots' sources: what a link carries. */
export function withoutSources(replay: Replay): Replay {
  return { ...replay, bots: replay.bots.map(({ source: _, ...bot }) => bot) }
}

/**
 * Why `replay`'s bytes are not what it says they are: the first bot whose bytes do not hash to
 * its `sha256`. Null when every bot's do.
 */
export async function bytesProblem(replay: Replay): Promise<string | null> {
  for (const bot of replay.bots) {
    if ((await sha256Hex(fromBase64(bot.bytes))) !== bot.sha256) {
      return `${bot.name}'s bytes do not match their SHA-256`
    }
  }
  return null
}

/** A bot as `buildReplay` takes it. */
export interface ReplayInputBot extends LoadedBot {
  readonly meta?: BotMeta | undefined
  /** Its source; left out when undefined or empty. */
  readonly source?: string | undefined
}

export interface BuildReplayInput {
  readonly bots: readonly ReplayInputBot[]
  /** The match's config over the engine defaults; its seed is the match seed. */
  readonly config: BattleConfigInput
  readonly rounds: number
  /** The complete match the bots fought with `config`: `runMatch`'s, or the arena's. */
  readonly match: MatchResult
  readonly createdAt?: Date | undefined
}

/** The replay of a complete match. Throws when `match` is not complete. */
export async function buildReplay({
  bots,
  config,
  rounds,
  match,
  createdAt = new Date(),
}: BuildReplayInput): Promise<Replay> {
  if (match.rounds.length !== rounds) {
    throw new RangeError(
      `buildReplay: the match has ${match.rounds.length} of its ${rounds} rounds`,
    )
  }
  const { seed, ...rest } = { ...DEFAULT_CONFIG, ...defined(config) }
  const last = match.rounds[match.rounds.length - 1]
  return {
    isa: ISA,
    createdAt: createdAt.toISOString(),
    config: rest,
    seed,
    rounds,
    bots: await Promise.all(
      bots.map(async (bot) => ({
        name: bot.name,
        bytes: toBase64(bot.bytes),
        sha256: await sha256Hex(bot.bytes),
        ...(bot.meta !== undefined && { meta: bot.meta }),
        ...(bot.source ? { source: bot.source } : {}),
      })),
    ),
    result: {
      key: match.key,
      survivors: [...(last?.survivors ?? [])],
      points: [...match.points],
      resultHash: matchResultHash(match.rounds),
      rounds: match.rounds.map((round) => ({
        ...round,
        order: [...round.order],
        points: [...round.points],
        survivors: [...round.survivors],
        survival: [...round.survival],
      })),
    },
  }
}

/** The fields of `config` that are set. */
function defined(config: BattleConfigInput): Partial<BattleConfig> {
  const out: { -readonly [K in keyof BattleConfig]?: number } = {}
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) out[key as keyof BattleConfig] = value
  }
  return out
}
