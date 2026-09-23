import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'
import { parseTokenRules, themeTokens } from '../src/index'
import { SPEC_TYPE } from './spec'
import { readWoff2 } from './woff2'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const FONTS = resolve(SRC, 'fonts')

/** Compiles src/tailwind.css as the app's build does, loading each `@import` from disk. */
async function compileKit() {
  const entry = resolve(SRC, 'tailwind.css')
  return compile(await readFile(entry, 'utf8'), {
    base: SRC,
    from: entry,
    async loadStylesheet(id, base) {
      const path =
        id === 'tailwindcss' ? Bun.resolveSync('tailwindcss/index.css', base) : resolve(base, id)
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    },
  })
}

let build: (candidates: string[]) => string = () => ''
beforeAll(async () => {
  const compiler = await compileKit()
  build = (candidates) => compiler.build(candidates)
})

/** The declarations of the first rule for `selector` in `css`, or null when there is none. */
function rule(css: string, selector: string): Record<string, string> | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const body = new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^{}]*)\\}`).exec(css)?.[1]
  if (body === undefined) return null
  return Object.fromEntries(
    body
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  )
}

/** Utility color name → the token it reads. */
const COLORS: readonly (readonly [string, string])[] = [
  ['bg', '--bg'],
  ['panel', '--panel'],
  ['panel-2', '--panel-2'],
  ['border', '--border'],
  ['border-strong', '--border-strong'],
  ['text', '--text'],
  ['muted', '--text-muted'],
  ['dim', '--text-dim'],
  ['bright', '--text-bright'],
  ['accent', '--accent'],
  ['accent-2', '--accent-2'],
  ['accent-10', '--accent-10'],
  ['accent-25', '--accent-25'],
  ['accent-45', '--accent-45'],
  ['accent-80', '--accent-80'],
  ['warn', '--warn'],
  ['danger', '--danger'],
  ['info', '--info'],
  ['arena-bg', '--arena-bg'],
  ['arena-lattice', '--arena-lattice'],
  ['arena-ruler', '--arena-ruler'],
  ['arena-ip', '--arena-ip'],
  ['arena-exec', '--arena-exec'],
  ['arena-write', '--arena-write'],
  ...Array.from({ length: 12 }, (_, i) => [`bot-${i}`, `--bot-${i}`] as const),
]

/** §3 role → its utility. */
const TYPE_UTILITIES: Readonly<Record<string, string>> = {
  Ticker: 'text-ticker',
  Brand: 'text-brand',
  'Nav button': 'text-nav',
  'Panel title': 'text-panel-title',
  'Panel status': 'text-panel-status',
  Body: 'text-body',
  'Data cell': 'text-data',
  Code: 'text-code',
  'Stat number': 'text-stat',
  'Modal title': 'text-modal-title',
}

describe('tailwind.css', () => {
  it('makes bg-panel, text-muted, and border-border read the tokens', () => {
    const css = build(['bg-panel', 'text-muted', 'border-border'])
    expect(rule(css, '.bg-panel')).toEqual({ 'background-color': 'var(--panel)' })
    expect(rule(css, '.text-muted')).toEqual({ color: 'var(--text-muted)' })
    expect(rule(css, '.border-border')).toEqual({ 'border-color': 'var(--border)' })
  })

  it('maps every color token to bg-, text-, and border- utilities', () => {
    const css = build(COLORS.flatMap(([name]) => [`bg-${name}`, `text-${name}`, `border-${name}`]))
    for (const [name, token] of COLORS) {
      expect(rule(css, `.bg-${name}`)).toEqual({ 'background-color': `var(${token})` })
      expect(rule(css, `.text-${name}`)).toEqual({ color: `var(${token})` })
      expect(rule(css, `.border-${name}`)).toEqual({ 'border-color': `var(${token})` })
    }
    // Every color in tokens.css has a utility.
    const tokens = themeTokens(
      parseTokenRules(readFileSync(resolve(SRC, 'tokens.css'), 'utf8')),
      null,
    )
    const colors = Object.keys(tokens).filter((name) => /^(#|color-mix)/.test(tokens[name] ?? ''))
    expect(colors.sort()).toEqual(COLORS.map(([, token]) => token).sort())
  })

  it('drops the Tailwind palette, type sizes, and radii', () => {
    const css = build(['bg-red-500', 'text-white', 'text-black', 'text-xs', 'text-lg', 'rounded'])
    for (const gone of ['.bg-red-500', '.text-white', '.text-black', '.text-xs', '.text-lg']) {
      expect({ gone, rule: rule(css, gone) }).toEqual({ gone, rule: null })
    }
    expect(rule(css, '.rounded')).toBeNull()
  })

  it('spaces in 4 px steps, rounds to 3, 4, and 6 px, and stacks by the z scale', () => {
    const css = build([
      ...[1, 2, 3, 4, 6, 8].map((n) => `p-${n}`),
      'rounded-sm',
      'rounded-md',
      'rounded-lg',
      'z-ticker',
      'z-header',
      'z-toast',
      'z-modal',
    ])
    expect(rule(css, '.p-1')).toEqual({ padding: 'var(--space-1)' })
    for (const n of [2, 3, 4, 6, 8]) {
      expect(rule(css, `.p-${n}`)).toEqual({ padding: `calc(var(--space-1) * ${n})` })
    }
    for (const size of ['sm', 'md', 'lg']) {
      expect(rule(css, `.rounded-${size}`)).toEqual({ 'border-radius': `var(--radius-${size})` })
    }
    for (const layer of ['ticker', 'header', 'toast', 'modal']) {
      expect(rule(css, `.z-${layer}`)).toEqual({ 'z-index': `var(--z-${layer})` })
    }
  })

  it('sets monospace everywhere with tabular numerals and the distinct zero', () => {
    const css = build(['font-mono', 'font-sans'])
    expect(rule(css, '.font-mono')).toEqual({ 'font-family': 'var(--font-mono)' })
    expect(rule(css, '.font-sans')).toEqual({ 'font-family': 'var(--font-mono)' })
    for (const selector of ['html, :host', 'code, kbd, samp, pre']) {
      const base = rule(css, selector)
      expect(base?.['font-family']?.startsWith('var(--font-mono,')).toBe(true)
      expect(base?.['font-feature-settings']).toBe('"tnum", "zero"')
    }
    expect(rule(css, 'html')).toEqual({ 'background-color': 'var(--bg)', color: 'var(--text)' })
  })

  it('has a utility for each §3 type role with the spec values', () => {
    expect(SPEC_TYPE.map((t) => t.role).sort()).toEqual(Object.keys(TYPE_UTILITIES).sort())
    const css = build(Object.values(TYPE_UTILITIES))
    for (const spec of SPEC_TYPE) {
      const utility = TYPE_UTILITIES[spec.role] as string
      const got = rule(css, `.${utility}`)
      expect({ utility, got }).toEqual({
        utility,
        got: {
          'font-size': `${spec.size}px`,
          'line-height': `${spec.lineHeight}px`,
          'font-weight': String(spec.weight),
          'letter-spacing': spec.tracking === 0 ? '0' : `${spec.tracking}em`,
          'text-transform': spec.upper ? 'uppercase' : 'none',
          ...(spec.tabular ? { 'font-variant-numeric': 'tabular-nums' } : {}),
        },
      })
    }
  })

  it('emits no second copy of a token', () => {
    const css = build(['bg-panel', 'rounded-md', 'font-mono', 'p-3', 'z-modal'])
    const themeLayer = /@layer theme \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    const names = [...themeLayer.matchAll(/(--[\w-]+):/g)].map((m) => m[1])
    expect(names.filter((name) => !name?.startsWith('--font-weight-'))).toEqual([])
  })

  it('carries the tokens and the font faces', () => {
    const css = build([])
    for (const theme of ['sentinel', 'amber', 'pedurple', 'ice', 'paper']) {
      expect(css).toContain(`:root[data-theme="${theme}"] {`)
    }
    expect(css.match(/@font-face \{/g)).toHaveLength(5)
  })
})

/** The characters the design draws besides letters and digits (DESIGN_SYSTEM §4, §9). */
const UI_GLYPHS = '·→←↑↓▍▾▸▲▼●○◆✓✕⌘⇧⌥⌫⏎…—–─│┌┐└┘├┤█░▒▓×±≥≤'

describe('fonts/jetbrains-mono.css', () => {
  const css = readFileSync(resolve(FONTS, 'jetbrains-mono.css'), 'utf8')
  const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(
    (m) => rule(`.face {${m[1]}}`, '.face') ?? {},
  )

  /** The code points of a unicode-range. */
  const inRange = (range: string, c: number) =>
    range.split(',').some((part) => {
      const [lo = '', hi = lo] = part.trim().replace('U+', '').split('-')
      return c >= Number.parseInt(lo, 16) && c <= Number.parseInt(hi, 16)
    })

  it('declares weights 300 to 700 of JetBrains Mono with font-display: swap', () => {
    expect(faces.map((f) => f['font-weight'])).toEqual(['300', '400', '500', '600', '700'])
    for (const face of faces) {
      expect(face['font-family']).toBe('"JetBrains Mono"')
      expect(face['font-style']).toBe('normal')
      expect(face['font-display']).toBe('swap')
      expect(face['unicode-range']).toBe(faces[0]?.['unicode-range'])
    }
  })

  it('points each face at a woff2 subset of that weight with the glyphs the UI draws', () => {
    const range = faces[0]?.['unicode-range'] ?? ''
    for (const face of faces) {
      const file = /url\("\.\/([^"]+)"\) format\("woff2"\)/.exec(face.src ?? '')?.[1] ?? ''
      const bytes = readFileSync(resolve(FONTS, file))
      // A latin subset: the full font is 90 KB a weight.
      expect(bytes.byteLength).toBeLessThan(24 * 1024)
      const font = readWoff2(bytes)
      expect({ file, weight: font.weight }).toEqual({ file, weight: Number(face['font-weight']) })
      const chars = `ABCXYZabcxyz0123456789${UI_GLYPHS}`
      for (const ch of chars) {
        const c = ch.codePointAt(0) as number
        expect({ file, ch, drawn: font.codePoints.has(c) && inRange(range, c) }).toEqual({
          file,
          ch,
          drawn: true,
        })
      }
      // The distinct zero stays; the code ligatures go (fonts/jetbrains-mono.css says why).
      expect(font.features.has('zero')).toBe(true)
      expect(font.features.has('calt')).toBe(false)
    }
  })
})
