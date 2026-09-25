import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  ARENA_COLORS,
  BOT_HUES,
  parseTokenRules,
  THEMES,
  type Theme,
  themeTokens,
} from '../src/index'
import { SPEC_HUES, SPEC_TOKENS } from './spec'

const CSS = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
const RULES = parseTokenRules(CSS)

/** The custom properties declared by the rules that name `theme` itself. */
function declared(theme: Theme): Record<string, string> {
  const own = RULES.filter((rule) => rule.selectors.includes(`:root[data-theme="${theme}"]`))
  return Object.assign({}, ...own.map((rule) => rule.props))
}

describe('tokens.css', () => {
  it('has the spec tables to check against', () => {
    expect(Object.keys(SPEC_TOKENS.sentinel)).toHaveLength(21)
    expect(SPEC_HUES).toHaveLength(12)
  })

  it('declares every §2 token in each theme block with the spec value', () => {
    for (const theme of THEMES) {
      const own = declared(theme)
      for (const [token, value] of Object.entries(SPEC_TOKENS[theme])) {
        expect({ theme, token, value: own[token] }).toEqual({ theme, token, value })
      }
    }
  })

  it('declares the 12 bot hues in each theme block', () => {
    for (const theme of THEMES) {
      const own = declared(theme)
      const hues = SPEC_HUES.map((_, i) => own[`--bot-${i}`])
      expect({ theme, hues }).toEqual({ theme, hues: [...SPEC_HUES] })
      expect(own['--bot-12']).toBeUndefined()
    }
  })

  it('falls back to sentinel without a data-theme or with an unknown one', () => {
    const sentinel = themeTokens(RULES, 'sentinel')
    expect(themeTokens(RULES, null)).toEqual(sentinel)
    expect(themeTokens(RULES, 'solarized')).toEqual(sentinel)
    expect(themeTokens(RULES, 'paper')['--bg']).toBe('#F4F1EA')
  })

  it('computes the accent fills from the active accent', () => {
    const root = themeTokens(RULES, null)
    for (const alpha of [10, 25, 45, 80]) {
      expect(root[`--accent-${alpha}`]).toBe(
        `color-mix(in srgb, var(--accent) ${alpha}%, transparent)`,
      )
    }
    // Declared once on :root, so no theme block can pin a stale fill.
    for (const theme of THEMES) expect(declared(theme)['--accent-10']).toBeUndefined()
  })

  it('has the spacing, radius, and stacking scales', () => {
    const root = themeTokens(RULES, null)
    const pick = (prefix: string) =>
      Object.fromEntries(Object.entries(root).filter(([name]) => name.startsWith(prefix)))
    expect(pick('--space-')).toEqual({
      '--space-1': '4px',
      '--space-2': '8px',
      '--space-3': '12px',
      '--space-4': '16px',
      '--space-6': '24px',
      '--space-8': '32px',
    })
    expect(pick('--radius-')).toEqual({
      '--radius-sm': '3px',
      '--radius-md': '4px',
      '--radius-lg': '6px',
    })
    expect(pick('--z-')).toEqual({
      '--z-ticker': '10',
      '--z-header': '20',
      '--z-toast': '40',
      '--z-modal': '50',
    })
    expect(root['--font-mono']?.startsWith('"JetBrains Mono", ')).toBe(true)
  })

  it('sets color-scheme per theme so native controls match', () => {
    for (const theme of THEMES) {
      const block = CSS.slice(CSS.indexOf(`:root[data-theme="${theme}"]`))
      const scheme = /color-scheme:\s*(\w+)/.exec(block)?.[1]
      expect({ theme, scheme }).toEqual({ theme, scheme: theme === 'paper' ? 'light' : 'dark' })
    }
  })

  it('agrees with the bot hues and arena colors in themes.ts', () => {
    for (const theme of THEMES) {
      const tokens = themeTokens(RULES, theme)
      expect(BOT_HUES[theme].map((_, i) => tokens[`--bot-${i}`])).toEqual([...BOT_HUES[theme]])
      const arena = ARENA_COLORS[theme]
      expect({
        bg: tokens['--arena-bg'],
        lattice: tokens['--arena-lattice'],
        ruler: tokens['--arena-ruler'],
        ip: tokens['--arena-ip'],
        exec: tokens['--arena-exec'],
        write: tokens['--arena-write'],
      }).toEqual({ ...arena })
    }
  })
})

describe('parseTokenRules', () => {
  it('reads selectors and custom properties, and drops comments and plain properties', () => {
    const rules = parseTokenRules(`
      /* a { --x: 1 } */
      :root,
      :root[data-theme='amber'] { color-scheme: dark; --a: #fff; --b: color-mix(in srgb, red 1%, blue) }
    `)
    expect(rules).toEqual([
      {
        selectors: [':root', ":root[data-theme='amber']"],
        props: { '--a': '#fff', '--b': 'color-mix(in srgb, red 1%, blue)' },
      },
    ])
  })

  it('resolves the cascade: a theme rule beats :root, a later rule beats an earlier one', () => {
    const rules = parseTokenRules(`
      :root[data-theme="ice"] { --a: ice; }
      :root { --a: root; --b: root; }
      :root { --b: later; }
    `)
    expect(themeTokens(rules, 'ice')).toEqual({ '--a': 'ice', '--b': 'later' })
    expect(themeTokens(rules, 'amber')).toEqual({ '--a': 'root', '--b': 'later' })
    expect(themeTokens(rules, null)).toEqual({ '--a': 'root', '--b': 'later' })
  })
})
