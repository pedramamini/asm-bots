import { useReducedMotion } from '@asmbots/ui'
import {
  applyTheme,
  DEFAULT_THEME,
  initTheme,
  isTheme,
  THEME_STORAGE_KEY,
  THEMES,
  type Theme,
} from '@asmbots/ui/themes'
import { useCallback } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

/** The localStorage key of the persisted settings (the theme keeps its own: `THEME_STORAGE_KEY`). */
export const SETTINGS_STORAGE_KEY = 'asmbots:settings'

/** The arena's post effects (DESIGN_SYSTEM §5): the user's switches. */
export interface ArenaEffects {
  bloom: boolean
  scanlines: boolean
  vignette: boolean
}

/** Reduced motion: `system` follows `prefers-reduced-motion`; `reduce` and `full` override it. */
export type MotionPreference = 'system' | 'reduce' | 'full'
export const MOTION_PREFERENCES = ['system', 'reduce', 'full'] as const

/** Whether to reduce motion: the user's preference, or the system's (`systemReduced`) under `system`. */
export function motionReduced(motion: MotionPreference, systemReduced: boolean): boolean {
  return motion === 'reduce' || (motion === 'system' && systemReduced)
}

/** The arena's sound cues (DESIGN_SYSTEM §7), each of which the user can turn off. */
export const SOUND_CUES = ['tick', 'write', 'death', 'botDeath', 'victory', 'click'] as const
export type SoundCue = (typeof SOUND_CUES)[number]

/** The sound (DESIGN_SYSTEM §7): off by default. */
export interface SoundSettings {
  on: boolean
  /** Master volume, 0..1. */
  volume: number
  /** Each cue on or off. `on` rules over them all. */
  cues: Record<SoundCue, boolean>
}

/** The arena setup the user last fought with (PRODUCT_SPEC §2), so the next visit starts there. */
export interface ArenaConfig {
  /** The preset chip it came from (`duel`, `melee 8`), or null for a hand-made config. */
  preset: string | null
  rounds: number
  maxCycles: number
  /** A fixed seed, or null for a random one each battle. */
  seed: number | null
  maxProcesses: number
  minSpacing: number
}

/** What the settings store persists. */
export interface Settings {
  effects: ArenaEffects
  motion: MotionPreference
  sound: SoundSettings
  /** The ids of the coach marks the user has dismissed: `arena`, `editor`. */
  coachMarksSeen: string[]
  lastArenaConfig: ArenaConfig | null
}

export interface SettingsState extends Settings {
  /** The theme on `<html data-theme>`. Stored apart, in `localStorage.theme`: the boot script reads it. */
  theme: Theme
  /** Applies `theme` and stores it. */
  setTheme: (theme: Theme) => void
  /** The next theme in `THEMES` order, after the last the first: the `t` key. */
  cycleTheme: () => void
  setEffect: (effect: keyof ArenaEffects, on: boolean) => void
  setMotion: (motion: MotionPreference) => void
  setSound: (sound: Partial<Omit<SoundSettings, 'cues'>>) => void
  setCue: (cue: SoundCue, on: boolean) => void
  /** Records that the user dismissed a coach mark; it never shows again. */
  markCoachSeen: (id: string) => void
  setLastArenaConfig: (config: ArenaConfig | null) => void
  /** Every setting back to its default, the theme included (it follows the system again). */
  reset: () => void
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  effects: { bloom: true, scanlines: true, vignette: true },
  motion: 'system',
  sound: { on: false, volume: 0.5, cues: allCues(true) },
  coachMarksSeen: [],
  lastArenaConfig: null,
})

/** Every cue, each `on`. */
function allCues(on: boolean): Record<SoundCue, boolean> {
  return Object.fromEntries(SOUND_CUES.map((cue) => [cue, on])) as Record<SoundCue, boolean>
}

/** The theme after `theme`, wrapping. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? DEFAULT_THEME
}

/** The theme on the page: the boot script (or `initTheme()`) has put it on `<html>`. */
function pageTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME
  const theme = document.documentElement.dataset.theme
  return isTheme(theme) ? theme : DEFAULT_THEME
}

/**
 * localStorage, looked up on each call: storage turned off (or no DOM yet, as when a test imports
 * this module) reads as empty and drops writes, where zustand would give up on persisting for good.
 */
export const localStore: StateStorage = {
  getItem: (name) => attempt(() => localStorage.getItem(name), null),
  setItem: (name, value) => attempt(() => localStorage.setItem(name, value), undefined),
  removeItem: (name) => attempt(() => localStorage.removeItem(name), undefined),
}

function attempt<T>(run: () => T, fallback: T): T {
  try {
    return run()
  } catch {
    return fallback
  }
}

/** A fresh copy of the defaults, so no state shares the frozen objects. */
function defaults(): Settings {
  return structuredClone(DEFAULT_SETTINGS) as Settings
}

