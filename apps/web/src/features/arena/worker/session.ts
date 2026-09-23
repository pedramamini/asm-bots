/**
 * The arena Worker's state (ARCHITECTURE §6): one battle, the sink that gathers its events a frame
 * at a time, and the keyframes a seek restores. `arena.worker.ts` hands it each request and posts
 * what it returns, so all of this runs, and is tested, without a Worker.
 */
import {
  ADDR_MASK,
  Battle,
  type BattleConfigInput,
  CORE_SIZE,
  type Core,
  type DeathReason,
  type EventSink,
  IP,
  type LoadedBot,
  MAX_BOTS,
  NullSink,
  type ProcRow,
  RingSink,
  restore,
  resultHash,
  type Snapshot,
  snapshot,
} from '@asmbots/engine'
import {
  type ArenaBot,
  type ArenaMessage,
  type ArenaRequest,
  DEFAULT_SPEED,
  EVENT_CAPACITY,
  FRAME_BUDGET_MS,
  type FrameMessage,
  IP_FRONT,
  isSpeed,
  KEYFRAME_INTERVAL,
  type LoadedMessage,
  MAX_CYCLES_PER_FRAME,
  MAX_KEYFRAMES,
  type Speed,
  STAT_FIELDS,
  STAT_FOOTPRINT,
  STAT_PROCS,
  STAT_WRITES,
} from './protocol'

/** Cycles run between two looks at the clock when a frame has a budget. */
const CHUNK_CYCLES = 256

/** The sink of a seek, which runs forward without a word. */
const SILENT = new NullSink()

/**
 * The session's event sink. Spawns, deaths, and bot deaths go to the `RingSink`, which the session
 * drains once a frame. Executes and writes come too fast for rings (16 bots at 2,000 cycles a frame
 * make 32,000 of each), and the renderer needs only the bytes they touched, so the sink marks
 * bytes instead: each byte once a frame, however often it is touched.
 */
export class FrameSink implements EventSink {
  /** Spawns, deaths, and bot deaths. Its exec and write rings stay empty. */
  readonly rings = new RingSink(EVENT_CAPACITY)
  /** The bytes written this frame, in the order first written: `written[0..writeCount)`. */
  readonly written = new Uint16Array(CORE_SIZE)
  writeCount = 0
  /** The bytes run this frame, in the order first run: `executed[0..execCount)`. */
  readonly executed = new Uint16Array(CORE_SIZE)
  execCount = 0
  /** The bot that last ran each byte this frame. */
  readonly execBot = new Uint8Array(CORE_SIZE)
  /** The frame number. A byte is marked this frame when its stamp holds it, so it is never 0. */
  private frame = 1
  private readonly writeStamp = new Uint32Array(CORE_SIZE)
  private readonly execStamp = new Uint32Array(CORE_SIZE)

  exec(_cycle: number, bot: number, _proc: number, addr: number, len: number): void {
    const stamp = this.execStamp
    const frame = this.frame
    for (let k = 0; k < len; k++) {
      const a = (addr + k) & ADDR_MASK
      if (stamp[a] !== frame) {
        stamp[a] = frame
        this.executed[this.execCount++] = a
      }
      this.execBot[a] = bot
    }
  }

  write(_cycle: number, _bot: number, addr: number, len: number): void {
    const stamp = this.writeStamp
    const frame = this.frame
    for (let k = 0; k < len; k++) {
      const a = (addr + k) & ADDR_MASK
      if (stamp[a] !== frame) {
        stamp[a] = frame
        this.written[this.writeCount++] = a
      }
    }
  }

  spawn(cycle: number, bot: number, proc: number, addr: number): void {
    this.rings.spawn(cycle, bot, proc, addr)
  }

  death(cycle: number, bot: number, proc: number, addr: number, reason: DeathReason): void {
    this.rings.death(cycle, bot, proc, addr, reason)
  }

  botDead(cycle: number, bot: number): void {
    this.rings.botDead(cycle, bot)
  }

