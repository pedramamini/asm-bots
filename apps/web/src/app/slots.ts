import { useEffect } from 'react'
import { create } from 'zustand'
import type { PageAbout } from './PageIntro'

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

interface HeaderAboutState {
  /** What the page says about itself: the `ⓘ` beside its name in the header. Null for none. */
  about: PageAbout | null
}

/** The header's `ⓘ`. A route sets it; `useRouteAbout` clears it when the route goes. */
export const useHeaderAbout = create<HeaderAboutState>(() => ({ about: null }))

/** Shows `about`'s `ⓘ` beside the page's name in the header while the caller is mounted. */
export function useRouteAbout(about: PageAbout): void {
  useEffect(() => {
    useHeaderAbout.setState({ about })
    return () => {
      if (useHeaderAbout.getState().about === about) useHeaderAbout.setState({ about: null })
    }
  }, [about])
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
