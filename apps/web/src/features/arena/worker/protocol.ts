/**
 * The arena Worker's protocol (ARCHITECTURE §6): the requests the main thread sends
 * `arena.worker.ts`, and the messages it sends back. A message's typed arrays are transferred,
 * never copied.
 *
 * Each request that moves the battle gets exactly one `frame`, or an `error` in its place: `load`,
 * `setRound`, `step`, `seek`, and `requestFrame`. `play`, `pause`, and `speed` get no answer, only
 * an `error` when they fail. `loaded` comes before the frame of a `load` or a `setRound`, and
 * `ended` after the frame that ends the battle.
 */
import type { BattleConfig, BattleConfigInput, BotMeta, Result } from '@asmbots/engine'

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

/** The requests: main thread to Worker. */
export type ArenaRequest =
  | {
      readonly type: 'load'
      readonly bots: readonly ArenaBot[]
      /** Over the engine's defaults (ISA §5.5). */
      readonly config: BattleConfigInput
    }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'step'; readonly cycles: number }
  | { readonly type: 'seek'; readonly cycle: number }
  | { readonly type: 'speed'; readonly cyclesPerFrame: Speed }
  /** The same bots again from cycle 0, placed with another seed. */
  | { readonly type: 'setRound'; readonly seed: number }
  /** A frame's worth of cycles, when playing. The main thread asks once per display frame. */
  | { readonly type: 'requestFrame' }

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
  /** The config the battle runs with: the request's over the engine's defaults. */
  readonly config: BattleConfig
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
   * The frame's process deaths, oldest first: `DEATH_RECORD` fields each (cycle, bot, proc,
   * address, reason as a `DEATH_REASONS` index).
   */
  readonly deaths: Uint32Array
  /**
   * The frame's bot deaths: `BOT_DEAD_RECORD` fields each (cycle, bot). A full frame lists every
   * bot dead by its cycle.
   */
  readonly botDeaths: Uint32Array
  /** `STAT_FIELDS` per bot, in submission order: procs, footprint, writes. */
  readonly stats: Float32Array
  /** The whole owner map on a full frame, else null. */
  readonly ownerDirty: Uint8Array | null
  /** The whole core on a full frame, else null. */
  readonly bytesDirty: Uint8Array | null
}

/** The battle is over. Follows its frame, once per ending: a seek back and a replay end it again. */
export interface EndedMessage {
  readonly type: 'ended'
  /** The battle's result (ISA §5.5). */
  readonly result: Result
  /** `resultHash(result)`, which a replay checks (ISA §5.6). */
  readonly hash: string
}

/** A request failed. The battle is as it was before it. */
export interface ErrorMessage {
  readonly type: 'error'
  /** The type of the request that failed, or null when the Worker itself failed (`client.ts`). */
  readonly request: ArenaRequest['type'] | null
  readonly message: string
}

/** The messages: Worker to main thread. */
export type ArenaMessage = LoadedMessage | FrameMessage | EndedMessage | ErrorMessage