  cycleEnd(cycle: number): void {
    this.rings.cycleEnd(cycle)
  }

  /** Starts a frame: forgets the marked bytes and empties the rings. */
  next(): void {
    this.frame++
    this.writeCount = 0
    this.execCount = 0
    for (const ring of [this.rings.spawns, this.rings.deaths, this.rings.botDeaths]) {
      ring.start = 0
      ring.length = 0
      ring.dropped = 0
    }
  }
}

function fail(message: string): never {
  throw new RangeError(message)
}

function checkCount(name: string, v: number, max: number): number {
  if (!Number.isInteger(v) || v < 0 || v > max) fail(`${name} must be an integer in 0..${max}`)
  return v
}

function checkSpeed(speed: Speed): Speed {
  if (!isSpeed(speed)) fail(`speed must be 1..${MAX_CYCLES_PER_FRAME} cycles per frame, or max`)
  return speed
}

/**
 * One arena battle and its playback. Every request that moves the battle ends in a frame. Cycles
 * run with the sink attached are the frame's activity. A full frame (a load, a new round, a seek)
 * sends the whole core instead.
 *
 * Seeking: every `KEYFRAME_INTERVAL` cycles the session keeps a snapshot, `MAX_KEYFRAMES` at most.
 * Past the cap it drops the keyframe farthest from the cycle just kept, so the keyframes follow the
 * playhead: when the battle runs forward that is the oldest. A seek restores the nearest keyframe
 * at or before its target (a fresh battle when there is none) and runs forward from it with the
 * events off. A seek ahead of the battle runs on from where the battle is, unless a keyframe is
 * nearer.
 */
export class ArenaSession {
  private bots: readonly LoadedBot[] = []
  private config: BattleConfigInput = {}
  private battle: Battle | null = null
  private readonly sink = new FrameSink()
  private readonly keyframes = new Map<number, Snapshot>()
  /** The owner map as the last frame left it, so a frame counts footprints from its writes. */
  private readonly shadow = new Uint8Array(CORE_SIZE)
  /** Bytes owned per owner tag, as of `shadow`. */
  private readonly owned = new Uint32Array(MAX_BOTS + 1)
  private playing = false
  private speed: Speed = DEFAULT_SPEED
  /** Whether `ended` went out for the battle's end. A frame before the end clears it. */
  private endedSent = false
  private readonly now: () => number

  /** `now` is the clock of the frame budget, ms. */
  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  /** Answers one request with the messages to post, in order. A failure is an `error` message. */
  handle(request: ArenaRequest): ArenaMessage[] {
    try {
      return this.answer(request)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return [{ type: 'error', request: request.type, message }]
    }
  }

  /** The cycles of the keyframes held, ascending. */
  keyframeCycles(): number[] {
    return [...this.keyframes.keys()].sort((a, b) => a - b)
  }

  private answer(request: ArenaRequest): ArenaMessage[] {
    switch (request.type) {
      case 'load':
        return this.load(request.bots, request.config)
      case 'setRound':
        return this.setRound(request.seed)
      case 'play':
        this.playing = !this.current().over
        return []
      case 'pause':
        this.playing = false
        return []
      case 'speed':
        this.speed = checkSpeed(request.cyclesPerFrame)
        return []
      case 'step': {
        const battle = this.current()
        const cycles = checkCount('step: cycles', request.cycles, 0xffffffff)
        this.advance(battle, battle.cycle + cycles, Number.POSITIVE_INFINITY)
        return this.frame(false)
      }
      case 'seek':
        return this.seek(checkCount('seek: cycle', request.cycle, 0xffffffff))
      case 'requestFrame':
        return this.requestFrame()
    }
  }

  private current(): Battle {
    return this.battle ?? fail('no battle: load one first')
  }

  private load(bots: readonly ArenaBot[], config: BattleConfigInput): ArenaMessage[] {
    const loaded = bots.map(({ name, bytes, meta }) => ({ name, bytes, meta }))
    // Throws for a bad config or bot, and when the bots do not fit: the old battle stays.
    this.start(new Battle(loaded, config, this.sink), loaded, { ...config })
    return [this.loaded(), ...this.frame(true)]
  }

