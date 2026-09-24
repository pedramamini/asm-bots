import { type LiveRoomRef, liveRoomName, ProtocolError, parseLiveRoomName } from '@asmbots/protocol'
import { Hono } from 'hono'
import { originAllowed } from '../auth/session'
import { isWatchable } from '../db/queries'
import type { AppEnv } from '../env'
import { errorResponse } from '../middleware'

/** `name` as a room, or null when it names none. */
function roomOf(name: string): LiveRoomRef | null {
  try {
    return parseLiveRoomName(name)
  } catch (error) {
    if (error instanceof ProtocolError) return null
    throw error
  }
}

/**
 * `GET /api/live/:room`: a spectator's WebSocket to the `LiveRoom` of a hill (`hill:<hill id>`)
 * or of a tournament past its draft (`tournament:<id>`). Anyone may watch: the room's events are
 * public, and the socket reads no session. A page of another origin may not open one (403), as it
 * may not write; a request that is not a WebSocket upgrade is a 400, and a room of nothing a 404.
 */
export const live = new Hono<AppEnv>().get('/:room', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return errorResponse(c, 'bad_request', 'a live room is a WebSocket: send Upgrade: websocket')
  }
  const origin = c.req.header('Origin')
  if (!originAllowed(c, origin)) {
    return errorResponse(c, 'forbidden', `a live socket from ${origin} is not allowed`)
  }
  const name = c.req.param('room')
  const room = roomOf(name)
  if (room === null || !(await isWatchable(c.env.DB, room))) {
    return errorResponse(c, 'not_found', `no live room ${name}`)
  }
  const stub = c.env.LIVE_ROOM.get(c.env.LIVE_ROOM.idFromName(liveRoomName(room)))
  const headers = new Headers({ Upgrade: 'websocket' })
  const client = c.req.header('CF-Connecting-IP')
  if (client !== undefined) headers.set('CF-Connecting-IP', client)
  return stub.fetch(`https://live-room/${encodeURIComponent(liveRoomName(room))}`, { headers })
})
