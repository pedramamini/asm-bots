/**
 * The frames of a battle (`protocol.ts`): the sink that gathers a battle's events a frame at a
 * time, and the builder that makes a `FrameMessage` of them. The arena Worker's session builds its
 * frames here, and so does the debugger's arena strip, which draws a battle on the main thread.
 */
import {
  ADDR_MASK,
  type Battle,
  BOT_DEAD_RECORD,
  type Bot,
  CORE_SIZE,
  type Core,
  DEATH_REASONS,
  type DeathReason,
  EventRing,
  type EventSink,
  IP,
  MAX_BOTS,
  type ProcRow,
  SPAWN_RECORD,
} from '@asmbots/engine'
import {
  BOT_DEATH_FIELDS,
  DEATH_FIELDS,
  EVENT_CAPACITY,
  type FirstBlood,
  type FrameMessage,
  IP_FRONT,
  STAT_FIELDS,
  STAT_FOOTPRINT,
  STAT_PROCS,
  STAT_WRITES,
} from './protocol'

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

/**
 * The frame's event sink. Spawns, deaths, and bot deaths go to rings of records, which the builder
 * drains once a frame. Executes and writes come too fast for rings (16 bots at 2,000 cycles a
 * frame make 32,000 of each), and the renderer needs only the bytes they touched, so the sink
 * marks bytes instead: each byte once a frame, however often it is touched.
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

/**
 * Makes the frames of a battle that runs with `sink`: a full frame (the whole core, no activity)
 * or an activity frame (what the sink gathered since the last frame). The frames name bots by
 * their place in the load, whatever order they fight in (`setOrder`), and count each bot's
 * footprint from the writes of the frames, so give it every frame of the battle in order, from a
 * full one on. The caller starts the next frame with `sink.next()`.
 */
export class FrameBuilder {
  readonly watch = new DeathWatch()
  readonly sink = new FrameSink(this.watch)
  /** Per battle bot: its place in the load. */
  private readonly entrantOf = new Uint8Array(MAX_BOTS)
  /** Per bot in the load: its index in the battle. */
  private readonly battleOf = new Uint8Array(MAX_BOTS)
  /** Per battle owner tag: the tag of the same bot in the load. */
  private readonly tagOut = new Uint8Array(MAX_BOTS + 1)
  /** The owner map as the last frame left it, so a frame counts footprints from its writes. */
  private readonly shadow = new Uint8Array(CORE_SIZE)
  /** Bytes owned per battle owner tag, as of `shadow`. */
  private readonly owned = new Uint32Array(MAX_BOTS + 1)

  /** The round's fighting order: `order[j]` is the load's bot placed j-th. */
  setOrder(order: readonly number[]): void {
    this.tagOut.fill(0)
    order.forEach((k, j) => {
      this.entrantOf[j] = k
      this.battleOf[k] = j
      this.tagOut[j + 1] = k + 1
    })
  }

  /** The place in the load of the battle's bot `bot`. */
  entrant(bot: number): number {
    return this.entrantOf[bot] as number
  }

  /** The whole battle as it stands, with no activity: the renderer starts over from it. */
  full(battle: Battle, keyframes: Uint32Array | null): FrameMessage {
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
      keyframes,
      ownerDirty: ownerOut,
      bytesDirty: bytes.slice(),
    }
  }

  /** The battle as it stands, and what the sink gathered since the last frame. */
  activity(battle: Battle, keyframes: Uint32Array | null): FrameMessage {
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
      keyframes,
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
}
