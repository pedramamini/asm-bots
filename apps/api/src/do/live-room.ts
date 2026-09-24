import { DurableObject } from 'cloudflare:workers'
import { LiveMessage, parse } from '@asmbots/protocol'
import type { Env } from '../env'

/** The messages a room keeps for a spectator who joins late. */
export const BACKLOG = 20

/**
 * One per tournament or hill (`liveRoomName`): fans `LiveMessage`s out to spectators over
 * WebSockets (ARCHITECTURE §7). Its `Runner`s publish to it; it keeps the last `BACKLOG`
 * messages. The sockets come with the spectating task of EXEC 3.3.
 */
export class LiveRoom extends DurableObject<Env> {
  /** Takes a `Runner`'s messages, in order, and keeps the last `BACKLOG`. */
  async publish(messages: readonly LiveMessage[]): Promise<void> {
    const checked = messages.map((m) => parse(LiveMessage, m, 'the message'))
    const kept = (await this.recent()).concat(checked).slice(-BACKLOG)
    await this.ctx.storage.put('recent', kept)
  }

  /** The room's last messages, oldest first. */
  async recent(): Promise<LiveMessage[]> {
    return (await this.ctx.storage.get<LiveMessage[]>('recent')) ?? []
  }
}
