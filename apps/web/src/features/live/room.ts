/**
 * A hill's or a tournament's `LiveRoom` from the page (ARCHITECTURE §7, PRODUCT_SPEC §4): one
 * WebSocket to `/api/live/<room>`, opened again after a drop with a growing wait, kept alive with
 * pings, and read into a store: whether the room is live, its spectators, the matches it has told
 * of with their results, each job's progress, and the standings.
 *
 * A socket that opens again hears the room's backlog again: matches are kept by id, and a job's
 * progress never goes back, so nothing counts twice.
 */
import {
  LIVE_PING,
  LIVE_PROTOCOL,
  type LiveMatch,
  type LiveMessage,
  type Match,
  parseLiveMessage,
  type Standing,
} from '@asmbots/protocol'
import { createStore, type StoreApi } from 'zustand'

/**
 * No room asked for; opening the socket; hearing the room; waiting to open it again after a
 * drop; turned away by a full room, and waiting longer; or speaking another protocol than the
 * room (a new version of the site is out), which reloading the page fixes.
 */
export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'full' | 'outdated'

export type LiveProgress = Extract<LiveMessage, { type: 'progress' }>

/** A match the room told of: its inputs, and the row the server stored once it finished. */
export interface LiveMatchEntry {
  /** Its `Runner` job. */
  readonly job: string
  readonly match: LiveMatch
  readonly result: Match | null
}

export interface LiveRoomState {
  readonly status: LiveStatus
  /** The sockets on the room, this one among them; null until the room says. */
  readonly spectators: number | null
  /** Oldest first, the last `KEPT_MATCHES`. */
  readonly matches: readonly LiveMatchEntry[]
  /** Each job's last progress, by job id. */
  readonly jobs: ReadonlyMap<string, LiveProgress>
  readonly standings: readonly Standing[] | null
  /**
   * The jobs this page saw running that have ended since: what they changed (a hill's board, a
   * tournament's results) is worth reading again each time it grows.
   */
  readonly endings: number
}

export const IDLE_ROOM: LiveRoomState = Object.freeze({
  status: 'idle',
  spectators: null,
  matches: [],
  jobs: new Map(),
  standings: null,
  endings: 0,
})

/** The matches a page keeps. */
export const KEPT_MATCHES = 50

/** How often the page pings the room, ms. */
export const PING_MS = 20_000
/** How long a socket may say nothing (not even a pong) before the page drops it, ms. */
export const STALE_MS = 50_000
/** The first wait after a drop, ms: each drop in a row doubles it, up to `MAX_RETRY_MS`. */
export const FIRST_RETRY_MS = 1000
export const MAX_RETRY_MS = 30_000
/** The wait after a full room turned the socket away, ms. */
export const FULL_RETRY_MS = 60_000
/** The room's close code for "full, try again later". */
export const ROOM_FULL = 1013

/** `message` taken into `state`. */
export function reduceLive(state: LiveRoomState, message: LiveMessage): LiveRoomState {
  switch (message.type) {
    case 'hello':
      return state.status === 'live' ? state : { ...state, status: 'live' }
    case 'spectators':
      return { ...state, spectators: message.count }
    case 'matchStarted': {
      if (state.matches.some((m) => m.match.id === message.match.id)) return state
      const entry: LiveMatchEntry = { job: message.job, match: message.match, result: null }
      return { ...state, matches: [...state.matches, entry].slice(-KEPT_MATCHES) }
    }
    case 'matchFinished': {
      // Its start went by before this page came: there is nothing to run it from.
      const at = state.matches.findIndex((m) => m.match.id === message.match.id)
      const entry = state.matches[at]
      if (entry === undefined || entry.result !== null) return state
      const matches = [...state.matches]
      matches[at] = { ...entry, result: message.match }
      return { ...state, matches }
    }
    case 'standings':
      return { ...state, standings: message.entries }
    case 'progress': {
      const before = state.jobs.get(message.job)
      // A job that ended stays ended, and a running one never goes back.
      if (before !== undefined && (before.status !== 'running' || message.done < before.done)) {
        return state
      }
      const ended = before?.status === 'running' && message.status !== 'running'
      return {
        ...state,
        jobs: new Map(state.jobs).set(message.job, message),
        endings: state.endings + (ended ? 1 : 0),
      }
    }
    case 'ping':
    case 'pong':
      return state
  }
}

/** The match to watch: the last one started of a job still running, or null. */
export function currentMatch(state: LiveRoomState): LiveMatchEntry | null {
  for (let i = state.matches.length - 1; i >= 0; i--) {
    const entry = state.matches[i] as LiveMatchEntry
    if (state.jobs.get(entry.job)?.status === 'running') return entry
  }
  return null
}

/** `Dwarf v Imp`, or `6 bots` past three. */
export function matchLabel(match: LiveMatch): string {
  const names = match.bots.map((bot) => bot.name)
  return names.length > 3 ? `${names.length} bots` : names.join(' v ')
}

/** Whether any job the room told of is running. */
export function roomBusy(state: LiveRoomState): boolean {
  for (const progress of state.jobs.values()) if (progress.status === 'running') return true
  return false
}

