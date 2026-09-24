/**
 * The arena Worker's state (ARCHITECTURE §6): one match, the battle of its current round, the
 * frame builder whose sink gathers the battle's events a frame at a time (`frames.ts`), and the
 * keyframes a seek restores. `arena.worker.ts` hands it each request and posts what it returns,
 * so all of this runs, and is tested, without a Worker.
 */
import {
  Battle,
  type BattleConfigInput,
  DEFAULT_CONFIG,
  type LoadedBot,
  NullSink,
  restore,
  type Snapshot,
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
import { type DeathWatch, FrameBuilder } from './frames'
import {
  type ArenaBot,
  type ArenaMessage,
  type ArenaRequest,
  DEFAULT_SPEED,
  FRAME_BUDGET_MS,
  isSpeed,
  KEYFRAME_INTERVAL,
  type LoadedMessage,
  MAX_CYCLES_PER_FRAME,
  MAX_KEYFRAMES,
  type Speed,
} from './protocol'

/** Cycles run between two looks at the clock when a frame has a budget. */
const CHUNK_CYCLES = 256

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
  private battle: Battle | null = null
  /** Its sink gathers the battle's events; it maps the battle's bots back to the load's. */
  private readonly frames = new FrameBuilder()
  private readonly silent = new SeekSink(this.frames.watch)
  private readonly keyframes = new Map<number, Snapshot>()
  /** Whether the keyframes changed since the last frame. */
  private keyframesMoved = true
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
        const { config, rounds, resume, through } = request
        return [{ type: 'match', match: runMatch(bots, config, rounds, { resume, through }) }]
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
    const battle = new Battle(bots, config, this.frames.sink)
    this.entrants = entrants
    this.matchConfig = matchConfig
    this.match = match
    this.round = round
    this.bots = bots
    this.config = config
    this.order = order
    this.frames.setOrder(order)
    this.battle = battle
    this.frames.watch.reset(battle.core.owner)
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
      const k = this.frames.entrant(b.index)
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
      this.frames.watch.owner = battle.core.owner
    } else {
      battle.events = this.silent
    }
    this.advance(battle, target, Number.POSITIVE_INFINITY)
    battle.events = this.frames.sink
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
    const frames = this.frames
    const frame = full
      ? frames.full(battle, this.keyframeList(true))
      : frames.activity(battle, this.keyframeList(false))
    frames.sink.next()
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

  /** The keyframes' cycles when `always`, or when they moved since the last frame; else null. */
  private keyframeList(always: boolean): Uint32Array | null {
    if (!always && !this.keyframesMoved) return null
    this.keyframesMoved = false
    return Uint32Array.from(this.keyframeCycles())
  }
}
