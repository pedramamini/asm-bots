/**
 * The battle view's own state (PRODUCT_SPEC §2): what the player picked to look at, apart from the
 * battle itself (`useArena`). A click on a bot's row, or `1`..`9`, isolates bots: the others dim.
 */
import { create } from 'zustand'

/** How long a match rests between rounds when autoplay is on, ms: time to read the round's end. */
export const ROUND_PAUSE_MS = 1500

/** What the events log shows: everything, no spawns, or the bots' fates alone. */
export type EventFilter = 'all' | 'deaths' | 'bots'

export interface ArenaViewState {
  /** The bots isolated, ascending: the others dim. None: every bot as it is. */
  readonly isolated: readonly number[]
  /** Whether the minimap shows when zoomed in. */
  readonly minimap: boolean
  /** Whether a match goes on to its next round by itself. */
  readonly autoplay: boolean
  /** Which events the log lists. */
  readonly events: EventFilter
  /**
   * Isolates `bot`. Alone: it replaces the isolation, and isolating the one bot isolated turns it
   * off. With `add` (a shift-click): it joins the isolated bots, or leaves them.
   */
  isolate: (bot: number, add?: boolean) => void
  /** Every bot as it is again. */
  clearIsolation: () => void
  setMinimap: (on: boolean) => void
  setAutoplay: (on: boolean) => void
  setEvents: (filter: EventFilter) => void
}

export const useArenaView = create<ArenaViewState>()((set) => ({
  isolated: [],
  minimap: true,
  autoplay: false,
  events: 'all',
  isolate: (bot, add = false) =>
    set(({ isolated }) => {
      const has = isolated.includes(bot)
      if (!add) return { isolated: has && isolated.length === 1 ? [] : [bot] }
      const next = has ? isolated.filter((b) => b !== bot) : [...isolated, bot]
      return { isolated: next.sort((a, b) => a - b) }
    }),
  clearIsolation: () => set({ isolated: [] }),
  setMinimap: (minimap) => set({ minimap }),
  setAutoplay: (autoplay) => set({ autoplay }),
  setEvents: (events) => set({ events }),
}))
