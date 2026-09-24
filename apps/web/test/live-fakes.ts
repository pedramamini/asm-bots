/**
 * Stand-ins for what a live room's page opens (`src/features/live`): a WebSocket the test opens,
 * talks through, and drops, keeping what the page sent; timers that fire when the test says; and
 * a real match as the room tells of it, with the row the server stores when it ends.
 */
import type { LoadedBot } from '@asmbots/engine'
import {
  type LiveMatch,
  type LiveMessage,
  type Match,
  matchResultHash,
  type ReplayConfig,
  sha256Hex,
  toBase64,
} from '@asmbots/protocol'
import { matchHash, runMatch } from '@asmbots/tourney'
import type { LiveTimers } from '../src/features/live/room'

type Listener = (event: unknown) => void

/** One socket: `open`, `receive`, and `drop` play the room's side. */
export class FakeSocket {
  readyState = 0
  /** What the page sent, in order. */
  readonly sent: string[] = []
  /** The code the page closed it with, or null while it has not. */
  closedWith: number | null = null
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('the socket is not open')
    this.sent.push(data)
  }

  /** The page closes it. A real socket's close event comes later; the page no longer listens. */
  close(code = 1000): void {
    if (this.readyState >= 2) return
    if (this.readyState === 0) throw new Error('closed before it opened: the browser logs an error')
    this.readyState = 3
    this.closedWith = code
  }

  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  /** The room sends `message` (an object as JSON, a string as it is). */
  receive(message: LiveMessage | string): void {
    this.emit('message', { data: typeof message === 'string' ? message : JSON.stringify(message) })
  }

  /** The connection ends from the room's side, or the network's (1006). */
  drop(code = 1006): void {
    this.readyState = 3
    this.emit('close', { code, reason: '' })
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** Every socket a page opened, newest last; `create` is the page's `createSocket`. */
export class FakeSockets {
  readonly all: FakeSocket[] = []

  readonly create = (url: string): WebSocket => {
    const socket = new FakeSocket(url)
    this.all.push(socket)
    return socket as unknown as WebSocket
  }

  get last(): FakeSocket {
    const socket = this.all.at(-1)
    if (socket === undefined) throw new Error('no socket was opened')
    return socket
  }
}

/** A clock that moves when the test calls `advance`, firing what falls due, in time order. */
export class FakeTimers implements LiveTimers {
  time = 0
  private next = 0
  private readonly due = new Map<number, { at: number; callback: () => void }>()

  readonly now = (): number => this.time

  readonly after = (ms: number, callback: () => void): (() => void) => {
    const id = this.next++
    this.due.set(id, { at: this.time + ms, callback })
    return () => {
      this.due.delete(id)
    }
  }

  /** The waits still set, as ms from now, soonest first. */
  pending(): number[] {
    return [...this.due.values()].map((t) => t.at - this.time).sort((a, b) => a - b)
  }

  advance(ms: number): void {
    const end = this.time + ms
    for (;;) {
      let first: [number, { at: number; callback: () => void }] | null = null
      for (const entry of this.due) if (first === null || entry[1].at < first[1].at) first = entry
      if (first === null || first[1].at > end) break
      this.due.delete(first[0])
      this.time = first[1].at
      first[1].callback()
    }
    this.time = end
  }
}

/** `jmp short $`: lives to the cycle cap. */
const LOOP: LoadedBot = { name: 'Loop', bytes: Uint8Array.from([0xeb, 0xfe]) }
/** `dat`: dies on its first instruction. */
const DAT: LoadedBot = { name: 'Dat', bytes: Uint8Array.from([0x00, 0x00]) }

export const LIVE_CONFIG: ReplayConfig = {
  coreSize: 0x10000,
  maxCycles: 200,
  maxProcesses: 64,
  minSpacing: 1024,
  maxBotBytes: 512,
}

/** A match as its `matchStarted` carries it, and the row the server stores for it. */
export interface LiveDuel {
  readonly match: LiveMatch
  readonly finished: Match
}

/**
 * The loop against the dat, `rounds` rounds from seed 1: its inputs, played here with `runMatch`
 * as a `Runner` plays them, for the row of its `matchFinished`.
 */
export async function liveDuel(id: string, rounds = 2): Promise<LiveDuel> {
  const bots = [LOOP, DAT]
  const battle = { ...LIVE_CONFIG, seed: 1 }
  const played = runMatch(bots, battle, rounds)
  const match: LiveMatch = {
    id,
    key: matchHash(bots, battle, rounds),
    participants: ['v-loop', 'v-dat'],
    rounds,
    seed: 1,
    config: LIVE_CONFIG,
    bots: await Promise.all(
      bots.map(async (b) => ({
        name: b.name,
        bytes: toBase64(b.bytes),
        sha256: await sha256Hex(b.bytes),
      })),
    ),
  }
  const finished: Match = {
    id,
    tournamentId: null,
    hillId: 'h1',
    participants: match.participants,
    rounds,
    seed: 1,
    result: {
      points: [...played.points],
      survivors: [...(played.rounds.at(-1)?.survivors ?? [])],
      resultHash: matchResultHash(played.rounds),
      rounds: played.rounds.map((r) => ({
        ...r,
        order: [...r.order],
        points: [...r.points],
        survivors: [...r.survivors],
        survival: [...r.survival],
      })),
    },
    replayKey: 'c'.repeat(64),
    finishedAt: '2026-09-24T12:00:00.000Z',
  }
  return { match, finished }
}
