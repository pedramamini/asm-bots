/**
 * What the arena renderers draw (DESIGN_SYSTEM §5), kept on the main thread: a mirror of the core
 * and its owner map built from the Worker's frames (`worker/protocol.ts`), how long ago each byte
 * was written and run, the live processes, the ripples and pulses, and the dead bots' fading
 * territory. The WebGL2 renderer (`gl.ts`) and the 2D one (`canvas2d.ts`) both draw from it, so
 * they draw the same arena.
 *
 * Frames wait in a queue for the next display frame. `advance` ages the glows first and applies
 * the frames after, so a byte a frame touched shows at full brightness in the first image that
 * has it.
 */
import { CORE_SIZE, SPAWN_RECORD } from '@asmbots/engine'
import { BOT_DEATH_FIELDS, DEATH_FIELDS, type FrameMessage } from '../worker/protocol'

/** Cells per row, and rows: the core is 256 rows of 256 bytes. */
export const SIDE = 256

/** An owned byte's share of its bot's hue over the black arena: non-zero, and zero (DESIGN_SYSTEM §5). */
export const OWNED = 0.55
export const OWNED_ZERO = 0.22

/** The most an age counts to, ms: a byte never touched, or touched long ago. */
export const AGE_MAX = 0xffff

/** The write flash fades as `exp(-age / WRITE_FADE_MS)` (DESIGN_SYSTEM §5). */
export const WRITE_FADE_MS = 220
/** The exec trail fades as `exp(-age / EXEC_FADE_MS)`. */
export const EXEC_FADE_MS = 600
/** From this age on a glow draws nothing: the exec trail is under 1/512 by then. */
export const GLOW_MS = 3750

/** A process death's ring ripple, ms. */
export const RIPPLE_MS = 300
/** A spawn's outward pulse, ms. */
export const PULSE_MS = 200
/** A dead bot's territory loses this share of its saturation… */
export const BOT_FADE = 0.4
/** …over this long, ms. */
export const BOT_FADE_MS = 800

/** With bots isolated, the other bots' territory, glows, and processes keep this share of light. */
export const ISOLATE_DIM = 0.2

/** In `ArenaScene.writtenAt`: no write seen since the last full frame. */
export const NOT_SEEN = 0xffff_ffff

/** The most ripples and pulses alive at once. Past it, a new one takes the oldest one's place. */
export const EFFECT_CAPACITY = 256
/** Fields per effect in `ArenaScene.effects`: column, row, start (ms after `epoch`), code. */
export const EFFECT_FIELDS = 4
/** An effect's kind, in bits 8.. of its code; the bot's index is in bits 0..7. */
export const RIPPLE = 0
export const PULSE = 1

/** The frames a hidden page may queue before they are applied without waiting for a display. */
const MAX_PENDING = 64

/** Owner tags: 0 for nobody, else bot index + 1 (ISA §5.4). */
const TAGS = 256

/**
 * The arena as the renderers draw it. Give it each frame with `apply`; each display frame, call
 * `advance` and draw what it holds. The `*Version` counters say what changed since a renderer
 * last looked: a renderer uploads a texture again only when its version moved.
 */
export class ArenaScene {
  /** The core as of the last frame applied. */
  readonly bytes = new Uint8Array(CORE_SIZE)
  /** Each byte's owner tag: 0 for nobody, else bot index + 1. */
  readonly owner = new Uint8Array(CORE_SIZE)
  /** Bit `a & 7` of byte `a >> 3` is set when byte `a` of the core is non-zero. */
  readonly nonZero = new Uint8Array(CORE_SIZE >> 3)
  /** ms since each byte was last written, up to `AGE_MAX`. */
  readonly writeAge = new Uint16Array(CORE_SIZE).fill(AGE_MAX)
  /** ms since each byte was last run, up to `AGE_MAX`. */
  readonly execAge = new Uint16Array(CORE_SIZE).fill(AGE_MAX)
  /** The live processes of the last frame: (IP, bot | `IP_FRONT`) pairs, as `FrameMessage.ips`. */
  ips: Uint16Array = new Uint16Array(0)
  /** Per owner tag: the share of its hue's saturation lost, 0 while alive, `BOT_FADE` when dead. */
  readonly fade = new Float32Array(TAGS)
  /** Per owner tag: the share of light it keeps: 1, or `ISOLATE_DIM` when others are isolated. */
  readonly dim = new Float32Array(TAGS).fill(1)
  /**
   * The cycle of each byte's last write since the last full frame, or `NOT_SEEN`: the hover
   * tooltip's "written 412 cycles ago".
   */
  readonly writtenAt = new Uint32Array(CORE_SIZE).fill(NOT_SEEN)
  /** The cycle of the last full frame: `writtenAt` knows no write before it. */
  seenSince = 0
  /**
   * The ripples and pulses: `EFFECT_FIELDS` floats each (column, row, start, code). Slots at and
   * past `effectCount` are unused; a slot whose effect has ended stays until a new one takes it.
   */
  readonly effects = new Float32Array(EFFECT_CAPACITY * EFFECT_FIELDS)
  effectCount = 0
  /** The battle's cycle as of the last frame applied. */
  cycle = 0

