/**
 * `bun run contrast` measures the WCAG 2 contrast of each text token on --bg, --panel, and
 * --panel-2, in every theme of packages/ui/src/tokens.css (DESIGN_SYSTEM §8), and prints a table.
 * It exits 1 when a token falls under its floor on any of the three: 4.5:1 for --text and
 * --text-bright, 3:1 for --text-muted. --text-dim (placeholders, the prompt glyph) has no floor;
 * the table shows it for reference.
 */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  contrastRatio,
  parseTokenRules,
  THEMES,
  type Theme,
  themeTokens,
} from '../packages/ui/src/index'

export const TOKENS = fileURLToPath(new URL('../packages/ui/src/tokens.css', import.meta.url))

/** The surfaces text sits on. */
export const SURFACES = ['--bg', '--panel', '--panel-2'] as const

/** Each text token and its floor; null for a token the table only reports. */
export const FLOORS: ReadonlyArray<readonly [token: string, floor: number | null]> = [
  ['--text', 4.5],
  ['--text-bright', 4.5],
  ['--text-muted', 3],
  ['--text-dim', null],
]

export interface ContrastRow {
  readonly theme: Theme
  readonly token: string
  /** The ratio on each of SURFACES, in order. */
  readonly ratios: readonly number[]
  readonly floor: number | null
  /** True when every ratio meets the floor, or there is no floor. */
  readonly ok: boolean
}

/** A row per theme and text token. Throws when a theme lacks a token it needs. */
export function measure(css: string): ContrastRow[] {
  const rules = parseTokenRules(css)
  return THEMES.flatMap((theme) => {
    const tokens = themeTokens(rules, theme)
    const color = (name: string) => {
      const value = tokens[name]
      if (value === undefined) throw new Error(`theme ${theme} has no ${name}`)
      return value
    }
    return FLOORS.map(([token, floor]) => {
      const ratios = SURFACES.map((surface) => contrastRatio(color(token), color(surface)))
      return { theme, token, ratios, floor, ok: floor === null || Math.min(...ratios) >= floor }
    })
  })
}

/** A ratio to two places, rounded down, so a ratio shown at its floor meets it. */
function ratioText(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2)
}

/** The rows as a table. */
export function table(rows: readonly ContrastRow[]): string[] {
  const all = [
    ['Theme', 'Token', ...SURFACES, 'Floor', ''],
    ...rows.map((row) => [
      row.theme,
      row.token,
      ...row.ratios.map(ratioText),
      row.floor === null ? '-' : row.floor.toFixed(1),
      row.floor === null ? '' : row.ok ? 'ok' : 'FAIL',
    ]),
  ]
  const widths = all[0]?.map((_, i) => Math.max(...all.map((row) => (row[i] ?? '').length))) ?? []
  const numeric = (i: number) => i >= 2 && i < 2 + SURFACES.length + 1
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
    const [worst, surface] = row.ratios.reduce<[number, string]>(
      (low, r, i) => (r < low[0] ? [r, SURFACES[i] ?? ''] : low),
      [Number.POSITIVE_INFINITY, ''],
    )
    log(
      `contrast: ${row.theme} ${row.token} is ${ratioText(worst)}:1 on ${surface}, ` +
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
