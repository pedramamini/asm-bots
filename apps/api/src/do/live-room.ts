import { DurableObject } from 'cloudflare:workers'
import {
  LIVE_PING,
  LIVE_PONG,
  LIVE_PROTOCOL,
  LiveEvent,
  type LiveMessage,
  parse,
  parseLiveMessage,
  parseLiveRoomName,
} from '@asmbots/protocol'
import type { Env } from '../env'
import { log } from '../middleware'

/** The events a room keeps for a spectator who joins late. */
export const BACKLOG = 20

/** The sockets a room takes at once. */
export const MAX_SPECTATORS = 500

/** The sockets a room takes at once from one address, so no one client can fill it. */
export const MAX_PER_CLIENT = 20

/**
 * How long a room waits to tell its spectators a new count, ms: a crowd that arrives together
 * gets one `spectators` message a second, not one per join, each to every socket.
 */
export const COUNT_DELAY_MS = 1000

/** The close code of a socket the room turned away: "try again later". */
export const ROOM_FULL = 1013

/** The close code of a socket that sent something other than a ping. */
export const SPECTATORS_ONLY = 1008

/** Close codes that only report what happened, and no close frame may carry (RFC 6455 §7.4.1). */
const RESERVED_CODES: ReadonlySet<number> = new Set([1004, 1005, 1006, 1015])

/** Why a new socket may not join a room of `open` sockets, `mine` of them from its address. */
export function refusal(open: number, mine: number): string | null {
  if (open >= MAX_SPECTATORS) return 'the room is full'
  if (mine >= MAX_PER_CLIENT) return 'too many sockets from one address'
  return null
}

/**
 * One per tournament or hill (`liveRoomName`): fans a `Runner`'s events out to spectators over
 * WebSockets (ARCHITECTURE §7), and keeps the last `BACKLOG` for those who join late.
 *
 * Sockets use the hibernation API: the room sleeps between events, sockets open, and the runtime
 * answers `LIVE_PING` with `LIVE_PONG` without waking it. A socket gets `hello`, the count, the
 * backlog, then every event. Storage: `recent`, the backlog, oldest first.
 */
export class LiveRoom extends DurableObject<Env> {
  /** The backlog as last read or written; null until the first read after a wake. */
  private kept: LiveEvent[] | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG))
  }

  /**
   * A spectator's socket, from `GET /api/live/:room`, which has checked the room: the path is
   * its name, and `CF-Connecting-IP` the spectator's address. A room with `MAX_SPECTATORS`, or
   * `MAX_PER_CLIENT` from that address, closes the socket at once (`ROOM_FULL`).
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('a live room takes WebSockets only', { status: 426 })
    }
    const room = parseLiveRoomName(decodeURIComponent(new URL(request.url).pathname.slice(1)))
    const client = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    await this.load()
    // Nothing awaits from here to the last send: no event can land between the backlog and the
    // socket, so the spectator gets each event once, in order.
    const [socket, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    const refused = refusal(this.open().length, this.open(client).length)
    if (refused !== null) {
      server.accept()
      server.close(ROOM_FULL, refused)
      return new Response(null, { status: 101, webSocket: socket })
    }
    this.ctx.acceptWebSocket(server, [client])
    const now = new Date().toISOString()
    const opening: LiveMessage[] = [
      { type: 'hello', protocol: LIVE_PROTOCOL, room, now },
      { type: 'spectators', count: this.open().length },
      ...(this.kept ?? []),
    ]
    for (const message of opening) server.send(JSON.stringify(message))
    await this.countLater()
    return new Response(null, { status: 101, webSocket: socket })
  }

  /** Takes a `Runner`'s events, in order: each goes to every socket, and the last `BACKLOG` stay. */
  async publish(events: readonly LiveEvent[]): Promise<void> {
    const checked = events.map((e) => parse(LiveEvent, e, 'the event'))
    await this.load()
    const kept = (this.kept ?? []).concat(checked).slice(-BACKLOG)
    // The backlog and the sockets change together, before anything awaits (see `fetch`).
    this.kept = kept
    this.broadcast(checked.map((e) => JSON.stringify(e)))
    await this.ctx.storage.put('recent', kept)
  }

  /** The room's last events, oldest first. */
  async recent(): Promise<LiveEvent[]> {
    return [...(await this.load())]
  }

  /** The sockets open on the room. */
  async spectators(): Promise<number> {
    return this.open().length
  }

  /**
   * A message the auto-response did not answer. A ping sent some other way than `LIVE_PING`
   * still gets its pong; anything else closes the socket: spectators only listen.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string' && isPing(message)) {
      ws.send(LIVE_PONG)
      return
    }
    ws.close(SPECTATORS_ONLY, 'spectators only send pings')
    await this.countLater()
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Answer the spectator's close with its code; a reserved one (no code, no close frame) is
    // never sent.
    try {
      ws.close(RESERVED_CODES.has(code) ? 1000 : code, 'bye')
    } catch {
      // Closed already.
    }
    await this.countLater()
  }

  override async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    log('warn', 'live.socket', { error: error instanceof Error ? error.message : String(error) })
    await this.countLater()
  }

  /** The count, told to every socket once the joins and leaves of a moment have settled. */
  override async alarm(): Promise<void> {
    const open = this.open()
    this.broadcast([JSON.stringify({ type: 'spectators', count: open.length })], open)
  }

  /** Reads the backlog once a wake; a `publish` that got in first keeps its newer one. */
  private async load(): Promise<LiveEvent[]> {
    if (this.kept === null) {
      const stored = (await this.ctx.storage.get<LiveEvent[]>('recent')) ?? []
      this.kept ??= stored
    }
    return this.kept
  }

  /** The open sockets: all of them, or those from `client`. */
  private open(client?: string): WebSocket[] {
    return this.ctx.getWebSockets(client).filter((ws) => ws.readyState === WebSocket.OPEN)
  }

  private broadcast(texts: readonly string[], sockets: readonly WebSocket[] = this.open()): void {
    for (const ws of sockets) {
      for (const text of texts) {
        try {
          ws.send(text)
        } catch {
          // Closing: its close handler counts it out.
        }
      }
    }
  }

  /** Sets the count's alarm, unless one is set. */
  private async countLater(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + COUNT_DELAY_MS)
    }
  }
}

function isPing(text: string): boolean {
  try {
    return parseLiveMessage(text).type === 'ping'
  } catch {
    return false
  }
}