  /** The owner map, the bytes, or the non-zero bits changed. */
  coreVersion = 0
  /** An age changed. */
  ageVersion = 0
  /** A bot's fade changed. */
  fadeVersion = 0
  /** The isolation changed. */
  dimVersion = 0
  /** The processes changed. */
  ipsVersion = 0
  /** An effect was added or cleared. */
  effectVersion = 0
  /** A full frame (a load, a new round, a seek) replaced the whole core. */
  fullVersion = 0
  /** Bumped with each frame applied: what the hover tooltip redraws on. */
  frameVersion = 0

  /**
   * The bytes `advance` touched: those a frame wrote or ran. `changed[0..changedCount)`, each
   * once, until the next `advance`. The 2D renderer repaints them; a full frame lists none.
   */
  readonly changed = new Uint16Array(CORE_SIZE)
  changedCount = 0

  /** The clock `effects` count from, ms: a float32 keeps whole ms for hours after it. */
  readonly epoch: number

  private pending: FrameMessage[] = []
  private reduced = false
  /** The `now` of the last `advance`: the moment the image on screen shows. */
  private advancedAt = Number.NEGATIVE_INFINITY
  /** When the ages last advanced, ms, and the fraction of a ms they have yet to count. */
  private agedAt = Number.NaN
  private carry = 0
  /** Until when a glow, an effect, or a bot's fade still moves, ms. */
  private glowUntil = Number.NEGATIVE_INFINITY
  private effectsUntil = Number.NEGATIVE_INFINITY
  private fadeUntil = Number.NEGATIVE_INFINITY
  /** Per owner tag: when the bot died (ms), -Infinity for faded from the start, NaN if alive. */
  private readonly deadAt = new Float64Array(TAGS).fill(Number.NaN)
  private nextEffect = 0
  private readonly changedStamp = new Uint32Array(CORE_SIZE)
  private stamp = 0
  private readonly listeners = new Set<() => void>()

  constructor(epoch = 0) {
    this.epoch = epoch
  }

  /** Queues a frame for the next `advance`. */
  apply(frame: FrameMessage): void {
    this.pending.push(frame)
    // A hidden page draws nothing, so nothing advances: keep the queue short without it.
    if (this.pending.length > MAX_PENDING) {
      const now = Number.isFinite(this.advancedAt) ? this.advancedAt : this.epoch
      this.applyFrame(this.pending.shift() as FrameMessage, now)
    }
  }

  /**
   * Isolates `bots` (PRODUCT_SPEC §2): every other bot, and the bytes nobody owns, keep
   * `ISOLATE_DIM` of their light. None, or null, isolates nobody.
   */
  isolate(bots: readonly number[] | null): void {
    const on = bots !== null && bots.length > 0
    const next = new Float32Array(TAGS).fill(on ? ISOLATE_DIM : 1)
    if (on) for (const bot of bots) if (bot >= 0 && bot < TAGS - 1) next[bot + 1] = 1
    if (next.every((v, tag) => v === this.dim[tag])) return
    this.dim.set(next)
    this.dimVersion++
  }

  /** With reduced motion (DESIGN_SYSTEM §8): no ripples or pulses, and dead bots fade at once. */
  get reducedMotion(): boolean {
    return this.reduced
  }

