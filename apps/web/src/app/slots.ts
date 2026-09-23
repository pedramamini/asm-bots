import { useEffect } from 'react'
import { create } from 'zustand'

interface HeaderStatState {
  /** The header's center line, muted data type: `8 bots · 41 procs · cycle 12,480`. */
  stat: string
  setStat: (stat: string) => void
}

/** The header's center stat. A route sets it; `useRouteStat` clears it when the route goes. */
export const useHeaderStat = create<HeaderStatState>((set) => ({
  stat: '',
  setStat: (stat) => set({ stat }),
}))

/** Shows `stat` in the header's center while the calling component is mounted. */
export function useRouteStat(stat: string): void {
  useEffect(() => {
    useHeaderStat.getState().setStat(stat)
  }, [stat])
  useEffect(() => () => useHeaderStat.getState().setStat(''), [])
}

interface FpsState {
  /** The frame rate of whatever animates (the arena), or null when nothing does. */
  fps: number | null
  setFps: (fps: number | null) => void
}

/** The status bar's fps chip: the arena reports its frame rate here. */
export const useFps = create<FpsState>((set) => ({
  fps: null,
  setFps: (fps) => set({ fps }),
}))