  private setRound(seed: number): ArenaMessage[] {
    this.current()
    const config = { ...this.config, seed }
    this.start(new Battle(this.bots, config, this.sink), this.bots, config)
    return [this.loaded(), ...this.frame(true)]
  }

  private start(battle: Battle, bots: readonly LoadedBot[], config: BattleConfigInput): void {
    this.battle = battle
    this.bots = bots
    this.config = config
    this.keyframes.clear()
    this.playing = false
    this.endedSent = false
  }

  private loaded(): LoadedMessage {
    const battle = this.current()
    return {
      type: 'loaded',
      placements: battle.bots.map((b) => ({ base: b.base, size: b.size })),
      botMeta: battle.bots.map((b) => ({ ...b.meta, name: b.name, size: b.size })),
      config: battle.config,
    }
  }

  private requestFrame(): ArenaMessage[] {
    const battle = this.current()
    if (this.playing && !battle.over) {
      const deadline = this.now() + FRAME_BUDGET_MS
      const target =
        this.speed === 'max' ? battle.config.maxCycles : battle.cycle + (this.speed as number)
      this.advance(battle, target, deadline)
    }
    return this.frame(false)
  }

  private seek(cycle: number): ArenaMessage[] {
    let battle = this.current()
    const target = Math.min(cycle, battle.config.maxCycles)
    const key = this.keyframeAtOrBefore(target)
    if (target < battle.cycle || key > battle.cycle) {
      const kept = this.keyframes.get(key)
      battle =
        kept === undefined
          ? new Battle(this.bots, this.config, SILENT)
          : restore(kept, this.bots, this.config, SILENT)
      this.battle = battle
    } else {
      battle.events = SILENT
    }
    this.advance(battle, target, Number.POSITIVE_INFINITY)
    battle.events = this.sink
    return this.frame(true)
  }

  /** The latest keyframe at or before `cycle`: its cycle, or 0 for none (a fresh battle). */
  private keyframeAtOrBefore(cycle: number): number {
    let best = 0
    for (const k of this.keyframes.keys()) if (k <= cycle && k > best) best = k
    return best
  }

  /** Runs until `target` cycles have run, the battle is over, or the clock passes `deadline`. */
  private advance(battle: Battle, target: number, deadline: number): void {
    const timed = deadline !== Number.POSITIVE_INFINITY
    while (battle.cycle < target && !battle.over) {
      const c = battle.cycle
      let next = Math.min(target, (Math.floor(c / KEYFRAME_INTERVAL) + 1) * KEYFRAME_INTERVAL)
      if (timed) next = Math.min(next, c + CHUNK_CYCLES)
      battle.run(next - c)
      this.keep(battle)
      if (timed && this.now() >= deadline) return
    }
  }

  /** Keeps a keyframe when the battle stands on a keyframe cycle it has none for. */
  private keep(battle: Battle): void {
    const c = battle.cycle
    if (c === 0 || c % KEYFRAME_INTERVAL !== 0 || this.keyframes.has(c)) return
    this.keyframes.set(c, snapshot(battle))
    if (this.keyframes.size <= MAX_KEYFRAMES) return
    let far = -1
    let farthest = 0
    for (const k of this.keyframes.keys()) {
      const d = Math.abs(k - c)
      if (d > far || (d === far && k < farthest)) {
        far = d
        farthest = k
      }
    }
    this.keyframes.delete(farthest)
  }

  /** The frame for the battle as it stands, then `ended` when this frame is the first to end it. */
  private frame(full: boolean): ArenaMessage[] {
    const battle = this.current()
    const frame = full ? this.fullFrame(battle) : this.activityFrame(battle)
    this.sink.next()
    if (!battle.over) {
      this.endedSent = false
      return [frame]
    }
    this.playing = false
    if (this.endedSent) return [frame]
    this.endedSent = true
    const result = battle.result()
    return [frame, { type: 'ended', result, hash: resultHash(result) }]
  }

