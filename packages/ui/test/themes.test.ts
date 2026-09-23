import { afterEach, describe, expect, it } from 'bun:test'
import {
  ARENA_COLORS,
  applyTheme,
  BOT_HUES,
  contrastRatio,
  DEFAULT_THEME,
  getPaletteFloat32,
  initTheme,
  isTheme,
  LIGHT_THEME,
  PALETTE_INDEX,
  PALETTE_ROWS,
  parseHex,
  THEME_STORAGE_KEY,
  THEMES,
} from '../src/index'

const GLOBALS = ['document', 'localStorage', 'matchMedia'] as const
const saved = GLOBALS.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))

afterEach(() => {
  GLOBALS.forEach((name, i) => {
    const descriptor = saved[i]
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name]
    else Object.defineProperty(globalThis, name, descriptor)
  })
})

interface BrowserOptions {
  /** The stored theme, if any. */
  readonly stored?: string
  /** The system prefers light. */
  readonly light?: boolean
  /** Storage throws on every call, as in a sandboxed frame. */
  readonly blocked?: boolean
}

/** Stands in for the three browser globals that themes.ts touches. */
function browser({ stored, light = false, blocked = false }: BrowserOptions = {}) {
  const store = new Map<string, string>()
  if (stored !== undefined) store.set(THEME_STORAGE_KEY, stored)
  const root = { dataset: {} as Record<string, string> }
  const denied = () => {
    throw new Error('SecurityError: storage is off')
  }
  Object.assign(globalThis, {
    document: { documentElement: root },
    localStorage: blocked
      ? { getItem: denied, setItem: denied }
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, String(value)),
        },
    matchMedia: (query: string) => ({
      matches: light && query === '(prefers-color-scheme: light)',
    }),
  })
  return { root, store }
}

describe('THEMES', () => {
  it('lists the five themes, sentinel first', () => {
    expect([...THEMES]).toEqual(['sentinel', 'amber', 'pedurple', 'ice', 'paper'])
    expect([DEFAULT_THEME, LIGHT_THEME]).toEqual(['sentinel', 'paper'])
  })

  it('knows a theme name from anything else', () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true)
    for (const value of ['dark', 'Sentinel', '', null, undefined, 0]) {
      expect(isTheme(value)).toBe(false)
    }
  })
})

describe('BOT_HUES', () => {
  it('gives each theme 12 distinct hues, each 3:1 or more on its arena', () => {
    for (const theme of THEMES) {
      const hues = BOT_HUES[theme]
      expect(hues).toHaveLength(12)
      expect(new Set(hues).size).toBe(12)
      for (const hue of hues) {
        const ratio = contrastRatio(hue, ARENA_COLORS[theme].bg)
        expect({ theme, hue, ok: ratio >= 3 }).toEqual({ theme, hue, ok: true })
      }
    }
  })

  it('keeps each bot the same color in every theme', () => {
    for (const theme of THEMES) expect(BOT_HUES[theme]).toEqual(BOT_HUES.sentinel)
  })
})

describe('getPaletteFloat32', () => {
  /** The palette row `row` as [r, g, b, a], rounded to 1/255. */
  const row = (palette: Float32Array, i: number) =>
    [...palette.subarray(i * 4, i * 4 + 4)].map((c) => Math.round(c * 255))

  it('holds the 12 bot hues then the arena colors as RGBA rows in 0..1', () => {
    for (const theme of THEMES) {
      const palette = getPaletteFloat32(theme)
      expect(palette).toBeInstanceOf(Float32Array)
      expect(palette).toHaveLength(PALETTE_ROWS * 4)
      for (const c of palette) expect(c >= 0 && c <= 1).toBe(true)
      BOT_HUES[theme].forEach((hue, i) => {
        expect(row(palette, PALETTE_INDEX.bot + i)).toEqual([...parseHex(hue), 255])
      })
      const arena = ARENA_COLORS[theme]
      for (const key of ['bg', 'lattice', 'ruler', 'ip', 'exec', 'write'] as const) {
        expect(row(palette, PALETTE_INDEX[key])).toEqual([...parseHex(arena[key]), 255])
      }
    }
  })

  it('lays out the rows without gaps or overlap', () => {
    const { bot, ...arena } = PALETTE_INDEX
    const rows = [...Array.from({ length: 12 }, (_, i) => bot + i), ...Object.values(arena)]
    expect(rows.sort((a, b) => a - b)).toEqual(Array.from({ length: PALETTE_ROWS }, (_, i) => i))
  })

  it('returns a new array each call', () => {
    const a = getPaletteFloat32('amber')
    a.fill(0)
    expect(getPaletteFloat32('amber')[PALETTE_INDEX.ip * 4]).toBe(1)
  })

  it('differs across themes only in the arena chrome', () => {
    const sentinel = getPaletteFloat32('sentinel')
    const paper = getPaletteFloat32('paper')
    expect(paper.subarray(0, 48)).toEqual(sentinel.subarray(0, 48))
    expect(row(paper, PALETTE_INDEX.lattice)).toEqual([0x11, 0x11, 0x11, 255])
    expect(row(sentinel, PALETTE_INDEX.lattice)).toEqual([0x0e, 0x16, 0x0e, 255])
  })
})

describe('applyTheme', () => {
  it('sets data-theme and stores the choice', () => {
    const { root, store } = browser()
    applyTheme('pedurple')
    expect(root.dataset.theme).toBe('pedurple')
    expect(store.get(THEME_STORAGE_KEY)).toBe('pedurple')
  })

  it('does not store when persist is false', () => {
    const { root, store } = browser({ stored: 'ice' })
    applyTheme('amber', { persist: false })
    expect(root.dataset.theme).toBe('amber')
    expect(store.get(THEME_STORAGE_KEY)).toBe('ice')
  })

  it('still sets the attribute when storage is off', () => {
    const { root } = browser({ blocked: true })
    expect(() => applyTheme('ice')).not.toThrow()
    expect(root.dataset.theme).toBe('ice')
  })

  it('does nothing without a DOM or storage, as in a Worker', () => {
    expect(() => applyTheme('paper')).not.toThrow()
  })
})

describe('initTheme', () => {
  it('applies the stored theme', () => {
    const { root } = browser({ stored: 'amber', light: true })
    expect(initTheme()).toBe('amber')
    expect(root.dataset.theme).toBe('amber')
  })

  it('picks paper on a first visit when the system prefers light, and does not store it', () => {
    const { root, store } = browser({ light: true })
    expect(initTheme()).toBe('paper')
    expect(root.dataset.theme).toBe('paper')
    expect(store.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('picks sentinel on a first visit otherwise', () => {
    const { root } = browser()
    expect(initTheme()).toBe('sentinel')
    expect(root.dataset.theme).toBe('sentinel')
  })

  it('ignores a stored value that is not a theme', () => {
    browser({ stored: 'solarized', light: true })
    expect(initTheme()).toBe('paper')
  })

  it('falls back to the system when storage is off', () => {
    browser({ blocked: true, light: true })
    expect(initTheme()).toBe('paper')
  })

  it('returns the default without a DOM, storage, or matchMedia', () => {
    expect(initTheme()).toBe('sentinel')
  })
})
