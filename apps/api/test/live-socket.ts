/** A spectator's socket on the Worker (`GET /api/live/:room`), and what it heard. */
import { exports } from 'cloudflare:workers'
import { type LiveMessage, parseLiveMessage } from '@asmbots/protocol'
import { expect, vi } from 'vitest'

export interface SpectateOptions {
  /** The spectator's address (`CF-Connecting-IP`). */
  readonly ip?: string
  readonly origin?: string
}

/** `GET /api/live/<room>` as a WebSocket upgrade: the Worker's answer. */
export function openLive(room: string, { ip, origin }: SpectateOptions = {}): Promise<Response> {
  const headers = new Headers({ Upgrade: 'websocket' })
  if (ip !== undefined) headers.set('CF-Connecting-IP', ip)
  if (origin !== undefined) headers.set('Origin', origin)
  const url = `https://asmbots.test/api/live/${encodeURIComponent(room)}`
  return exports.default.fetch(new Request(url, { headers }))
}

/** One socket: every message it got, parsed, and how it closed. */
export class Spectator {
  readonly heard: LiveMessage[] = []
  /** The raw texts, in order: the keepalive's answer is checked as sent. */
  readonly texts: string[] = []
  closed: { code: number; reason: string } | null = null

  constructor(readonly ws: WebSocket) {
    ws.accept()
    ws.addEventListener('message', (event) => {
      const text = event.data as string
      this.texts.push(text)
      this.heard.push(parseLiveMessage(text))
    })
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason }
    })
  }

  /** The messages of `type`, in order. */
  of<T extends LiveMessage['type']>(type: T): Extract<LiveMessage, { type: T }>[] {
    return this.heard.filter((m): m is Extract<LiveMessage, { type: T }> => m.type === type)
  }

  /** Waits until it has heard `n` messages. */
  async until(n: number): Promise<void> {
    await vi.waitFor(() => expect(this.heard.length).toBeGreaterThanOrEqual(n))
  }

  /** Waits until it has closed. */
  async untilClosed(): Promise<{ code: number; reason: string }> {
    await vi.waitFor(() => expect(this.closed).not.toBeNull())
    return this.closed as { code: number; reason: string }
  }
}

/** A socket on `room` that the room took: the Worker answered 101. */
export async function spectate(room: string, options?: SpectateOptions): Promise<Spectator> {
  const res = await openLive(room, options)
  expect(res.status).toBe(101)
  expect(res.webSocket).not.toBeNull()
  return new Spectator(res.webSocket as WebSocket)
}
