import { applyTheme, DEFAULT_THEME, isTheme, THEMES, type Theme } from '@asmbots/ui/themes'
import { create } from 'zustand'

interface ThemeState {
  /** The theme on `<html data-theme>`. */
  theme: Theme
  /** Applies `theme` and stores it (`localStorage.theme`, which the boot script reads). */
  setTheme: (theme: Theme) => void
  /** The next theme in `THEMES` order, after the last the first: the `t` key. */
  cycleTheme: () => void
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

/** The app's theme. The page's `data-theme` is the truth; the store makes it reactive. */
export const useTheme = create<ThemeState>((set) => ({
  theme: pageTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  cycleTheme: () => {
    const theme = nextTheme(pageTheme())
    applyTheme(theme)
    set({ theme })
  },
}))
