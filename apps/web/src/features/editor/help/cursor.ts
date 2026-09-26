import { useSyncExternalStore } from 'react'

/**
 * The word the editor's cursor is on, as a help topic's name (`mov`, `%name`, `ax`), or null: set
 * as the cursor moves, read by the help panel alone, so a move redraws that panel and no other.
 */
export interface CursorTopic {
  get: () => string | null
  set: (name: string | null) => void
  subscribe: (listener: () => void) => () => void
}

export function createCursorTopic(): CursorTopic {
  let name: string | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => name,
    set(next) {
      if (next === name) return
      name = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useCursorTopic(store: CursorTopic): string | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