/** The socket URL of `room` on the page's origin: `ws://` or `wss://` as the page is. */
export function liveUrl(room: string, origin = globalThis.location?.origin ?? 'http://localhost') {
  const url = new URL(`/api/live/${encodeURIComponent(room)}`, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** Waits, and the clock: the page's, or a test's. */
export interface LiveTimers {
  now(): number
  /** Calls `callback` after `ms`; returns what cancels it. */
  after(ms: number, callback: () => void): () => void
}

const PAGE_TIMERS: LiveTimers = {
  now: () => Date.now(),
  after: (ms, callback) => {
    const id = setTimeout(callback, ms)
    return () => clearTimeout(id)
  },
}

export interface LiveRoomOptions {
  /** Opens a socket. Default: the browser's `WebSocket`. */
  readonly createSocket?: ((url: string) => WebSocket) | undefined
  readonly timers?: LiveTimers | undefined
  /** 0..1, for the jitter of each wait. Default: `Math.random`. */
  readonly random?: (() => number) | undefined
}

const CONNECTING = 0

/** Whether `text` is a hello in another version of the protocol than this page's. */
function otherProtocol(text: string): boolean {
  try {
    const value = JSON.parse(text) as { type?: unknown; protocol?: unknown } | null
    return value?.type === 'hello' && value.protocol !== LIVE_PROTOCOL
  } catch {
    return false
  }
}

/** One room's socket, and its store. `dispose` ends both. */
export class LiveRoomClient {
  readonly store: StoreApi<LiveRoomState>
  private readonly createSocket: (url: string) => WebSocket
  private readonly timers: LiveTimers
  private readonly random: () => number
  private socket: WebSocket | null = null
  /** Drops in a row: the next wait's exponent. A hello resets it. */
  private drops = 0
  private lastHeard = 0
  private cancelRetry: (() => void) | null = null
  private cancelPing: (() => void) | null = null
  private disposed = false

  constructor(
    readonly room: string,
    { createSocket, timers = PAGE_TIMERS, random = Math.random }: LiveRoomOptions = {},
  ) {
    this.createSocket = createSocket ?? ((url) => new WebSocket(url))
    this.timers = timers
    this.random = random
    this.store = createStore<LiveRoomState>()(() => ({ ...IDLE_ROOM, status: 'connecting' }))
    this.connect()
  }

  /** Closes the socket and stops opening it again. */
  dispose(): void {
    this.disposed = true
    this.cancelRetry?.()
    this.cancelRetry = null
    this.drop()
  }

  private connect(): void {
    this.cancelRetry = null
    if (this.disposed) return
    let socket: WebSocket
    try {
      socket = this.createSocket(liveUrl(this.room))
    } catch {
      // The browser refused to open it (a blocked port, a bad URL): it counts as a drop.
      this.closed(1006)
      return
    }
    this.socket = socket
    this.lastHeard = this.timers.now()
    socket.addEventListener('open', () => {
      if (socket === this.socket) this.schedulePing()
    })
    socket.addEventListener('message', (event) => {
      if (socket === this.socket) this.receive((event as MessageEvent).data)
    })
    socket.addEventListener('close', (event) => {
      if (socket === this.socket) this.closed((event as CloseEvent).code)
    })
  }

  private receive(data: unknown): void {
    this.lastHeard = this.timers.now()
    if (typeof data !== 'string') return
    if (otherProtocol(data)) {
      this.store.setState({ status: 'outdated' })
      this.drop()
      return
    }
    let message: LiveMessage
    try {
      message = parseLiveMessage(data)
    } catch {
      // A message this page cannot read (a newer kind): the rest still can be.
      return
    }
    if (message.type === 'hello') this.drops = 0
    this.store.setState(reduceLive(this.store.getState(), message))
  }

  /** The socket closed: open another after a wait, unless the page is done with the room. */
  private closed(code: number): void {
    this.drop()
    if (this.disposed || this.store.getState().status === 'outdated') return
    let wait: number
    if (code === ROOM_FULL) {
      this.store.setState({ status: 'full' })
      wait = FULL_RETRY_MS
    } else {
      this.store.setState({ status: 'reconnecting' })
      wait = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** this.drops)
      this.drops++
    }
    // Half to all of the wait, so a crowd dropped together does not come back together.
    this.cancelRetry = this.timers.after(wait * (0.5 + this.random() / 2), () => this.connect())
  }

  /** Pings every `PING_MS`; a socket silent past `STALE_MS` is dead, and closes as if it dropped. */
  private schedulePing(): void {
    this.cancelPing = this.timers.after(PING_MS, () => {
      this.cancelPing = null
      const socket = this.socket
      if (socket === null) return
      if (this.timers.now() - this.lastHeard > STALE_MS) {
        this.closed(1006)
        return
      }
      socket.send(LIVE_PING)
      this.schedulePing()
    })
  }

  /**
   * Stops hearing the socket, and closes it. One still connecting closes once it opens: closing
   * it sooner makes the browser log an error for a socket nobody wants.
   */
  private drop(): void {
    this.cancelPing?.()
    this.cancelPing = null
    const socket = this.socket
    this.socket = null
    if (socket === null) return
    if (socket.readyState === CONNECTING) {
      socket.addEventListener('open', () => socket.close(1000))
    } else {
      socket.close(1000)
    }
  }
}
