/**
 * Battles (ISA §5): bots placed in one core by a seeded PCG32, then run one instruction per
 * living bot per cycle until at most one bot is left or the cycle cap is reached.
 *
 * Two readings are pinned here. SPL queues the child ahead of its parent, the literal ISA §5.2
 * order: the turn pops the parent, the SPL appends the child, and then the parent goes back in
 * behind it. A bot alone in the core runs until it dies or the cycle cap, as a lone warrior does
 * in pMARS: the "at most one alive" rule of §5.5 ends contests of two or more.
 */
import { ADDR_MASK, CORE_SIZE, Core } from './core'
import type { EventSink } from './events'
import { NullSink } from './events'
import type { DeathReason, ExecBot } from './exec'
import { EXEC_KILLED, EXEC_SPAWN, ExecContext, execOne, Fetcher } from './exec'
import { FLAGS_INIT } from './flags'
import { Pcg32 } from './prng'
import type { ProcRow } from './proc'
import { FLAGS, IP, ProcQueue, SP } from './proc'

/** What the assembler reads from `%author`, `%strategy`, and `%version` (ISA §6.2). */
export interface BotMeta {
  readonly author?: string | undefined
  readonly strategy?: string | undefined
  readonly version?: string | undefined
}

/** A bot ready to fight: its machine code, loaded at the base and entered there (ISA §6.5). */
export interface LoadedBot {
  readonly name: string
  readonly bytes: Uint8Array
  /** Carried for the UI. The engine never reads it. */
  readonly meta?: BotMeta | undefined
}

/** The battle parameters (ISA §5.5). */
export interface BattleConfig {
  /** Fixed at 65,536 in x16c v1. */
  readonly coreSize: number
  /** The battle ends when this many cycles have run. At most 2^32 - 1, so events fit a uint32. */
  readonly maxCycles: number
  /** Processes per bot. SPL is a NOP at the cap. */
  readonly maxProcesses: number
  /** The fewest free bytes allowed between two bot images. */
  readonly minSpacing: number
  /** The largest bot image, in bytes. */
  readonly maxBotBytes: number
  /** A uint32 that seeds the placement PRNG, PCG32 stream 0. */
  readonly seed: number
}

/** Config input: a field left out or undefined takes its `DEFAULT_CONFIG` value. */
export type BattleConfigInput = { readonly [K in keyof BattleConfig]?: number | undefined }

/** ISA §5.5 values. The spec gives the seed no default; 0 is this engine's. */
export const DEFAULT_CONFIG: BattleConfig = Object.freeze({
  coreSize: CORE_SIZE,
  maxCycles: 100_000,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
  seed: 0,
})

/** Owner tags are bytes and 0 is nobody (ISA §5.4), so a battle holds at most 255 bots. */
export const MAX_BOTS = 255

/** Draws per bot before placement fails (ISA §5.5). */
export const PLACEMENT_ATTEMPTS = 1000

/** The bots do not fit: a bot drew `PLACEMENT_ATTEMPTS` bases and none was clear (ISA §5.5). */
export class PlacementError extends Error {
  /** The index of the bot that did not fit. */
  readonly bot: number

  constructor(bot: number, size: number, minSpacing: number) {
    super(
      `cannot place bot ${bot} (${size} bytes) ${minSpacing} bytes clear of the ${bot} placed ` +
        `before it in ${PLACEMENT_ATTEMPTS} draws`,
    )
    this.name = 'PlacementError'
    this.bot = bot
  }
}

/**
 * A base for each image size, in order (ISA §5.5). A base is `rng.nextInt(65536)`, drawn again
 * until the image keeps `minSpacing` free bytes on each side from every image placed before it,
 * around the wrap. A bot that finds no base in `PLACEMENT_ATTEMPTS` draws throws
 * `PlacementError`.
 */
export function place(
  sizes: readonly number[],
  minSpacing: number,
  rng: Pick<Pcg32, 'nextInt'>,
): number[] {
  const bases: number[] = []
  for (let i = 0; i < sizes.length; i++) bases.push(draw(i, sizes, minSpacing, bases, rng))
  return bases
}