  private fullFrame(battle: Battle): FrameMessage {
    const { bytes, owner } = battle.core
    this.shadow.set(owner)
    this.owned.fill(0)
    for (let a = 0; a < CORE_SIZE; a++) {
      const t = owner[a] as number
      this.owned[t] = (this.owned[t] as number) + 1
    }
    const dead = battle.bots
      .filter((b) => b.stats.deathCycle !== null)
      .sort((a, b) => (a.stats.deathCycle as number) - (b.stats.deathCycle as number))
    return {
      type: 'frame',
      cycle: battle.cycle,
      alive: battle.alive,
      over: battle.over,
      writes: new Uint16Array(0),
      execs: new Uint16Array(0),
      ips: ips(battle),
      spawns: new Uint32Array(0),
      deaths: new Uint32Array(0),
      botDeaths: Uint32Array.from(dead.flatMap((b) => [b.stats.deathCycle as number, b.index])),
      stats: this.stats(battle),
      ownerDirty: owner.slice(),
      bytesDirty: bytes.slice(),
    }
  }

  private activityFrame(battle: Battle): FrameMessage {
    const sink = this.sink
    const { rings } = sink
    // First: it moves the footprints that `stats` reads.
    const writes = this.writes(battle.core)
    return {
      type: 'frame',
      cycle: battle.cycle,
      alive: battle.alive,
      over: battle.over,
      writes,
      execs: execs(sink),
      ips: ips(battle),
      spawns: rings.spawns.drain(),
      deaths: rings.deaths.drain(),
      botDeaths: rings.botDeaths.drain(),
      stats: this.stats(battle),
      ownerDirty: null,
      bytesDirty: null,
    }
  }

  /** The frame's written bytes as (address, cell) pairs. Moves the footprints to their owners. */
  private writes(core: Core): Uint16Array {
    const { written, writeCount } = this.sink
    const { bytes, owner } = core
    const { shadow, owned } = this
    const out = new Uint16Array(writeCount * 2)
    for (let i = 0; i < writeCount; i++) {
      const a = written[i] as number
      const t = owner[a] as number
      out[2 * i] = a
      out[2 * i + 1] = (bytes[a] as number) | (t << 8)
      const was = shadow[a] as number
      if (was !== t) {
        owned[was] = (owned[was] as number) - 1
        owned[t] = (owned[t] as number) + 1
        shadow[a] = t
      }
    }
    return out
  }

  private stats(battle: Battle): Float32Array {
    const out = new Float32Array(battle.bots.length * STAT_FIELDS)
    for (const bot of battle.bots) {
      const o = bot.index * STAT_FIELDS
      out[o + STAT_PROCS] = bot.queue.size
      out[o + STAT_FOOTPRINT] = this.owned[bot.tag] as number
      out[o + STAT_WRITES] = bot.stats.writes
    }
    return out
  }
}

/** The frame's run bytes as (address, bot) pairs. */
function execs(sink: FrameSink): Uint16Array {
  const { executed, execCount, execBot } = sink
  const out = new Uint16Array(execCount * 2)
  for (let i = 0; i < execCount; i++) {
    const a = executed[i] as number
    out[2 * i] = a
    out[2 * i + 1] = execBot[a] as number
  }
  return out
}

/** Each live process as (IP, bot) pairs, each bot's front process flagged `IP_FRONT`. */
function ips(battle: Battle): Uint16Array {
  let n = 0
  for (const bot of battle.bots) n += bot.queue.size
  const out = new Uint16Array(n * 2)
  let o = 0
  for (const bot of battle.bots) {
    const q = bot.queue
    for (let i = 0; i < q.size; i++) {
      out[o++] = (q.rows[q.at(i)] as ProcRow)[IP] as number
      out[o++] = i === 0 ? bot.index | IP_FRONT : bot.index
    }
  }
  return out
}
