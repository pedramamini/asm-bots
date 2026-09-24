/**
 * The arena Worker's protocol (ARCHITECTURE §6): the requests the main thread sends
 * `arena.worker.ts`, and the messages it sends back. A message's typed arrays are transferred,
 * never copied.
 *
 * Each request that moves the battle gets exactly one `frame`, or an `error` in its place: `load`,
 * `setRound`, `step`, `seek`, and `requestFrame`. `play`, `pause`, and `speed` get no answer, only
 * an `error` when they fail. `loaded` comes before the frame of a `load` or a `setRound`, and
 * `ended` after the frame that ends the battle. `match` runs a whole match headless, beside the
 * battle and without touching it (the editor's `test vs`), and gets one `match`, or an `error`.
 *
 * A load is a match of one or more rounds (ISA §5.5): round i places the bots in a rotated order
 * with the seed plus i, as `@asmbots/tourney` scores it. The messages name bots by their place in
 * the load all the same, whatever order they fight in: a bot's index, its owner tag (index + 1),
 * and so its hue stay the same from round to round. Only `EndedMessage.result`, the engine's
 * own, lists the bots in fighting order.
 */
import type {
  BattleConfig,
  BattleConfigInput,
  BotMeta,
  BotResult,
  DeathReason,
  Result,
} from '@asmbots/engine'
import { DEATH_REASONS } from '@asmbots/engine'
import type { MatchResult } from '@asmbots/tourney'

/** A bot to load: its name, its machine code, and its `%author`, `%strategy`, and `%version`. */
export interface ArenaBot {
  readonly name: string
  readonly bytes: Uint8Array
  readonly meta?: BotMeta | undefined
}

/** Cycles per frame: 1..`MAX_CYCLES_PER_FRAME`, or `max`, as many as `FRAME_BUDGET_MS` allows. */
export type Speed = number | 'max'

/** The speed slider's top before `max` (PRODUCT_SPEC §2). */
export const MAX_CYCLES_PER_FRAME = 10_000

/** The Worker's speed until a `speed` request. */
export const DEFAULT_SPEED: Speed = 100

/** Whether `value` is a speed the Worker takes. */
export function isSpeed(value: unknown): value is Speed {
  return (
    value === 'max' ||
    (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_CYCLES_PER_FRAME)
  )
}

/**
 * The most time a frame runs cycles, ms. A frame stops at it, so a slow machine gets fewer cycles
 * per frame, not fewer frames (DESIGN_SYSTEM §5), and `max` runs this long each frame.
 */
export const FRAME_BUDGET_MS = 12

/** The Worker keeps a snapshot of the battle every this many cycles, for seeking. */
export const KEYFRAME_INTERVAL = 1000

/** The most keyframes the Worker keeps: 128 are about 19 MB for 16 bots. */
export const MAX_KEYFRAMES = 128

/** The most spawns, deaths, and bot deaths a frame carries of each: past it, the newest. */
export const EVENT_CAPACITY = 16_384

/** In `FrameMessage.ips`: set on the process at the front of its bot's queue, the next to run. */
export const IP_FRONT = 0x100

/** Fields per bot in `FrameMessage.stats`. */
export const STAT_FIELDS = 3
/** In `FrameMessage.stats`: the bot's live processes. */
export const STAT_PROCS = 0
/** In `FrameMessage.stats`: the core bytes the bot owns (ISA §5.4). */
export const STAT_FOOTPRINT = 1
/** In `FrameMessage.stats`: the bot's writes so far, one per byte or word it stored. */
export const STAT_WRITES = 2

/**
 * Fields per record of `FrameMessage.deaths`: the engine's `DEATH_RECORD` (cycle, bot, proc,
 * address, reason), then the killer.
 */
export const DEATH_FIELDS = 6
/**
 * In a `FrameMessage.deaths` record: the owner tag of the byte the process died running, the
 * first byte of its last instruction. 0: nobody's, as the core starts, so the process ran off
 * into empty core. The bot's own tag: it ran its own bomb or code. Another bot's: a kill.
 */
export const DEATH_KILLER = 5
/** Fields per record of `FrameMessage.botDeaths`: cycle, bot, reason, killer. */
export const BOT_DEATH_FIELDS = 4

/** The requests: main thread to Worker. */
export type ArenaRequest =
  | {
      readonly type: 'load'
      readonly bots: readonly ArenaBot[]
      /** Over the engine's defaults (ISA §5.5). Its seed is the match's: round i's is seed + i. */
      readonly config: BattleConfigInput
      /** Rounds in the match: 1 when absent. Round 0 loads. */
      readonly rounds?: number | undefined
    }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'step'; readonly cycles: number }
  | { readonly type: 'seek'; readonly cycle: number }
  | { readonly type: 'speed'; readonly cyclesPerFrame: Speed }
  /**
   * Round `round` of the match (from 0) from cycle 0: a round already run, or the one after
   * them. A later one fails: the match scores its rounds in order.
   */
  | { readonly type: 'setRound'; readonly round: number }
  /** A frame's worth of cycles, when playing. The main thread asks once per display frame. */
  | { readonly type: 'requestFrame' }
  /**
   * A whole match of `rounds` rounds, headless: no frames, and the battle loaded stays as it was.
   * Its answer is a `match` with the result `runMatch` gives. With `resume` and `through`, part of
   * one: the rounds after `resume`'s, up to `through` of them (a tournament's melee, a round at a
   * time).
   */
  | {
      readonly type: 'match'
      readonly bots: readonly ArenaBot[]
      readonly config: BattleConfigInput
      readonly rounds: number
      readonly resume?: MatchResult | undefined
      readonly through?: number | undefined
    }