function draw(
  i: number,
  sizes: readonly number[],
  m: number,
  bases: readonly number[],
  rng: Pick<Pcg32, 'nextInt'>,
): number {
  const size = sizes[i] as number
  for (let t = 0; t < PLACEMENT_ATTEMPTS; t++) {
    const base = rng.nextInt(CORE_SIZE)
    if (clear(base, size, bases, sizes, m)) return base
  }
  throw new PlacementError(i, size, m)
}

/**
 * Whether `size` bytes at `base` keep `m` free bytes from each placed image. Take `d` as the
 * distance from `base` forward to a placed image's base. That image must start `m` or more bytes
 * after the new one ends (`d >= size + m`) and end `m` or more bytes before the new one starts,
 * around the wrap (`d + its size + m <= 65536`).
 */
function clear(
  base: number,
  size: number,
  bases: readonly number[],
  sizes: readonly number[],
  m: number,
): boolean {
  for (let j = 0; j < bases.length; j++) {
    const d = ((bases[j] as number) - base) & ADDR_MASK
    if (d < size + m || d + (sizes[j] as number) + m > CORE_SIZE) return false
  }
  return true
}

/** The score of each survivor when `survivors` of `n` bots live (ISA §5.5). Dead bots score 0. */
export function pmarsPoints(n: number, survivors: number): number {
  return survivors > 0 ? Math.floor((n * n - 1) / survivors) : 0
}

/** A bot's counters. The footprint is not one: `result` counts it from the owner map. */
export interface BotStats {
  /** Instructions executed, one per turn, the killing one included. */
  cycles: number
  /** Memory writes: one per stored byte or word, so one per REP iteration. The load is not one. */
  writes: number
  /** The most processes it held at once. */
  peakProcs: number
  /** The cycle its last process died in, or null while it lives. */
  deathCycle: number | null
  /** Why its last process died, or null while it lives. */
  deathReason: DeathReason | null
}

/** A bot in a battle: where it was placed, its processes, and its counters. */
export class Bot implements ExecBot {
  /** Its index in submission order. */
  readonly index: number
  /** Its owner tag: index + 1 (ISA §5.4). */
  readonly tag: number
  readonly name: string
  readonly meta: BotMeta | undefined
  /** Where its image starts. */
  readonly base: number
  /** Its image size in bytes. */
  readonly size: number
  readonly queue: ProcQueue
  readonly stats: BotStats = {
    cycles: 0,
    writes: 0,
    peakProcs: 1,
    deathCycle: null,
    deathReason: null,
  }

  constructor(index: number, loaded: LoadedBot, base: number, maxProcesses: number) {
    this.index = index
    this.tag = index + 1
    this.name = loaded.name
    this.meta = loaded.meta
    this.base = base
    this.size = loaded.bytes.length
    this.queue = new ProcQueue(maxProcesses)
    // One process: IP = SP = base, FLAGS = 0x0002, all else 0 (ISA §5.5).
    const row = this.queue.rows[this.queue.push()] as ProcRow
    row.fill(0)
    row[IP] = base
    row[SP] = base
    row[FLAGS] = FLAGS_INIT
  }

  /** A bot lives while it has a process (ISA §5.1). */
  get alive(): boolean {
    return this.queue.size > 0
  }
}

/** A bot's outcome. */
export interface BotResult extends Readonly<BotStats> {
  readonly name: string
  readonly alive: boolean
  /** Its pMARS points (ISA §5.5). */
  readonly points: number
  /** Its live processes. */
  readonly procs: number
  /** The core bytes it owns (ISA §5.4). */
  readonly footprint: number
}

/** A battle's outcome, or its standing so far. */
export interface Result {
  /** Cycles run. */
  readonly cycles: number
  /** The indices of the living bots, ascending. */
  readonly survivors: readonly number[]
  /** One per bot, in submission order. */
  readonly bots: readonly BotResult[]
}

function checkInteger(name: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`Battle: ${name} must be an integer in ${min}..${max}, got ${v}`)
  }
}

