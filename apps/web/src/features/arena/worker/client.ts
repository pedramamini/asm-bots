/**
 * The main thread's end of the arena Worker (ARCHITECTURE §6). `ArenaClient` sends the requests of
 * `protocol.ts`, paces playback to the display, keeps a `useArena` store current, and hands each
 * message to its listeners.
 *
 * Pacing: while playing, the client asks for one frame per display frame, and asks again only once
 * that frame is in. The Worker never runs on its own, so it can never get ahead of the page: a slow
 * or hidden tab slows the battle down instead of piling frames up.
 */
import type { BattleConfig, BattleConfigInput, Result } from '@asmbots/engine'
import type { MatchResult } from '@asmbots/tourney'
import { create, createStore, type StoreApi } from 'zustand'
import {
  type ArenaBot,
  type ArenaBotMeta,
  type ArenaMessage,
  type ArenaRequest,
  DEFAULT_SPEED,
  type EndedMessage,
  type ErrorMessage,
  FRAME_REQUESTS,
  type FrameMessage,
  isSpeed,
  type LoadedMessage,
  MAX_CYCLES_PER_FRAME,
  type Placement,
  type Speed,
} from './protocol'

/** Nothing loaded, loading, paused, playing, over, or failed to load. */
export type ArenaStatus = 'idle' | 'loading' | 'paused' | 'playing' | 'ended' | 'error'

/** What the arena UI reads: the loaded battle, and where it stands as of the last frame. */
export interface ArenaState {
  readonly status: ArenaStatus
  /** Cycles run. */
  readonly cycle: number
  /** Bots alive. */
  readonly alive: number
  /** The last frame's `stats`: `STAT_FIELDS` per bot. */
  readonly stats: Float32Array
  /** One per bot, in submission order. */
  readonly placements: readonly Placement[]
  /** One per bot, in submission order. */
  readonly botMeta: readonly ArenaBotMeta[]
  /** The config the round runs with, once loaded: its seed is the round's. */
  readonly config: BattleConfig | null
  /** The round loaded, from 0, and the rounds in the match. */
  readonly round: number
  readonly rounds: number
  /** The round's fighting order (ISA §5.5): `order[j]` is the bot placed j-th. */
  readonly order: readonly number[]
  /** The match so far: its rounds played to the end, and its points. */
  readonly match: MatchResult | null
  /** The furthest cycle of the round any frame has reached: a seek back to it is quick. */
  readonly reached: number
  /** The cycles of the Worker's keyframes, ascending. */
  readonly keyframes: Uint32Array
  /** The speed last asked for. */
  readonly speed: Speed
  /** The round's result, once it is over: the bots in fighting order (`botResults`). */
  readonly result: Result | null
  /** `resultHash(result)`, once the round is over. */
  readonly resultHash: string | null
  /** The last failure, until the next load. */
  readonly error: string | null
}

export const INITIAL_ARENA_STATE: ArenaState = Object.freeze({
  status: 'idle',
  cycle: 0,
  alive: 0,
  stats: new Float32Array(0),
  placements: [],
  botMeta: [],
  config: null,
  round: 0,
  rounds: 1,
  order: [],
  match: null,
  reached: 0,
  keyframes: new Uint32Array(0),
  speed: DEFAULT_SPEED,
  result: null,
  resultHash: null,
  error: null,
})

/** The arena page's store. An `ArenaClient` keeps it current unless it is given another. */
export const useArena = create<ArenaState>()(() => ({ ...INITIAL_ARENA_STATE }))

/** A store of its own, for a second arena on a page (the home page's demo). */
export function createArenaStore(): StoreApi<ArenaState> {
  return createStore<ArenaState>()(() => ({ ...INITIAL_ARENA_STATE }))
}

/** The messages by type: what `on` and `once` listen for. */
export interface ArenaEvents {
  loaded: LoadedMessage
  frame: FrameMessage
  ended: EndedMessage
  error: ErrorMessage
}

type Listeners = { [K in keyof ArenaEvents]: Set<(message: ArenaEvents[K]) => void> }

/** Calls `callback` on the next display frame, and returns what cancels the call. */
export type Schedule = (callback: () => void) => () => void

/** `requestAnimationFrame`, or a 16 ms timer where there is none (a test, a Worker). */
export const animationFrame: Schedule = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(callback, 16)
  return () => clearTimeout(id)
}