  set reducedMotion(reduced: boolean) {
    if (reduced === this.reduced) return
    this.reduced = reduced
    if (!reduced) return
    this.clearEffects()
    for (let tag = 1; tag < TAGS; tag++) {
      if (!Number.isNaN(this.deadAt[tag] as number)) this.deadAt[tag] = Number.NEGATIVE_INFINITY
    }
    this.fadeUntil = Number.NEGATIVE_INFINITY
    this.fadeAll(Number.POSITIVE_INFINITY)
  }

  /**
   * Brings the scene to `now` (ms, the clock of `performance.now()`): ages every glow by the time
   * since the last call, then applies the queued frames, then moves the dead bots' fade. Returns
   * whether the image differs from the last one: a frame came, or the last image caught a glow,
   * an effect, or a fade still on its way out.
   */
  advance(now: number): boolean {
    this.stamp++
    this.changedCount = 0
    const moving =
      this.advancedAt < Math.max(this.glowUntil, this.effectsUntil, this.fadeUntil) ||
      this.pending.length > 0
    this.age(now)
    const applied = this.pending.length > 0
    for (const frame of this.pending) this.applyFrame(frame, now)
    this.pending = []
    this.fadeAll(now)
    this.advancedAt = now
    if (applied) for (const listener of this.listeners) listener()
    return moving
  }

  /**
   * Calls `listener` after each `advance` that applies a frame: the scene then holds a new state of
   * the core. Returns what stops it.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** An effect's start as the renderers read it: ms after `epoch`. */
  time(now: number): number {
    return now - this.epoch
  }

  private age(now: number): void {
    const prev = this.agedAt
    if (Number.isNaN(prev)) {
      this.agedAt = now
      return
    }
    const dt = now - prev + this.carry
    if (dt <= 0) return
    this.agedAt = now
    const step = Math.floor(dt)
    this.carry = dt - step
    // Aged past `glowUntil` already: every age is past `GLOW_MS`, and none shows or needs to count.
    if (step === 0 || prev > this.glowUntil) return
    ageAll(this.writeAge, step)
    ageAll(this.execAge, step)
    this.ageVersion++
  }

  private applyFrame(frame: FrameMessage, now: number): void {
    this.frameVersion++
    this.cycle = frame.cycle
    this.ips = frame.ips
    this.ipsVersion++
    if (frame.ownerDirty !== null) {
      this.applyFull(frame)
      return
    }
    this.applyWrites(frame, now)
    this.applyExecs(frame.execs, now)
    if (!this.reduced) {
      // Deaths last: when a frame brings more than the pool holds, its ripples survive.
      this.addEffects(frame.spawns, SPAWN_RECORD, PULSE, PULSE_MS, now)
      this.addEffects(frame.deaths, DEATH_FIELDS, RIPPLE, RIPPLE_MS, now)
    }
    const dead = frame.botDeaths
    for (let i = 0; i < dead.length; i += BOT_DEATH_FIELDS) {
      this.deadAt[(dead[i + 1] as number) + 1] = this.reduced ? Number.NEGATIVE_INFINITY : now
      if (!this.reduced) this.fadeUntil = Math.max(this.fadeUntil, now + BOT_FADE_MS)
    }
  }

  private applyFull(frame: FrameMessage): void {
    const owner = frame.ownerDirty as Uint8Array
    this.owner.set(owner)
    if (frame.bytesDirty !== null) this.bytes.set(frame.bytesDirty)
    const { bytes, nonZero } = this
    nonZero.fill(0)
    for (let a = 0; a < CORE_SIZE; a++) {
      if (bytes[a] !== 0) nonZero[a >> 3] = (nonZero[a >> 3] as number) | (1 << (a & 7))
    }
    this.writeAge.fill(AGE_MAX)
    this.execAge.fill(AGE_MAX)
    this.writtenAt.fill(NOT_SEEN)
    this.seenSince = frame.cycle
    this.glowUntil = Number.NEGATIVE_INFINITY
    this.clearEffects()
    // The renderer starts over from a full frame: a bot dead by now is faded already.
    this.deadAt.fill(Number.NaN)
    const dead = frame.botDeaths
    for (let i = 0; i < dead.length; i += BOT_DEATH_FIELDS) {
      this.deadAt[(dead[i + 1] as number) + 1] = Number.NEGATIVE_INFINITY
    }
    this.fadeUntil = Number.NEGATIVE_INFINITY
    this.fadeAll(Number.POSITIVE_INFINITY)
    this.coreVersion++
    this.ageVersion++
    this.fullVersion++
  }