/** `config` over the defaults, checked. */
function resolveConfig(config: BattleConfigInput): BattleConfig {
  const c: BattleConfig = {
    coreSize: config.coreSize ?? DEFAULT_CONFIG.coreSize,
    maxCycles: config.maxCycles ?? DEFAULT_CONFIG.maxCycles,
    maxProcesses: config.maxProcesses ?? DEFAULT_CONFIG.maxProcesses,
    minSpacing: config.minSpacing ?? DEFAULT_CONFIG.minSpacing,
    maxBotBytes: config.maxBotBytes ?? DEFAULT_CONFIG.maxBotBytes,
    seed: config.seed ?? DEFAULT_CONFIG.seed,
  }
  if (c.coreSize !== CORE_SIZE) {
    throw new RangeError(`Battle: coreSize is ${CORE_SIZE} in x16c v1, got ${c.coreSize}`)
  }
  checkInteger('maxCycles', c.maxCycles, 0, 0xffffffff)
  checkInteger('maxProcesses', c.maxProcesses, 1, 0x10000)
  checkInteger('minSpacing', c.minSpacing, 0, CORE_SIZE)
  checkInteger('maxBotBytes', c.maxBotBytes, 1, CORE_SIZE)
  checkInteger('seed', c.seed, 0, 0xffffffff)
  return Object.freeze(c)
}

/**
 * One battle (ISA §5). The constructor places and loads the bots; `step` runs a cycle. The battle
 * is over after a cycle that leaves at most one bot alive (none, for a bot alone), or when
 * `maxCycles` cycles have run. After that `step` does nothing.
 */
export class Battle {
  readonly config: BattleConfig
  readonly core = new Core()
  /** In submission order. */
  readonly bots: readonly Bot[]
  /** The placement PRNG where placement left it. Nothing else draws from it. */
  readonly prng: Pcg32
  /** Where events go. It can change between cycles: the arena mutes a seek with a `NullSink`. */
  events: EventSink

  private readonly fetcher: Fetcher
  private readonly ctx = new ExecContext()
  /** The cycle running, or the next one between cycles. */
  private now = 0
  private living: number
  /** The battle is over when at most this many bots live: 1, or 0 for a bot alone. */
  private readonly last: number

  /**
   * Places the bots with PCG32(`seed`) and loads them, tagged, at their bases (ISA §5.5). Throws
   * `RangeError` for a bad config or bot, and `PlacementError` when the bots do not fit.
   * `core.onWrite` belongs to the battle from here on.
   */
  constructor(
    bots: readonly LoadedBot[],
    config: BattleConfigInput = {},
    events: EventSink = new NullSink(),
  ) {
    this.config = resolveConfig(config)
    const { maxBotBytes, maxProcesses, minSpacing, seed } = this.config
    if (bots.length < 1 || bots.length > MAX_BOTS) {
      throw new RangeError(`Battle: a battle holds 1..${MAX_BOTS} bots, got ${bots.length}`)
    }
    bots.forEach((b, i) => {
      const n = b.bytes.length
      if (n < 1 || n > maxBotBytes) {
        throw new RangeError(`Battle: bot ${i} (${b.name}) is ${n} bytes, not 1..${maxBotBytes}`)
      }
    })
    this.prng = new Pcg32(seed)
    const bases = place(
      bots.map((b) => b.bytes.length),
      minSpacing,
      this.prng,
    )
    this.bots = bots.map((b, i) => {
      const bot = new Bot(i, b, bases[i] as number, maxProcesses)
      this.core.fill(bot.base, b.bytes, bot.tag)
      return bot
    })
    this.living = bots.length
    this.last = bots.length > 1 ? 1 : 0
    this.fetcher = new Fetcher(this.core)
    this.events = events
    // Set after the load, so only the bots' own stores count as writes. A write owned by nobody
    // (tag 0, a debugger's poke) belongs to no bot, so it is neither counted nor an event.
    this.core.onWrite = (addr, len, owner) => {
      const bot = this.bots[owner - 1]
      if (bot === undefined) return
      bot.stats.writes++
      this.events.write(this.now, bot.index, addr, len)
    }
  }