/**
 * The user's settings, persisted to `localStorage[SETTINGS_STORAGE_KEY]`. The theme is the
 * exception: the page's `data-theme` is its truth and `localStorage.theme` its store, because the
 * boot script must read it before any bundle runs.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaults(),
      theme: pageTheme(),
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      cycleTheme: () => {
        // From the chosen theme, not the page's: the settings page may be previewing another.
        const theme = nextTheme(get().theme)
        applyTheme(theme)
        set({ theme })
      },
      setEffect: (effect, on) => set((state) => ({ effects: { ...state.effects, [effect]: on } })),
      setMotion: (motion) => set({ motion }),
      setSound: (sound) =>
        set((state) => ({ sound: sanitizeSound({ ...state.sound, ...sound }) ?? state.sound })),
      setCue: (cue, on) =>
        set((state) => ({ sound: { ...state.sound, cues: { ...state.sound.cues, [cue]: on } } })),
      markCoachSeen: (id) =>
        set((state) =>
          state.coachMarksSeen.includes(id)
            ? state
            : { coachMarksSeen: [...state.coachMarksSeen, id] },
        ),
      setLastArenaConfig: (lastArenaConfig) => set({ lastArenaConfig }),
      reset: () => {
        localStore.removeItem(THEME_STORAGE_KEY)
        set({ ...defaults(), theme: initTheme() })
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStore),
      partialize: ({ effects, motion, sound, coachMarksSeen, lastArenaConfig }): Settings => ({
        effects,
        motion,
        sound,
        coachMarksSeen,
        lastArenaConfig,
      }),
      // Storage is the user's to edit: take what is well formed, keep the default for the rest.
      merge: (stored, current) => ({ ...current, ...sanitizeSettings(stored) }),
    },
  ),
)

/** The well-formed fields of a stored settings object. */
export function sanitizeSettings(stored: unknown): Partial<Settings> {
  if (!isRecord(stored)) return {}
  const out: Partial<Settings> = {}
  if (isRecord(stored.effects)) {
    const effects = { ...DEFAULT_SETTINGS.effects }
    for (const key of Object.keys(effects) as (keyof ArenaEffects)[]) {
      const value = stored.effects[key]
      if (typeof value === 'boolean') effects[key] = value
    }
    out.effects = effects
  }
  if (MOTION_PREFERENCES.includes(stored.motion as MotionPreference)) {
    out.motion = stored.motion as MotionPreference
  }
  const sound = sanitizeSound(stored.sound)
  if (sound !== null) out.sound = sound
  if (Array.isArray(stored.coachMarksSeen)) {
    out.coachMarksSeen = [
      ...new Set(stored.coachMarksSeen.filter((id): id is string => typeof id === 'string')),
    ]
  }
  if (stored.lastArenaConfig === null || isArenaConfig(stored.lastArenaConfig)) {
    out.lastArenaConfig = stored.lastArenaConfig
  }
  return out
}

/** `sound` when its switch and volume are well formed, with its cues' switches; a missing one is on. */
function sanitizeSound(sound: unknown): SoundSettings | null {
  if (!isRecord(sound) || typeof sound.on !== 'boolean') return null
  if (typeof sound.volume !== 'number' || Number.isNaN(sound.volume)) return null
  const cues = allCues(true)
  if (isRecord(sound.cues)) {
    for (const cue of SOUND_CUES) {
      const on = sound.cues[cue]
      if (typeof on === 'boolean') cues[cue] = on
    }
  }
  return { on: sound.on, volume: Math.min(1, Math.max(0, sound.volume)), cues }
}

function isArenaConfig(value: unknown): value is ArenaConfig {
  if (!isRecord(value)) return false
  const counts = ['rounds', 'maxCycles', 'maxProcesses', 'minSpacing'] as const
  return (
    (value.preset === null || typeof value.preset === 'string') &&
    (value.seed === null || Number.isInteger(value.seed)) &&
    counts.every((key) => Number.isInteger(value[key]) && (value[key] as number) >= 0)
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A first-visit coach mark (PRODUCT_SPEC §9) by id (`arena`, `editor`): open until the user
 * dismisses it, then never again.
 */
export function useCoachMark(id: string): { open: boolean; dismiss: () => void } {
  const open = useSettings((state) => !state.coachMarksSeen.includes(id))
  const markCoachSeen = useSettings((state) => state.markCoachSeen)
  const dismiss = useCallback(() => markCoachSeen(id), [markCoachSeen, id])
  return { open, dismiss }
}

/** Whether to reduce motion now (DESIGN_SYSTEM §8): the setting, or the system's under `system`. */
export function useMotionReduced(): boolean {
  const motion = useSettings((state) => state.motion)
  return motionReduced(motion, useReducedMotion())
}
