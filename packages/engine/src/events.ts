/**
 * The battle's event stream (ISA §5.6): what the renderer, the debugger, and the determinism
 * tests watch. A battle calls its `EventSink` as it runs. Events never change the simulation.
 */
import type { DeathReason } from './exec'

/**
 * Receives a battle's events. Each carries the cycle it happened in. `bot` is the bot's index in
 * submission order. `proc` is the process's row in its bot's queue: it names one process from its
 * spawn to its death, and a later spawn can reuse it.
 *
 * Within a cycle the events come in turn order. A turn is its `exec`, then the instruction's
 * `write`s, then its `spawn` or its `death`, then `botDead` if that death emptied the queue.
 * `cycleEnd` closes the cycle. `exec` comes before the instruction runs, so a sink can still read
 * the instruction and the registers it runs on.
 */
export interface EventSink {
  /** Process `proc` of `bot` executes the `len`-byte instruction at `addr`. */
  exec(cycle: number, bot: number, proc: number, addr: number, len: number): void
  /** `bot` writes `len` bytes (1 or 2) from `addr`, wrapping at 64 KB. */
  write(cycle: number, bot: number, addr: number, len: number): void
  /** An SPL of `bot` starts process `proc` at `addr`. */
  spawn(cycle: number, bot: number, proc: number, addr: number): void
  /** Process `proc` of `bot` dies executing the instruction at `addr`. */
  death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason): void
  /** The last process of `bot` died, so the bot is dead (ISA §5.1). */
  botDead(cycle: number, bot: number): void
  /** Cycle `cycle` is over. The battle's `cycle` already reads `cycle + 1`, and `over` is current. */
  cycleEnd(cycle: number): void
}

/** Records nothing: the sink of a headless battle. Extend it to watch some events only. */
export class NullSink implements EventSink {
  exec(_cycle: number, _bot: number, _proc: number, _addr: number, _len: number): void {}
  write(_cycle: number, _bot: number, _addr: number, _len: number): void {}
  spawn(_cycle: number, _bot: number, _proc: number, _addr: number): void {}
  death(_cycle: number, _bot: number, _proc: number, _addr: number, _reason: DeathReason): void {}
  botDead(_cycle: number, _bot: number): void {}
  cycleEnd(_cycle: number): void {}
}

/** A death reason's code in `RingSink.deaths` is its index here. */
export const DEATH_REASONS: readonly DeathReason[] = ['undefined', 'dat', 'hlt', 'int3', 'div']

/** Fields per `RingSink.execs` record: cycle, bot, proc, addr, len. */
export const EXEC_RECORD = 5
/** Fields per `RingSink.writes` record: cycle, bot, addr, len. */
export const WRITE_RECORD = 4
/** Fields per `RingSink.spawns` record: cycle, bot, proc, addr. */
export const SPAWN_RECORD = 4
/** Fields per `RingSink.deaths` record: cycle, bot, proc, addr, reason (a `DEATH_REASONS` index). */
export const DEATH_RECORD = 5
/** Fields per `RingSink.botDeaths` record: cycle, bot. */
export const BOT_DEAD_RECORD = 2

/**
 * A ring of `capacity` records of `width` uint32 fields, oldest first. When it is full, a new
 * record overwrites the oldest one and counts as dropped.
 */
export class EventRing {
  readonly width: number
  readonly capacity: number
  /** The records: slot `s` holds fields `s * width` to `s * width + width - 1`. */
  readonly data: Uint32Array
  /** The slot of the oldest record. */
  start = 0
  /** The number of records held. */
  length = 0
  /** Records overwritten before a drain read them, since the last drain. */
  dropped = 0

  constructor(width: number, capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`EventRing: capacity must be a positive integer, got ${capacity}`)
    }
    this.width = width
    this.capacity = capacity
    this.data = new Uint32Array(width * capacity)
  }

  /** Makes room for a record at the newest end and returns its offset in `data`. */
  add(): number {
    let s = this.start
    if (this.length === this.capacity) {
      this.start = s + 1 === this.capacity ? 0 : s + 1
      this.dropped++
    } else {
      s += this.length
      if (s >= this.capacity) s -= this.capacity
      this.length++
    }
    return s * this.width
  }

  /** The records held, oldest first, in a new array. Empties the ring and zeroes `dropped`. */
  drain(): Uint32Array {
    const w = this.width
    const out = new Uint32Array(this.length * w)
    const first = Math.min(this.length, this.capacity - this.start)
    out.set(this.data.subarray(this.start * w, (this.start + first) * w))
    out.set(this.data.subarray(0, (this.length - first) * w), first * w)
    this.start = 0
    this.length = 0
    this.dropped = 0
    return out
  }
}

/**
 * Keeps the newest events of each kind in typed-array rings of fixed capacity, which the arena
 * Worker drains once per frame. Records are uint32 fields in the order the `*_RECORD` constants
 * give. A ring that fills drops its oldest records and counts them.
 */
export class RingSink implements EventSink {
  readonly execs: EventRing
  readonly writes: EventRing
  readonly spawns: EventRing
  readonly deaths: EventRing
  readonly botDeaths: EventRing
  /** The last cycle that ended, or -1. */
  lastCycle = -1

  /** Each ring holds `capacity` records. */
  constructor(capacity = 16384) {
    this.execs = new EventRing(EXEC_RECORD, capacity)
    this.writes = new EventRing(WRITE_RECORD, capacity)
    this.spawns = new EventRing(SPAWN_RECORD, capacity)
    this.deaths = new EventRing(DEATH_RECORD, capacity)
    this.botDeaths = new EventRing(BOT_DEAD_RECORD, capacity)
  }

  exec(cycle: number, bot: number, proc: number, addr: number, len: number): void {
    const d = this.execs.data
    const o = this.execs.add()
    d[o] = cycle
    d[o + 1] = bot
    d[o + 2] = proc
    d[o + 3] = addr
    d[o + 4] = len
  }

  write(cycle: number, bot: number, addr: number, len: number): void {
    const d = this.writes.data
    const o = this.writes.add()
    d[o] = cycle
    d[o + 1] = bot
    d[o + 2] = addr
    d[o + 3] = len
  }

  spawn(cycle: number, bot: number, proc: number, addr: number): void {
    const d = this.spawns.data
    const o = this.spawns.add()
    d[o] = cycle
    d[o + 1] = bot
    d[o + 2] = proc
    d[o + 3] = addr
  }

  death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason): void {
    const d = this.deaths.data
    const o = this.deaths.add()
    d[o] = cycle
    d[o + 1] = bot
    d[o + 2] = proc
    d[o + 3] = addr
    d[o + 4] = DEATH_REASONS.indexOf(reason)
  }

  botDead(cycle: number, bot: number): void {
    const d = this.botDeaths.data
    const o = this.botDeaths.add()
    d[o] = cycle
    d[o + 1] = bot
  }

  cycleEnd(cycle: number): void {
    this.lastCycle = cycle
  }
}