  private applyWrites({ writes, writeCycles, cycle }: FrameMessage, now: number): void {
    if (writes.length === 0) return
    const { bytes, owner, nonZero, writeAge, writtenAt } = this
    for (let i = 0; i < writes.length; i += 2) {
      const a = writes[i] as number
      const cell = writes[i + 1] as number
      // A frame without write cycles (a test's) wrote at its last cycle.
      writtenAt[a] = writeCycles[i >> 1] ?? cycle - 1
      const byte = cell & 0xff
      bytes[a] = byte
      owner[a] = cell >> 8
      const bit = 1 << (a & 7)
      nonZero[a >> 3] =
        byte === 0 ? (nonZero[a >> 3] as number) & ~bit : (nonZero[a >> 3] as number) | bit
      writeAge[a] = 0
      this.touch(a)
    }
    this.glowUntil = now + GLOW_MS
    this.coreVersion++
    this.ageVersion++
  }

  private applyExecs(execs: Uint16Array, now: number): void {
    if (execs.length === 0) return
    const { execAge } = this
    for (let i = 0; i < execs.length; i += 2) {
      const a = execs[i] as number
      execAge[a] = 0
      this.touch(a)
    }
    this.glowUntil = now + GLOW_MS
    this.ageVersion++
  }

  private touch(a: number): void {
    if (this.changedStamp[a] === this.stamp) return
    this.changedStamp[a] = this.stamp
    this.changed[this.changedCount++] = a
  }

  /** Adds one effect per record of `records`: the newest `EFFECT_CAPACITY` at most. */
  private addEffects(
    records: Uint32Array,
    width: number,
    kind: number,
    life: number,
    now: number,
  ): void {
    const count = records.length / width
    if (count === 0) return
    const start = this.time(now)
    // A record's bot is its field 1 and its address its field 3 (SPAWN_RECORD, DEATH_FIELDS).
    for (let n = Math.max(0, count - EFFECT_CAPACITY); n < count; n++) {
      const o = n * width
      const a = records[o + 3] as number
      const e = this.nextEffect * EFFECT_FIELDS
      this.effects[e] = a & 0xff
      this.effects[e + 1] = a >> 8
      this.effects[e + 2] = start
      this.effects[e + 3] = (kind << 8) | ((records[o + 1] as number) & 0xff)
      this.nextEffect = (this.nextEffect + 1) % EFFECT_CAPACITY
    }
    this.effectCount = Math.min(EFFECT_CAPACITY, this.effectCount + count)
    this.effectsUntil = Math.max(this.effectsUntil, now + life)
    this.effectVersion++
  }

  private clearEffects(): void {
    if (this.effectCount === 0) return
    this.effectCount = 0
    this.nextEffect = 0
    this.effectsUntil = Number.NEGATIVE_INFINITY
    this.effectVersion++
  }

  /** Sets each tag's fade as of `now`; bumps `fadeVersion` when one moved. */
  private fadeAll(now: number): void {
    let moved = false
    for (let tag = 1; tag < TAGS; tag++) {
      const at = this.deadAt[tag] as number
      const f = Number.isNaN(at) ? 0 : BOT_FADE * Math.min(1, Math.max(0, (now - at) / BOT_FADE_MS))
      if (this.fade[tag] !== Math.fround(f)) {
        this.fade[tag] = f
        moved = true
      }
    }
    if (moved) this.fadeVersion++
  }
}

/** Adds `step` ms to each age, holding at `AGE_MAX`. */
function ageAll(ages: Uint16Array, step: number): void {
  const limit = AGE_MAX - step
  for (let i = 0; i < ages.length; i++) {
    const v = ages[i] as number
    ages[i] = v >= limit ? AGE_MAX : v + step
  }
}

/** Whether byte `a` of the core is non-zero, from `ArenaScene.nonZero`. */
export function isNonZero(nonZero: Uint8Array, a: number): boolean {
  return (((nonZero[a >> 3] as number) >> (a & 7)) & 1) === 1
}