  /** The cycles run. Cycles count from 0, so during `step` this is the running cycle. */
  get cycle(): number {
    return this.now
  }

  /** Bots alive. */
  get alive(): number {
    return this.living
  }

  /** Whether the battle has ended (ISA §5.5). */
  get over(): boolean {
    return this.living <= this.last || this.now >= this.config.maxCycles
  }

  /**
   * Runs one cycle (ISA §5.2): each living bot in turn order, starting with bot `cycle mod N`,
   * runs its front process for one instruction.
   */
  step(): void {
    if (this.over) return
    const c = this.now
    const bots = this.bots
    const n = bots.length
    let i = c % n
    for (let k = 0; k < n; k++) {
      const bot = bots[i] as Bot
      if (bot.queue.size > 0) this.turn(bot, c)
      i = i + 1 === n ? 0 : i + 1
    }
    this.now = c + 1
    this.events.cycleEnd(c)
  }

  /**
   * Runs up to `cycles` cycles, stopping when the battle is over. Returns the result once it is
   * over, and null before.
   */
  run(cycles = Number.POSITIVE_INFINITY): Result | null {
    if (!(cycles >= 0) || !(Number.isInteger(cycles) || cycles === Number.POSITIVE_INFINITY)) {
      throw new RangeError(`Battle: run takes a whole number of cycles, got ${cycles}`)
    }
    for (let k = 0; k < cycles && !this.over; k++) this.step()
    return this.over ? this.result() : null
  }

  /** The outcome so far: the final one once the battle is over. */
  result(): Result {
    // Owner tag t counts the bytes of bot t - 1; tag 0 is nobody's.
    const owned = new Uint32Array(MAX_BOTS + 1)
    const owner = this.core.owner
    for (let a = 0; a < CORE_SIZE; a++) {
      const t = owner[a] as number
      owned[t] = (owned[t] as number) + 1
    }
    const survivors = this.bots.filter((b) => b.alive).map((b) => b.index)
    const points = pmarsPoints(this.bots.length, survivors.length)
    return {
      cycles: this.now,
      survivors,
      bots: this.bots.map((b) => ({
        name: b.name,
        alive: b.alive,
        points: b.alive ? points : 0,
        procs: b.queue.size,
        footprint: owned[b.tag] as number,
        ...b.stats,
      })),
    }
  }

  /** One turn: the front process of `bot` runs one instruction in cycle `c`. */
  private turn(bot: Bot, c: number): void {
    const q = bot.queue
    const r = q.front()
    const row = q.rows[r] as ProcRow
    const ip = row[IP] as number
    const instr = this.fetcher.fetch(ip)
    bot.stats.cycles++
    this.events.exec(c, bot.index, r, ip, instr === undefined ? 1 : instr.length)
    const out = execOne(bot, row, this.core, instr, this.ctx)
    if (out === EXEC_KILLED) {
      // A killed process's row is as it was, so `ip` is the killer.
      q.shift()
      const reason = this.ctx.reason
      this.events.death(c, bot.index, r, ip, reason)
      if (q.size === 0) {
        bot.stats.deathCycle = c
        bot.stats.deathReason = reason
        this.living--
        this.events.botDead(c, bot.index)
      }
    } else if (out === EXEC_SPAWN) {
      // The child copies the parent, whose IP is already past the SPL, and queues ahead of it.
      const child = q.push()
      const childRow = q.rows[child] as ProcRow
      childRow.set(row)
      childRow[IP] = this.ctx.target
      q.rotate()
      if (q.size > bot.stats.peakProcs) bot.stats.peakProcs = q.size
      this.events.spawn(c, bot.index, child, this.ctx.target)
    } else {
      q.rotate()
    }
  }
}

/** `simulate(bots, config) → Result` (ISA §5.6): a whole battle as a pure function. */
export function simulate(bots: readonly LoadedBot[], config: BattleConfigInput = {}): Result {
  // With no bound, run returns only once the battle is over.
  return new Battle(bots, config).run() as Result
}
