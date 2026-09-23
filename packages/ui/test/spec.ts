import { readFileSync } from 'node:fs'
import { THEMES, type Theme } from '../src/index'

/** DESIGN_SYSTEM.md, the frozen source of every token value. */
const DOC = readFileSync(new URL('../../../docs/DESIGN_SYSTEM.md', import.meta.url), 'utf8')

/** Section `n` of the design system, from its `## n.` heading to the next heading. */
function section(n: number): string {
  const start = DOC.indexOf(`\n## ${n}. `)
  if (start < 0) throw new Error(`DESIGN_SYSTEM.md has no section ${n}`)
  const end = DOC.indexOf('\n## ', start + 1)
  return DOC.slice(start, end < 0 ? undefined : end)
}

/** The first markdown table in `text`: header cells, then body rows, backticks dropped. */
function table(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split('\n').filter((line) => line.startsWith('|'))
  const cells = (line: string) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replaceAll('`', ''))
  const [header = [], , ...rows] = lines.map(cells)
  return { header, rows }
}

/** §2: the tokens of each theme, `--bg` → `#0A0F0A`. */
export const SPEC_TOKENS: Readonly<Record<Theme, Readonly<Record<string, string>>>> = (() => {
  const { header, rows } = table(section(2))
  if (header.slice(1).join() !== THEMES.join()) throw new Error(`§2 columns: ${header.join()}`)
  const out = {} as Record<Theme, Record<string, string>>
  THEMES.forEach((theme, i) => {
    out[theme] = Object.fromEntries(rows.map((row) => [row[0] ?? '', row[i + 1] ?? '']))
  })
  return out
})()

/** §2: the 12 bot hues, in order. */
export const SPEC_HUES: readonly string[] = (() => {
  const text = section(2)
  const block = text.slice(text.indexOf('Bot palette'))
  const fence = block.slice(block.indexOf('```'), block.indexOf('```', block.indexOf('```') + 3))
  return fence.match(/#[0-9A-F]{6}/gi) ?? []
})()

/** A §3 type role. */
export interface TypeRole {
  readonly role: string
  readonly size: number
  readonly lineHeight: number
  readonly weight: number
  /** Letter spacing in em. */
  readonly tracking: number
  readonly upper: boolean
  readonly tabular: boolean
}

/** §3: the type scale. */
export const SPEC_TYPE: readonly TypeRole[] = table(section(3)).rows.map(
  ([role = '', sizes = '', weight = '', tracking = '', kase = '']) => {
    const [size = Number.NaN, lineHeight = Number.NaN] = sizes.split('/').map(Number)
    return {
      role,
      size,
      lineHeight,
      weight: Number(weight),
      tracking: Number.parseFloat(tracking),
      upper: kase.startsWith('UPPER'),
      tabular: kase === 'tabular',
    }
  },
)
