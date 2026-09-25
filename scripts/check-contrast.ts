/**
 * `bun run contrast` measures the WCAG 2 contrast of each theme's tokens in
 * packages/ui/src/tokens.css on what they sit on (DESIGN_SYSTEM §8), prints a table, and exits 1
 * when a token falls under its floor anywhere it is checked:
 *
 * - Text, 4.5:1 (AA for small text, and every string in this UI is small): `--text`,
 *   `--text-bright`, `--text-muted`, `--accent-fg`, `--accent-2` (the editor's directives),
 *   `--warn`, `--danger`, and `--info`, on `--bg`, `--panel`, `--panel-2`, and on the
 *   `--accent-10` fill over each (an "on" control, a selected row, the editor's active line).
 * - What is "now", 4.5:1: `--text-bright` on the `--accent-25` and `--accent-45` fills too (the
 *   debugger's IP, a fresh write, a results matrix's widest win), and `--accent-fg` on
 *   `--accent-25` (a primary button under the pointer).
 * - The focus ring and the "on" border, 3:1 (non-text contrast): `--accent` on the three surfaces.
 *
 * `--text-dim` (placeholders, the input's prompt glyph, list markers: never content) has no floor;
 * the table shows it for reference.
 */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  blend,
  contrastRatio,
  parseTokenRules,
  THEMES,
  type Theme,
  themeTokens,
} from '../packages/ui/src/index'

export const TOKENS = fileURLToPath(new URL('../packages/ui/src/tokens.css', import.meta.url))

/** The surfaces text sits on. */
export const SURFACES = ['--bg', '--panel', '--panel-2'] as const

/** The accent fills (`--accent-10` …), each laid over each of the surfaces. */
export const FILLS = [10, 25, 45] as const
export type Fill = (typeof FILLS)[number]

/** A token, its floor (null: reported, never gated), and the fills it is checked on as well. */
export interface Check {
  readonly token: string
  readonly floor: number | null
  readonly fills: readonly Fill[]
}

export const CHECKS: readonly Check[] = [
  { token: '--text', floor: 4.5, fills: [10] },
  { token: '--text-bright', floor: 4.5, fills: [10, 25, 45] },
  { token: '--text-muted', floor: 4.5, fills: [10] },
  { token: '--text-dim', floor: null, fills: [] },
  { token: '--accent-fg', floor: 4.5, fills: [10, 25] },
  { token: '--accent-2', floor: 4.5, fills: [10] },
  { token: '--warn', floor: 4.5, fills: [10] },
  { token: '--danger', floor: 4.5, fills: [10] },
  { token: '--info', floor: 4.5, fills: [10] },
  { token: '--accent', floor: 3, fills: [] },
]

export interface ContrastRow {
  readonly theme: Theme
  readonly token: string
  /** The ratio on each of SURFACES, in order. */
  readonly ratios: readonly number[]
  /** The lowest ratio on each checked fill, over the three surfaces. */
  readonly fills: Readonly<Partial<Record<Fill, number>>>
  readonly floor: number | null
  /** The lowest ratio of the row, and what it is on: `--panel`, `--accent-10 over --panel`. */
  readonly worst: { readonly ratio: number; readonly on: string }
  /** True when every ratio meets the floor, or there is no floor. */
  readonly ok: boolean
}

/** A row per theme and check. Throws when a theme lacks a token it needs. */
export function measure(css: string): ContrastRow[] {
  const rules = parseTokenRules(css)
  return THEMES.flatMap((theme) => {
    const tokens = themeTokens(rules, theme)
    const color = (name: string) => {
      const value = tokens[name]
      if (value === undefined) throw new Error(`theme ${theme} has no ${name}`)
      return value
    }
    return CHECKS.map(({ token, floor, fills: checked }) => {
      const fg = color(token)
      const on = SURFACES.map((surface) => ({
        ratio: contrastRatio(fg, color(surface)),
        on: surface,
      }))
      const fills: Partial<Record<Fill, number>> = {}
      const all: { ratio: number; on: string }[] = [...on]
      for (const fill of checked) {
        const over = SURFACES.map((surface) => ({
          ratio: contrastRatio(fg, blend(color('--accent'), color(surface), fill / 100)),
          on: `--accent-${fill} over ${surface}`,
        }))
        fills[fill] = Math.min(...over.map((o) => o.ratio))
        all.push(...over)
      }
      const worst = all.reduce((low, o) => (o.ratio < low.ratio ? o : low))
      return {
        theme,
        token,
        ratios: on.map((o) => o.ratio),
        fills,
        floor,
        worst,
        ok: floor === null || worst.ratio >= floor,
      }
    })
  })
}

/** A ratio to two places, rounded down, so a ratio shown at its floor meets it. */
function ratioText(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2)
}

/** The columns right of the token: numbers, right-aligned. */
const NUMERIC = [...SURFACES, ...FILLS.map((fill) => `--accent-${fill}`), 'Floor']

/** The rows as a table: the ratio on each surface, the lowest on each fill checked, the floor. */
export function table(rows: readonly ContrastRow[]): string[] {
  const all = [
    ['Theme', 'Token', ...NUMERIC, ''],
    ...rows.map((row) => [
      row.theme,
      row.token,
      ...row.ratios.map(ratioText),
      ...FILLS.map((fill) => {
        const ratio = row.fills[fill]
        return ratio === undefined ? '-' : ratioText(ratio)
      }),
      row.floor === null ? '-' : row.floor.toFixed(1),
      row.floor === null ? '' : row.ok ? 'ok' : 'FAIL',
    ]),
  ]
  const widths = all[0]?.map((_, i) => Math.max(...all.map((row) => (row[i] ?? '').length))) ?? []
  const numeric = (i: number) => i >= 2 && i < 2 + NUMERIC.length
  return all.map((row) =>
    row
      .map((cell, i) => (numeric(i) ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd(),
  )
}

export interface ContrastOptions {
  /** The token stylesheet. */
  readonly file: string
  /** Where the report goes, a line at a time. */
  readonly log: (line: string) => void
}

/** Checks the stylesheet and prints the report. Returns the exit code: 0, or 1 on a failure. */
export async function contrast(options: ContrastOptions): Promise<number> {
  const { file, log } = options
  const shown = relative(process.cwd(), file)
  let rows: ContrastRow[]
  try {
    rows = measure(await readFile(file, 'utf8'))
  } catch (e) {
    log(`contrast: cannot check ${shown}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  for (const line of table(rows)) log(line)
  const failed = rows.filter((row) => !row.ok)
  log('')
  if (failed.length === 0) {
    const checked = rows.filter((row) => row.floor !== null).length
    log(`contrast: all ${checked} checks meet their floor in ${shown}.`)
    return 0
  }
  for (const row of failed) {
    log(
      `contrast: ${row.theme} ${row.token} is ${ratioText(row.worst.ratio)}:1 on ${row.worst.on}, ` +
        `under its floor of ${row.floor}:1.`,
    )
  }
  return 1
}

/** The command line. A test passes its own file and log. */
export function main(options: Partial<ContrastOptions> = {}): Promise<number> {
  return contrast({ file: TOKENS, log: console.log, ...options })
}

if (import.meta.main) process.exit(await main())