export interface ArenaClientOptions {
  /** The Worker to drive. Default: a new `arena.worker.ts`. */
  readonly worker?: Worker
  /** The store to keep current. Default: `useArena`. */
  readonly store?: StoreApi<ArenaState>
  /** The display frame that paces playback. Default: `animationFrame`. */
  readonly schedule?: Schedule
}

/**
 * Drives one arena Worker. The methods send requests and return at once; the answers come to the
 * store and to the listeners of `on`. Messages that answer an earlier battle, once a `load` or a
 * `setRound` is on its way, reach neither.
 */
export class ArenaClient {
  readonly store: StoreApi<ArenaState>
  private readonly worker: Worker
  private readonly schedule: Schedule
  private readonly listeners: Listeners = {
    loaded: new Set(),
    frame: new Set(),
    ended: new Set(),
    error: new Set(),
  }
  /** Requests sent that still owe their frame, or their error: `FRAME_REQUESTS`. */
  private owed = 0
  /** A seek held while frames are owed. A later seek replaces it, so a scrub sends its last. */
  private heldSeek: number | null = null
  /** From a `load` or a `setRound` to its `loaded`: frames before it are the old battle's. */
  private loading = false
  /** Whether playback is on: `play` turns it on; `pause`, a load, and the end turn it off. */
  private playing = false
  private cancelTick: (() => void) | null = null
  private disposed = false

  constructor(options: ArenaClientOptions = {}) {
    this.worker =
      options.worker ??
      new Worker(new URL('./arena.worker.ts', import.meta.url), { type: 'module', name: 'arena' })
    this.store = options.store ?? useArena
    this.schedule = options.schedule ?? animationFrame
    this.worker.addEventListener('message', (event: MessageEvent<ArenaMessage>) => {
      this.receive(event.data)
    })
    this.worker.addEventListener('error', (event) => {
      this.crash(`arena worker: ${(event as ErrorEvent).message || 'failed to run'}`)
    })
    this.worker.addEventListener('messageerror', () => {
      this.crash('arena worker: a message did not arrive whole')
    })
  }

