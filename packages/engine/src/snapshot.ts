/**
 * Snapshots (ISA §5.6): a battle's whole state between two cycles, as plain data, and the battle
 * rebuilt from it. The debugger steps back with them. The arena seeks with them: it keeps a
 * keyframe every 1,000 cycles, and to seek it restores the nearest keyframe at or before the
 * target and runs forward from there, at most 999 cycles.
 *
 * Size: 128 KB for the core and the owner map, and 22 bytes per process slot per bot (1,408 bytes
 * at the default 64 processes). So a snapshot of two bots is about 131 KB, and the 100 keyframes
 * of a 100,000-cycle battle take about 13 MB.
 */
import type { BattleConfigInput, Bot, BotStats, LoadedBot } from './battle'
import { Battle, RESUME } from './battle'
import { CORE_SIZE } from './core'
import type { EventSink } from './events'
import type { Pcg32State } from './prng'

/** A bot's part of a snapshot. */
export interface BotSnapshot {
  /** A copy of its `queue.data`: the ring of row numbers, then the rows. */
  readonly queue: Uint16Array
  /** Its `queue.head`. */
  readonly head: number
  /** Its `queue.size`, 0 once it is dead. */
  readonly size: number
  /** A copy of its `stats`. */
  readonly stats: Readonly<BotStats>
}

/**
 * A battle's state between two cycles. It holds copies, never views, and only plain data and
 * typed arrays, so `structuredClone` and `postMessage` keep it whole. It leaves out the bots and
 * the config: `restore` takes them again.
 */
export interface Snapshot {
  /** Cycles run: the next cycle to run. */
  readonly cycle: number
  /** A copy of `core.bytes`. */
  readonly core: Uint8Array
  /** A copy of `core.owner`. */
  readonly owner: Uint8Array
  /** One per bot, in submission order. */
  readonly bots: readonly BotSnapshot[]
  /** The placement PRNG's state. */
  readonly prngState: Pcg32State
}

/**
 * Copies `battle`'s state. Take it between two cycles: after `step` or `run` returns, or in the
 * sink's `cycleEnd`. During a cycle, the turns already taken are in the core but the cycle count
 * has not moved, so a restore would run them again.
 */
export function snapshot(battle: Battle): Snapshot {
  return {
    cycle: battle.cycle,
    core: battle.core.bytes.slice(),
    owner: battle.core.owner.slice(),
    bots: battle.bots.map((b) => ({
      queue: b.queue.data.slice(),
      head: b.queue.head,
      size: b.queue.size,
      stats: { ...b.stats },
    })),
    prngState: battle.prng.serialize(),
  }
}

function fail(message: string): never {
  throw new RangeError(`restore: ${message}`)
}

/**
 * The battle that `s` was taken from, at the same cycle. Pass the same bots in the same order and
 * the same seed, `minSpacing`, and `maxProcesses`. `maxCycles` can differ: a smaller one ends the
 * battle sooner, and a larger one runs it longer. `events` works as in the `Battle` constructor.
 * The restore copies `s` and emits no events, so one snapshot restores any number of times.
 *
 * Throws `RangeError` when `s` does not fit the bots and the config. Nothing draws from the
 * placement PRNG after placement, so a PRNG state that differs from a fresh placement's means
 * another seed or other bots.
 */
export function restore(
  s: Snapshot,
  bots: readonly LoadedBot[],
  config: BattleConfigInput = {},
  events?: EventSink,
): Battle {
  const battle = new Battle(bots, config, events)
  const n = battle.bots.length
  if (s.bots.length !== n) fail(`the snapshot holds ${s.bots.length} bots, not ${n}`)
  const placed = battle.prng.serialize()
  const saved = s.prngState
  if (!Array.isArray(saved) || saved.length !== 4 || placed.some((v, k) => v !== saved[k])) {
    fail('the snapshot comes from another seed, other bot sizes, or another minSpacing')
  }
  if (s.core.length !== CORE_SIZE || s.owner.length !== CORE_SIZE) {
    fail(`the core and the owner map must be ${CORE_SIZE} bytes`)
  }
  if (!Number.isInteger(s.cycle) || s.cycle < 0 || s.cycle > 0xffffffff) {
    fail(`the cycle must be an integer in 0..${0xffffffff}, got ${s.cycle}`)
  }
  s.bots.forEach((b, i) => {
    const q = (battle.bots[i] as Bot).queue
    if (b.queue.length !== q.data.length) {
      fail(`bot ${i}'s queue does not hold ${q.capacity} processes: another maxProcesses`)
    }
    const headOk = Number.isInteger(b.head) && b.head >= 0 && b.head < q.capacity
    if (!headOk || !Number.isInteger(b.size) || b.size < 0 || b.size > q.capacity) {
      fail(`bot ${i}'s queue head ${b.head} or size ${b.size} is out of range`)
    }
  })

  battle.core.bytes.set(s.core)
  battle.core.owner.set(s.owner)
  battle.bots.forEach((bot, i) => {
    const b = s.bots[i] as BotSnapshot
    bot.queue.data.set(b.queue)
    bot.queue.head = b.head
    bot.queue.size = b.size
    // Field by field, so the stats object keeps its shape and takes no stray keys.
    const t = bot.stats
    t.cycles = b.stats.cycles
    t.writes = b.stats.writes
    t.peakProcs = b.stats.peakProcs
    t.deathCycle = b.stats.deathCycle
    t.deathReason = b.stats.deathReason
  })
  battle[RESUME](s.cycle)
  return battle
}
