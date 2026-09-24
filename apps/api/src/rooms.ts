/**
 * The spectators in the live rooms: the ticker's "watching" and the admin stats. Only a room a page
 * may have open is asked for its count (`LiveRoom.spectators`): every hill's, since a hill page
 * always joins its room, and each tournament's while it is scheduled or running (a page opens no
 * socket on one that has ended). Hills first, then running tournaments, then scheduled ones.
 */
import type { AdminRoom } from '@asmbots/protocol'
import type { Env } from './env'
import { log } from './middleware'
import { messageOf } from './runner/job'

/** The most rooms one count asks: each is a Durable Object request. */
export const MAX_ASKED_ROOMS = 64

/** The rooms a page may have open (`liveRoomName`s), at most `limit`. */
export async function openableRooms(db: D1Database, limit = MAX_ASKED_ROOMS): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT room FROM (
         SELECT 'hill:' || id AS room, 0 AS rank, created_at AS at FROM hills
         UNION ALL
         SELECT 'tournament:' || id, CASE status WHEN 'running' THEN 1 ELSE 2 END, starts_at
         FROM tournaments WHERE status IN ('running', 'scheduled'))
       ORDER BY rank, at IS NULL, at, room LIMIT ?`,
    )
    .bind(limit)
    .all<{ room: string }>()
  return results.map((row) => row.room)
}

/** Each of `rooms` with its open sockets; a room that does not answer counts none. */
export async function countSpectators(
  env: Pick<Env, 'LIVE_ROOM'>,
  rooms: readonly string[],
): Promise<AdminRoom[]> {
  const counts = await Promise.allSettled(
    rooms.map((room) => env.LIVE_ROOM.get(env.LIVE_ROOM.idFromName(room)).spectators()),
  )
  return rooms.map((room, i) => {
    const count = counts[i] as PromiseSettledResult<number>
    if (count.status === 'fulfilled') return { room, spectators: count.value }
    log('warn', 'rooms.count', { room, error: messageOf(count.reason) })
    return { room, spectators: 0 }
  })
}
