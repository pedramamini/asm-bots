/**
 * The arena Worker's state (ARCHITECTURE §6): one match, the battle of its current round, the
 * sink that gathers the battle's events a frame at a time, and the keyframes a seek restores.
 * `arena.worker.ts` hands it each request and posts what it returns, so all of this runs, and is
 * tested, without a Worker.
 */
import {
  ADDR_MASK,
  Battle,
  type BattleConfigInput,
  BOT_DEAD_RECORD,
  type Bot,
  CORE_SIZE,
  type Core,
  DEATH_REASONS,
  DEFAULT_CONFIG,
  type DeathReason,
  EventRing,
  type EventSink,
  IP,
  type LoadedBot,
  MAX_BOTS,
  NullSink,
  type ProcRow,
  restore,
  type Snapshot,
  SPAWN_RECORD,
  snapshot,
} from '@asmbots/engine'
import {
  type MatchResult,
  newMatch,
  roundOrder,
  roundResult,
  roundSeed,
  runMatch,
  withRound,
} from '@asmbots/tourney'
import {
  type ArenaBot,
  type ArenaMessage,
  type ArenaRequest,
  BOT_DEATH_FIELDS,
  DEATH_FIELDS,
  DEFAULT_SPEED,
  EVENT_CAPACITY,
  type FirstBlood,
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

/**
 * What a round's deaths tell, whichever sink the battle ran with: its first blood, and the killer
 * of each bot's last process. A seek's silent sink reports here too, so a battle that a seek ran
 * past a death still knows it. Bots are the battle's: in fighting order.
 */
export class DeathWatch {
  /** The owner map of the battle running: a death's killer owns the byte the process ran. */
  owner: Uint8Array = new Uint8Array(CORE_SIZE)
  /** The round's first blood, or null. A replay after a seek back finds it again, the same. */
  firstBlood: FirstBlood | null = null
  /** Per bot: the killer tag of its last process, once the bot is dead. */
  readonly botKiller = new Uint8Array(MAX_BOTS)
  /** The killer tag of the last death reported. */
  private last = 0

  /** A new round, on `owner`: no blood yet. */
  reset(owner: Uint8Array): void {
    this.owner = owner
    this.firstBlood = null
    this.botKiller.fill(0)
  }

  /** A process of `bot` died in `cycle` running the byte at `addr`. Returns the killer tag. */
  death(cycle: number, bot: number, addr: number): number {
    const killer = this.owner[addr] as number
    if (this.firstBlood === null && killer !== 0 && killer !== bot + 1) {
      this.firstBlood = { cycle, killer: killer - 1, victim: bot }
    }
    this.last = killer
    return killer
  }

  /** The death just reported emptied `bot`'s queue. */
  botDead(bot: number): void {
    this.botKiller[bot] = this.last
  }
}

/** The sink of a seek, which runs forward without a frame's events: deaths go to the watch. */
class SeekSink extends NullSink {
  private readonly watch: DeathWatch

  constructor(watch: DeathWatch) {
    super()
    this.watch = watch
  }

  override death(cycle: number, bot: number, _proc: number, addr: number): void {
    this.watch.death(cycle, bot, addr)
  }

  override botDead(_cycle: number, bot: number): void {
    this.watch.botDead(bot)
  }
}

/**
 * The session's event sink. Spawns, deaths, and bot deaths go to rings of records, which the
 * session drains once a frame. Executes and writes come too fast for rings (16 bots at 2,000
 * cycles a frame make 32,000 of each), and the renderer needs only the bytes they touched, so the
 * sink marks bytes instead: each byte once a frame, however often it is touched.
 */
export class FrameSink implements EventSink {
  /** `SPAWN_RECORD` fields each: cycle, bot, proc, address. */
  readonly spawns = new EventRing(SPAWN_RECORD, EVENT_CAPACITY)
  /** `DEATH_FIELDS` fields each: cycle, bot, proc, address, reason, killer tag. */
  readonly deaths = new EventRing(DEATH_FIELDS, EVENT_CAPACITY)
  /** `BOT_DEAD_RECORD` fields each: cycle, bot. */
  readonly botDeaths = new EventRing(BOT_DEAD_RECORD, EVENT_CAPACITY)
  /** The bytes written this frame, in the order first written: `written[0..writeCount)`. */
  readonly written = new Uint16Array(CORE_SIZE)
  writeCount = 0
  /** The cycle of each byte's last write this frame. */
  readonly writeCycle = new Uint32Array(CORE_SIZE)
  /** The bytes run this frame, in the order first run: `executed[0..execCount)`. */
  readonly executed = new Uint16Array(CORE_SIZE)
  execCount = 0
  /** The bot that last ran each byte this frame. */
  readonly execBot = new Uint8Array(CORE_SIZE)
  readonly watch: DeathWatch
  /** The frame number. A byte is marked this frame when its stamp holds it, so it is never 0. */
  private frame = 1
  private readonly writeStamp = new Uint32Array(CORE_SIZE)
  private readonly execStamp = new Uint32Array(CORE_SIZE)

  constructor(watch: DeathWatch = new DeathWatch()) {
    this.watch = watch
  }

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

  write(cycle: number, _bot: number, addr: number, len: number): void {
    const stamp = this.writeStamp
    const frame = this.frame
    for (let k = 0; k < len; k++) {
      const a = (addr + k) & ADDR_MASK
      if (stamp[a] !== frame) {
        stamp[a] = frame
        this.written[this.writeCount++] = a
      }
      this.writeCycle[a] = cycle
    }
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
    const killer = this.watch.death(cycle, bot, addr)
    const d = this.deaths.data
    const o = this.deaths.add()
    d[o] = cycle
    d[o + 1] = bot
    d[o + 2] = proc
    d[o + 3] = addr
    d[o + 4] = DEATH_REASONS.indexOf(reason)
    d[o + 5] = killer
  }

  botDead(cycle: number, bot: number): void {
    this.watch.botDead(bot)
    const d = this.botDeaths.data
    const o = this.botDeaths.add()
    d[o] = cycle
    d[o + 1] = bot
  }

  cycleEnd(_cycle: number): void {}

  /** Starts a frame: forgets the marked bytes and empties the rings. */
  next(): void {
    this.frame++
    this.writeCount = 0
    this.execCount = 0
    for (const ring of [this.spawns, this.deaths, this.botDeaths]) {
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
 * One arena match and its playback. Every request that moves the battle ends in a frame. Cycles
 * run with the sink attached are the frame's activity. A full frame (a load, a new round, a seek)
 * sends the whole core instead.
 *
 * Rounds: round i of the match is a battle of the bots in `roundOrder` placed with `roundSeed`,
 * the battle `iterateMatch` runs for it, and its end goes into the match with `withRound`, so the
 * match comes out as `runMatch` scores it. The frames map the battle's bots and owner tags back
 * to the bots' places in the load.
 *
 * Seeking: every `KEYFRAME_INTERVAL` cycles the session keeps a snapshot, `MAX_KEYFRAMES` at most.
 * Past the cap it drops the keyframe farthest from the cycle just kept, so the keyframes follow the
 * playhead: when the battle runs forward that is the oldest. A seek restores the nearest keyframe
 * at or before its target (a fresh battle when there is none) and runs forward from it with the
 * frame's events off. A seek ahead of the battle runs on from where the battle is, unless a
 * keyframe is nearer.
 */
export class ArenaSession {
  /** The match's bots, in the load's order. */
  private entrants: readonly LoadedBot[] = []
  /** The match's config: round i's seed is its seed plus i. */
  private matchConfig: BattleConfigInput = {}
  private match: MatchResult | null = null
  private round = 0
  /** The round's bots, in fighting order, and its config. */
  private bots: readonly LoadedBot[] = []
  private config: BattleConfigInput = {}
  /** The round's fighting order: `order[j]` is the load's bot j-th in the battle. */
  private order: readonly number[] = []
  /** Per battle bot: its place in the load. */
  private readonly entrantOf = new Uint8Array(MAX_BOTS)
  /** Per bot in the load: its index in the battle. */
  private readonly battleOf = new Uint8Array(MAX_BOTS)
  /** Per battle owner tag: the tag of the same bot in the load. */
  private readonly tagOut = new Uint8Array(MAX_BOTS + 1)
  private battle: Battle | null = null
  private readonly watch = new DeathWatch()
  private readonly sink = new FrameSink(this.watch)
  private readonly silent = new SeekSink(this.watch)
  private readonly keyframes = new Map<number, Snapshot>()
  /** Whether the keyframes changed since the last frame. */
  private keyframesMoved = true
  /** The owner map as the last frame left it, so a frame counts footprints from its writes. */
  private readonly shadow = new Uint8Array(CORE_SIZE)
  /** Bytes owned per battle owner tag, as of `shadow`. */
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
        return this.load(request.bots, request.config, request.rounds ?? 1)
      case 'setRound':
        return this.setRound(request.round)
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
      case 'match': {
        const bots = request.bots.map(({ name, bytes, meta }) => ({ name, bytes, meta }))
        return [{ type: 'match', match: runMatch(bots, request.config, request.rounds) }]
      }
    }
  }

  private current(): Battle {
    return this.battle ?? fail('no battle: load one first')
  }

  private load(
    bots: readonly ArenaBot[],
    config: BattleConfigInput,
    rounds: number,
  ): ArenaMessage[] {
    const loaded = bots.map(({ name, bytes, meta }) => ({ name, bytes, meta }))
    // Throws for a bad round count, config, or bot, and when the bots do not fit: the old match
    // and its battle stay.
    const match = newMatch(loaded, config, rounds)
    this.start(loaded, { ...config }, match, 0)
    return [this.loaded(), ...this.frame(true)]
  }

  private setRound(round: number): ArenaMessage[] {
    const match = this.match ?? fail('no battle: load one first')
    checkCount('setRound: round', round, match.of - 1)
    if (round > match.rounds.length) {
      fail(`setRound: round ${round + 1} waits for round ${match.rounds.length + 1} to end`)
    }
    this.start(this.entrants, this.matchConfig, match, round)
    return [this.loaded(), ...this.frame(true)]
  }

  /** Starts round `round` of `match`. Changes nothing when the battle cannot be made. */
  private start(
    entrants: readonly LoadedBot[],
    matchConfig: BattleConfigInput,
    match: MatchResult,
    round: number,
  ): void {
    const order = roundOrder(entrants.length, round)
    const bots = order.map((k) => entrants[k] as LoadedBot)
    const config = {
      ...matchConfig,
      seed: roundSeed(matchConfig.seed ?? DEFAULT_CONFIG.seed, round),
    }
    const battle = new Battle(bots, config, this.sink)
    this.entrants = entrants
    this.matchConfig = matchConfig
    this.match = match
    this.round = round
    this.bots = bots
    this.config = config
    this.order = order
    this.tagOut.fill(0)
    order.forEach((k, j) => {
      this.entrantOf[j] = k
      this.battleOf[k] = j
      this.tagOut[j + 1] = k + 1
    })
    this.battle = battle
    this.watch.reset(battle.core.owner)
    this.keyframes.clear()
    this.keyframesMoved = true
    this.playing = false
    this.endedSent = false
  }

  private loaded(): LoadedMessage {
    const battle = this.current()
    const match = this.match as MatchResult
    const placements = new Array(battle.bots.length)
    const botMeta = new Array(battle.bots.length)
    for (const b of battle.bots) {
      const k = this.entrantOf[b.index] as number
      placements[k] = { base: b.base, size: b.size }
      botMeta[k] = { ...b.meta, name: b.name, size: b.size }
    }
    return {
      type: 'loaded',
      placements,
      botMeta,
      config: battle.config,
      round: this.round,
      rounds: match.of,
      order: [...this.order],
      match,
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
          ? new Battle(this.bots, this.config, this.silent)
          : restore(kept, this.bots, this.config, this.silent)
      this.battle = battle
      this.watch.owner = battle.core.owner
    } else {
      battle.events = this.silent
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
    this.keyframesMoved = true
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

  /**
   * The frame for the battle as it stands, then `ended` when this frame is the first to end it.
   * The round goes into the match at its first ending.
   */
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
    const round = roundResult(battle.config.seed, battle.result())
    let match = this.match as MatchResult
    if (match.rounds.length === this.round) {
      match = withRound(match, round)
      this.match = match
    }
    return [
      frame,
      { type: 'ended', result: round.result, hash: round.resultHash, round: this.round, match },
    ]
  }

  private fullFrame(battle: Battle): FrameMessage {
    const { bytes, owner } = battle.core
    const { tagOut, entrantOf } = this
    this.shadow.set(owner)
    this.owned.fill(0)
    const ownerOut = new Uint8Array(CORE_SIZE)
    for (let a = 0; a < CORE_SIZE; a++) {
      const t = owner[a] as number
      this.owned[t] = (this.owned[t] as number) + 1
      ownerOut[a] = tagOut[t] as number
    }
    const dead = battle.bots
      .filter((b) => b.stats.deathCycle !== null)
      .sort((a, b) => (a.stats.deathCycle as number) - (b.stats.deathCycle as number))
    const botDeaths = new Uint32Array(dead.length * BOT_DEATH_FIELDS)
    dead.forEach((b, i) => {
      const o = i * BOT_DEATH_FIELDS
      botDeaths[o] = b.stats.deathCycle as number
      botDeaths[o + 1] = entrantOf[b.index] as number
      botDeaths[o + 2] = DEATH_REASONS.indexOf(b.stats.deathReason as DeathReason)
      botDeaths[o + 3] = tagOut[this.watch.botKiller[b.index] as number] as number
    })
    return {
      type: 'frame',
      cycle: battle.cycle,
      alive: battle.alive,
      over: battle.over,
      writes: new Uint16Array(0),
      writeCycles: new Uint32Array(0),
      execs: new Uint16Array(0),
      ips: this.ips(battle),
      spawns: new Uint32Array(0),
      deaths: new Uint32Array(0),
      botDeaths,
      stats: this.stats(battle),
      firstBlood: this.firstBlood(battle),
      keyframes: this.keyframeList(true),
      ownerDirty: ownerOut,
      bytesDirty: bytes.slice(),
    }
  }

  private activityFrame(battle: Battle): FrameMessage {
    const { sink, entrantOf, tagOut } = this
    // First: it moves the footprints that `stats` reads.
    const [writes, writeCycles] = this.writes(battle.core)
    const spawns = sink.spawns.drain()
    for (let o = 0; o < spawns.length; o += SPAWN_RECORD) {
      spawns[o + 1] = entrantOf[spawns[o + 1] as number] as number
    }
    const deaths = sink.deaths.drain()
    for (let o = 0; o < deaths.length; o += DEATH_FIELDS) {
      deaths[o + 1] = entrantOf[deaths[o + 1] as number] as number
      deaths[o + 5] = tagOut[deaths[o + 5] as number] as number
    }
    const dead = sink.botDeaths.drain()
    const botDeaths = new Uint32Array((dead.length / BOT_DEAD_RECORD) * BOT_DEATH_FIELDS)
    for (let i = 0, o = 0; i < dead.length; i += BOT_DEAD_RECORD, o += BOT_DEATH_FIELDS) {
      const bot = dead[i + 1] as number
      botDeaths[o] = dead[i] as number
      botDeaths[o + 1] = entrantOf[bot] as number
      botDeaths[o + 2] = DEATH_REASONS.indexOf(
        (battle.bots[bot]?.stats.deathReason ?? 'undefined') as DeathReason,
      )
      botDeaths[o + 3] = tagOut[this.watch.botKiller[bot] as number] as number
    }
    return {
      type: 'frame',
      cycle: battle.cycle,
      alive: battle.alive,
      over: battle.over,
      writes,
      writeCycles,
      execs: this.execs(),
      ips: this.ips(battle),
      spawns,
      deaths,
      botDeaths,
      stats: this.stats(battle),
      firstBlood: this.firstBlood(battle),
      keyframes: this.keyframeList(false),
      ownerDirty: null,
      bytesDirty: null,
    }
  }

  /**
   * The frame's written bytes as (address, cell) pairs, and the cycle of each one's last write.
   * Moves the footprints to their owners.
   */
  private writes(core: Core): [Uint16Array, Uint32Array] {
    const { written, writeCount, writeCycle } = this.sink
    const { bytes, owner } = core
    const { shadow, owned, tagOut } = this
    const out = new Uint16Array(writeCount * 2)
    const cycles = new Uint32Array(writeCount)
    for (let i = 0; i < writeCount; i++) {
      const a = written[i] as number
      const t = owner[a] as number
      out[2 * i] = a
      out[2 * i + 1] = (bytes[a] as number) | ((tagOut[t] as number) << 8)
      cycles[i] = writeCycle[a] as number
      const was = shadow[a] as number
      if (was !== t) {
        owned[was] = (owned[was] as number) - 1
        owned[t] = (owned[t] as number) + 1
        shadow[a] = t
      }
    }
    return [out, cycles]
  }

  /** The frame's run bytes as (address, bot) pairs. */
  private execs(): Uint16Array {
    const { executed, execCount, execBot } = this.sink
    const { entrantOf } = this
    const out = new Uint16Array(execCount * 2)
    for (let i = 0; i < execCount; i++) {
      const a = executed[i] as number
      out[2 * i] = a
      out[2 * i + 1] = entrantOf[execBot[a] as number] as number
    }
    return out
  }

  /** Each live process as (IP, bot) pairs, bot by bot in the load's order, fronts flagged. */
  private ips(battle: Battle): Uint16Array {
    let n = 0
    for (const bot of battle.bots) n += bot.queue.size
    const out = new Uint16Array(n * 2)
    let o = 0
    for (let k = 0; k < battle.bots.length; k++) {
      const q = (battle.bots[this.battleOf[k] as number] as Bot).queue
      for (let i = 0; i < q.size; i++) {
        out[o++] = (q.rows[q.at(i)] as ProcRow)[IP] as number
        out[o++] = i === 0 ? k | IP_FRONT : k
      }
    }
    return out
  }

  private stats(battle: Battle): Float32Array {
    const out = new Float32Array(battle.bots.length * STAT_FIELDS)
    for (const bot of battle.bots) {
      const o = (this.entrantOf[bot.index] as number) * STAT_FIELDS
      out[o + STAT_PROCS] = bot.queue.size
      out[o + STAT_FOOTPRINT] = this.owned[bot.tag] as number
      out[o + STAT_WRITES] = bot.stats.writes
    }
    return out
  }

  /** The round's first blood, in the load's bots, once the battle has run past it. */
  private firstBlood(battle: Battle): FirstBlood | null {
    const blood = this.watch.firstBlood
    if (blood === null || blood.cycle >= battle.cycle) return null
    return {
      cycle: blood.cycle,
      killer: this.entrantOf[blood.killer] as number,
      victim: this.entrantOf[blood.victim] as number,
    }
  }

  /** The keyframes' cycles when `always`, or when they moved since the last frame; else null. */
  private keyframeList(always: boolean): Uint32Array | null {
    if (!always && !this.keyframesMoved) return null
    this.keyframesMoved = false
    return Uint32Array.from(this.keyframeCycles())
  }
}
