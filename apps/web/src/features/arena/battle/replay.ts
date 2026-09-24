/**
 * `download replay` (PRODUCT_SPEC §10): a match as a `.asmreplay.json` file that says how to run
 * it again and what came out, so anyone can run it and check the result hashes (ISA §5.6).
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
import type { MatchResult } from '@asmbots/tourney'
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
  /** Its source, when the arena had it. */
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

async function sha256(bytes: Uint8Array): Promise<string> {
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
