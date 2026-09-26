import { parseHex } from './color'

/**
 * The seven themes (DESIGN_SYSTEM §2); tokyo-night and catppuccin (Mocha) after Maestro's. tokens.css holds every token of every theme. This module
 * holds what code needs without a stylesheet: the names, the switch, and the colors that the arena
 * renderer uploads as a uniform.
 */
export const THEMES = [
  'sentinel',
  'amber',
  'pedurple',
  'ice',
  'tokyo-night',
  'catppuccin',
  'paper',
] as const
export type Theme = (typeof THEMES)[number]

/** The theme of a first visit, unless the system prefers light. */
export const DEFAULT_THEME: Theme = 'sentinel'
/** The theme of a first visit when the system prefers light. */
export const LIGHT_THEME: Theme = 'paper'
/** The localStorage key that holds the user's choice. */
export const THEME_STORAGE_KEY = 'theme'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/** The 12 bot hues (DESIGN_SYSTEM §2): 3:1 or more on black, distinct at 4 px cells. */
const HUES = [
  '#FF5C5C',
  '#FF9F43',
  '#FFD93D',
  '#7CFC00',
  '#00FF88',
  '#2DE2E6',
  '#4CC9F0',
  '#7B7BFF',
  '#B57BFF',
  '#FF6BD6',
  '#FF8FA3',
  '#E0E0E0',
] as const

/**
 * The bot hues of each theme, by bot index (the engine's owner - 1). Bot 12 and up wrap to hue
 * `index % 12`. The arena is black in every theme, so each theme keeps the same 12 hues, and a bot
 * keeps its color when the user changes the theme. Mirrors `--bot-0` … `--bot-11` in tokens.css.
 */
export const BOT_HUES: Readonly<Record<Theme, readonly string[]>> = {
  sentinel: HUES,
  amber: HUES,
  pedurple: HUES,
  ice: HUES,
  'tokyo-night': HUES,
  catppuccin: HUES,
  paper: HUES,
}

/** The arena's colors (DESIGN_SYSTEM §2, §5). */
export interface ArenaColors {
  readonly bg: string
  readonly lattice: string
  readonly ruler: string
  readonly ip: string
  readonly exec: string
  readonly write: string
}

/** The arena colors of each theme. Mirrors `--arena-*` in tokens.css. */
export const ARENA_COLORS: Readonly<Record<Theme, ArenaColors>> = {
  sentinel: arena('#0E160E', '#3A5A3A'),
  amber: arena('#160F00', '#5A4620'),
  pedurple: arena('#120C1C', '#4A3A6A'),
  ice: arena('#081218', '#2A5A6A'),
  'tokyo-night': arena('#10111A', '#414868'),
  catppuccin: arena('#0F0F18', '#585B70'),
  paper: arena('#111111', '#666666'),
}

/** Every theme's arena is black, with a white IP, a yellow exec trail, and a white write flash. */
function arena(lattice: string, ruler: string): ArenaColors {
  return { bg: '#000000', lattice, ruler, ip: '#FFFFFF', exec: '#FFEB3B', write: '#FFFFFF' }
}

/**
 * The rows of `getPaletteFloat32`, one RGBA color each: the 12 bot hues from row `bot`, then the
 * arena colors. A shader declares `uniform vec4 uPalette[PALETTE_ROWS]`.
 */
export const PALETTE_INDEX = {
  bot: 0,
  bg: 12,
  lattice: 13,
  ruler: 14,
  ip: 15,
  exec: 16,
  write: 17,
} as const
export const PALETTE_ROWS = 18

/**
 * A theme's bot hues and arena colors for the renderer: `PALETTE_ROWS` RGBA rows, sRGB, each
 * channel 0..1, alpha 1, in the order of `PALETTE_INDEX`. Each call returns a new array.
 */
export function getPaletteFloat32(theme: Theme): Float32Array {
  const { bg, lattice, ruler, ip, exec, write } = ARENA_COLORS[theme]
  const colors = [...BOT_HUES[theme], bg, lattice, ruler, ip, exec, write]
  const out = new Float32Array(PALETTE_ROWS * 4)
  colors.forEach((hex, row) => {
    const [r, g, b] = parseHex(hex)
    out.set([r / 255, g / 255, b / 255, 1], row * 4)
  })
  return out
}

/**
 * Sets `<html data-theme>` and, unless `persist` is false, stores the choice in
 * `localStorage.theme`. Without a DOM it skips the attribute; without storage it skips the store.
 */
export function applyTheme(theme: Theme, { persist = true }: { persist?: boolean } = {}): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  if (!persist) return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // No storage (a Worker, a sandboxed frame, storage turned off): the theme holds for this page.
  }
}

/**
 * Applies the stored theme. On a first visit it applies paper when the system prefers light and
 * sentinel otherwise, and does not store it, so the theme follows the system until the user picks
 * one. Returns the theme it applied.
 */
export function initTheme(): Theme {
  const theme = storedTheme() ?? (prefersLight() ? LIGHT_THEME : DEFAULT_THEME)
  applyTheme(theme, { persist: false })
  return theme
}

/** The stored theme, or null when there is none, it is not a theme, or storage is off. */
function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

function prefersLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
}
