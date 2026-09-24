import { useEffect, useRef, useState } from 'react'
import { createStore, useStore } from 'zustand'
import { IDLE_ROOM, LiveRoomClient, type LiveRoomOptions, type LiveRoomState } from './room'

/** The store a page reads while it asks for no room. */
const IDLE_STORE = createStore<LiveRoomState>()(() => IDLE_ROOM)

/**
 * Room `room`'s live state (`room.ts`): its socket opens when the page asks for the room and
 * closes when the page stops asking or goes away. Null asks for none. `options` are read when the
 * socket opens: tests pass a stand-in socket and timers.
 */
export function useLiveRoom(room: string | null, options?: LiveRoomOptions): LiveRoomState {
  const [client, setClient] = useState<LiveRoomClient | null>(null)
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    if (room === null) return
    const made = new LiveRoomClient(room, latest.current)
    setClient(made)
    return () => {
      made.dispose()
      setClient(null)
    }
  }, [room])
  return useStore(client?.store ?? IDLE_STORE)
}