/** The requests that get a frame, or an error in its place. */
export const FRAME_REQUESTS: ReadonlySet<ArenaRequest['type']> = new Set([
  'load',
  'setRound',
  'step',
  'seek',
  'requestFrame',
])

/** Where a bot was loaded: `size` bytes from `base`, wrapping at 64 KB. */
export interface Placement {
  readonly base: number
  readonly size: number
}

/** A loaded bot as the UI shows it. */
export interface ArenaBotMeta extends BotMeta {
  readonly name: string
  /** Its image size in bytes. */
  readonly size: number
}

/** The answer to `load` and `setRound`, before their frame. */
export interface LoadedMessage {
  readonly type: 'loaded'
  /** One per bot, in submission order. */
  readonly placements: readonly Placement[]
  /** One per bot, in submission order. */
  readonly botMeta: readonly ArenaBotMeta[]
  /** The config the round runs with: the request's over the engine's defaults, the round's seed. */
  readonly config: BattleConfig
  /** The round loaded, from 0. */
  readonly round: number
  /** The rounds in the match. */
  readonly rounds: number
  /** The round's fighting order (ISA §5.5): `order[j]` is the bot placed j-th. */
  readonly order: readonly number[]
  /** The match so far: the rounds played to their end, in order. */
  readonly match: MatchResult
}

/** The round's first kill: the first process to die running a byte another bot owns. */
export interface FirstBlood {
  readonly cycle: number
  /** The bot whose byte it ran. */
  readonly killer: number
  /** The bot whose process died. */
  readonly victim: number
}

/**
 * A frame: the battle at the frame's end, and what happened during it. After `load`, `setRound`,
 * and `seek` the frame is full: `ownerDirty` and `bytesDirty` hold the whole core, and it carries
 * no activity, so the renderer starts over from it. Other frames carry only what changed.
 */
export interface FrameMessage {
  readonly type: 'frame'
  /** Cycles run: the battle's `cycle` at the frame's end. */
  readonly cycle: number
  /** Bots alive. */
  readonly alive: number
  /** Whether the battle is over (ISA §5.5). */
  readonly over: boolean
  /**
   * Each byte written during the frame, once, however often it was written: pairs of (address,
   * cell). The cell is the byte as the frame left it, in bits 0..7, and its owner tag in bits
   * 8..15: 0 for nobody, else bot index + 1.
   */
  readonly writes: Uint16Array
  /** The cycle of each written byte's last write in the frame: one per pair of `writes`. */
  readonly writeCycles: Uint32Array
  /**
   * Each byte of each instruction run during the frame, once: pairs of (address, bot index), the
   * bot that ran it last.
   */
  readonly execs: Uint16Array
  /**
   * Each live process at the frame's end, bot by bot, each bot's queue front first: pairs of (IP,
   * bot index), with `IP_FRONT` set on each bot's front process.
   */
  readonly ips: Uint16Array
  /** The frame's spawns, oldest first: `SPAWN_RECORD` fields each (cycle, bot, proc, address). */
  readonly spawns: Uint32Array
  /**
   * The frame's process deaths, oldest first: `DEATH_FIELDS` fields each (cycle, bot, proc,
   * address, reason as a `DEATH_REASONS` index, killer tag: `DEATH_KILLER`).
   */
  readonly deaths: Uint32Array
  /**
   * The frame's bot deaths: `BOT_DEATH_FIELDS` fields each (cycle, bot, reason, killer tag), the
   * reason and the killer of its last process. A full frame lists every bot dead by its cycle,
   * the earliest first.
   */
  readonly botDeaths: Uint32Array
  /** `STAT_FIELDS` per bot, in submission order: procs, footprint, writes. */
  readonly stats: Float32Array
  /** The round's first blood once it has happened, else null. */
  readonly firstBlood: FirstBlood | null
  /**
   * The cycles of the keyframes the Worker holds, ascending, where a seek lands fast: on a full
   * frame, and whenever they changed since the last frame; else null.
   */
  readonly keyframes: Uint32Array | null
  /** The whole owner map on a full frame, else null. */
  readonly ownerDirty: Uint8Array | null
  /** The whole core on a full frame, else null. */
  readonly bytesDirty: Uint8Array | null
}

/** The round is over. Follows its frame, once per ending: a seek back and a replay end it again. */
export interface EndedMessage {
  readonly type: 'ended'
  /** The round's result (ISA §5.5), as the engine gives it: the bots in fighting order. */
  readonly result: Result
  /** `resultHash(result)`, which a replay checks (ISA §5.6). */
  readonly hash: string
  /** The round, from 0. */
  readonly round: number
  /** The match so far, this round included. */
  readonly match: MatchResult
}

/** A request failed. The battle is as it was before it. */
export interface ErrorMessage {
  readonly type: 'error'
  /** The type of the request that failed, or null when the Worker itself failed (`client.ts`). */
  readonly request: ArenaRequest['type'] | null
  readonly message: string
}

/** The answer to a `match` request: the whole match. */
export interface MatchMessage {
  readonly type: 'match'
  readonly match: MatchResult
}

/** The messages: Worker to main thread. */
export type ArenaMessage = LoadedMessage | FrameMessage | EndedMessage | ErrorMessage | MatchMessage

/** The engine's `result` of a round fought in `order`, one bot per place in the load. */
export function botResults(result: Result, order: readonly number[]): BotResult[] {
  const bots: BotResult[] = new Array(result.bots.length)
  result.bots.forEach((bot, j) => {
    bots[order[j] ?? j] = bot
  })
  return bots
}

/** A death reason's code in `FrameMessage.deaths` and `botDeaths`, as the engine names it. */
export function deathReason(code: number): DeathReason {
  return DEATH_REASONS[code] ?? 'undefined'
}