  /** Calls `listener` with each message of `type`. Returns what stops it. */
  on<K extends keyof ArenaEvents>(
    type: K,
    listener: (message: ArenaEvents[K]) => void,
  ): () => void {
    const listeners = this.listeners[type]
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /** The next message of `type`. */
  once<K extends keyof ArenaEvents>(type: K): Promise<ArenaEvents[K]> {
    return new Promise((resolve) => {
      const off = this.on(type, (message) => {
        off()
        resolve(message)
      })
    })
  }

  /**
   * Loads a match of `rounds` rounds, its first round paused at cycle 0: `loaded` and a full frame
   * answer.
   */
  load(bots: readonly ArenaBot[], config: BattleConfigInput = {}, rounds = 1): void {
    this.startLoading()
    this.store.setState({
      ...INITIAL_ARENA_STATE,
      status: 'loading',
      speed: this.store.getState().speed,
    })
    this.send({ type: 'load', bots, config, rounds })
  }

  /** Round `round` of the match (from 0), paused at cycle 0: the next, or one played before. */
  setRound(round: number): void {
    this.startLoading()
    this.store.setState({ status: 'loading', result: null, resultHash: null, error: null })
    this.send({ type: 'setRound', round })
  }

  /** Plays on from where the battle stands. Not once it is over: seek back first. */
  play(): void {
    const { status } = this.store.getState()
    if (status !== 'paused' && status !== 'loading') return
    this.playing = true
    this.send({ type: 'play' })
    if (this.loading) return
    this.store.setState({ status: 'playing' })
    this.startTicking()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.stopTicking()
    this.send({ type: 'pause' })
    if (this.store.getState().status === 'playing') this.store.setState({ status: 'paused' })
  }

  /** Runs `cycles` cycles at once, playing or not: `.` in the arena. */
  step(cycles = 1): void {
    this.flushSeek()
    this.send({ type: 'step', cycles })
  }

  /**
   * Goes to `cycle`, back or forward: a full frame answers. While frames are owed, the seek waits,
   * and a later seek replaces it, so dragging the scrub bar never queues up stale targets.
   */
  seek(cycle: number): void {
    if (this.owed > 0) {
      this.heldSeek = cycle
      return
    }
    this.send({ type: 'seek', cycle })
  }

  /** Cycles per frame from the next frame on. Throws `RangeError` for a speed the Worker refuses. */
  speed(cyclesPerFrame: Speed): void {
    if (!isSpeed(cyclesPerFrame)) {
      throw new RangeError(`speed must be 1..${MAX_CYCLES_PER_FRAME} cycles per frame, or max`)
    }
    this.send({ type: 'speed', cyclesPerFrame })
    this.store.setState({ speed: cyclesPerFrame })
  }

  /** Ends the Worker. The client does nothing after this. */
  dispose(): void {
    this.disposed = true
    this.stopTicking()
    this.worker.terminate()
    for (const listeners of Object.values(this.listeners)) listeners.clear()
  }

  private startLoading(): void {
    this.loading = true
    this.playing = false
    this.heldSeek = null
    this.stopTicking()
  }

  private startTicking(): void {
    if (this.cancelTick === null) this.tick()
  }

  /** One display frame of playback: asks for a frame unless one is owed, then waits for the next. */
  private readonly tick = (): void => {
    this.cancelTick = null
    if (!this.playing || this.loading || this.disposed) return
    if (this.owed === 0) this.send({ type: 'requestFrame' })
    this.cancelTick = this.schedule(this.tick)
  }

  private stopTicking(): void {
    this.cancelTick?.()
    this.cancelTick = null
  }

  private flushSeek(): void {
    if (this.heldSeek === null) return
    const cycle = this.heldSeek
    this.heldSeek = null
    this.send({ type: 'seek', cycle })
  }

  private send(request: ArenaRequest): void {
    if (this.disposed) return
    if (FRAME_REQUESTS.has(request.type)) this.owed++
    this.worker.postMessage(request)
  }

  private receive(message: ArenaMessage): void {
    if (this.disposed) return
    // Never below 0: a frame the Worker sends after a crash owes nothing.
    if (answersFrameRequest(message)) this.owed = Math.max(0, this.owed - 1)
    if (!this.apply(message)) return
    if (this.owed === 0) this.flushSeek()
    this.emit(message)
  }

  /** Puts `message` in the store. Returns false for a message of an earlier battle. */
  private apply(message: ArenaMessage): boolean {
    const store = this.store
    switch (message.type) {
      case 'loaded':
        this.loading = false
        store.setState({
          status: this.playing ? 'playing' : 'paused',
          placements: message.placements,
          botMeta: message.botMeta,
          config: message.config,
          round: message.round,
          rounds: message.rounds,
          order: message.order,
          match: message.match,
          reached: 0,
          keyframes: new Uint32Array(0),
        })
        if (this.playing) this.startTicking()
        return true
      case 'frame': {
        if (this.loading) return false
        const { cycle, alive, stats, over } = message
        const state = store.getState()
        const moved = {
          cycle,
          alive,
          stats,
          reached: Math.max(state.reached, cycle),
          keyframes: message.keyframes ?? state.keyframes,
        }
        // A frame short of the end, after the end: a seek went back.
        const back = state.status === 'ended' && !over
        store.setState(
          back ? { ...moved, status: 'paused', result: null, resultHash: null } : moved,
        )
        return true
      }
      case 'ended':
        if (this.loading) return false
        this.playing = false
        this.stopTicking()
        store.setState({
          status: 'ended',
          result: message.result,
          resultHash: message.hash,
          match: message.match,
        })
        return true
      case 'error':
        if (message.request === 'load' || message.request === 'setRound') {
          this.loading = false
          this.playing = false
          this.stopTicking()
          store.setState({ status: 'error', error: message.message })
          return true
        }
        if (this.loading) return false
        // A failed load's error stands until the next load.
        if (store.getState().status !== 'error') store.setState({ error: message.message })
        return true
    }
  }

  /** The Worker failed: nothing it owes will come. */
  private crash(message: string): void {
    this.owed = 0
    this.heldSeek = null
    this.loading = false
    this.playing = false
    this.stopTicking()
    this.store.setState({ status: 'error', error: message })
    this.emit({ type: 'error', request: null, message })
  }

  private emit(message: ArenaMessage): void {
    const listeners = this.listeners[message.type] as Set<(message: ArenaMessage) => void>
    for (const listener of listeners) listener(message)
  }
}

/** Whether `message` answers one of the `FRAME_REQUESTS`: a frame, or an error in its place. */
function answersFrameRequest(message: ArenaMessage): boolean {
  if (message.type === 'frame') return true
  return message.type === 'error' && message.request !== null && FRAME_REQUESTS.has(message.request)
}
