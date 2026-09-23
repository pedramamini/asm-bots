import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, measure, SURFACES, TOKENS, table } from './check-contrast'

const DIR = mkdtempSync(join(tmpdir(), 'asmbots-contrast-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

const CSS = readFileSync(TOKENS, 'utf8')

/** Runs the check on `css` and returns its exit code and report. */
async function run(css: string) {
  const file = join(DIR, `tokens-${Math.random().toString(36).slice(2)}.css`)
  writeFileSync(file, css)
  const lines: string[] = []
  const code = await main({ file, log: (line) => lines.push(line) })
  return { code, lines }
}

describe('check-contrast', () => {
  it('passes tokens.css and prints a row per theme and text token', async () => {
    const lines: string[] = []
    expect(await main({ log: (line) => lines.push(line) })).toBe(0)
    expect(lines[0]).toBe('Theme     Token           --bg  --panel  --panel-2  Floor')
    expect(lines.slice(1, 21)).toHaveLength(20)
    expect(lines).toContain('sentinel  --text          9.71     8.93       9.38    4.5  ok')
    expect(lines).toContain('pedurple  --text-muted    4.20     3.94       4.07    3.0  ok')
    expect(lines).toContain('paper     --text-dim      2.30     2.59       2.18      -')
    expect(lines.at(-1)).toBe(
      'contrast: all 15 checks meet their floor in packages/ui/src/tokens.css.',
    )
  })

  it('measures each text token on the three surfaces against its floor', () => {
    const rows = measure(CSS)
    expect(rows).toHaveLength(20)
    expect(SURFACES).toEqual(['--bg', '--panel', '--panel-2'])
    const floors = Object.fromEntries(rows.map((row) => [row.token, row.floor]))
    expect(floors).toEqual({
      '--text': 4.5,
      '--text-bright': 4.5,
      '--text-muted': 3,
      '--text-dim': null,
    })
    // White on white is 1:1 and still ok: --text-dim is reported, never gated.
    const dim = measure(CSS.replace('--text-dim: #9AA39A;', '--text-dim: #FFFFFF;'))
    expect(dim.find((r) => r.theme === 'paper' && r.token === '--text-dim')?.ok).toBe(true)
  })

  it('fails a muted token under 3:1 and names the theme and the surface', async () => {
    const { code, lines } = await run(
      CSS.replace('--text-muted: #7A6C9A;', '--text-muted: #4E4466;'),
    )
    expect(code).toBe(1)
    expect(lines).toContain('pedurple  --text-muted    2.21     2.08       2.15    3.0  FAIL')
    expect(lines.at(-1)).toBe(
      'contrast: pedurple --text-muted is 2.08:1 on --panel, under its floor of 3:1.',
    )
  })

  it('fails body text under 4.5:1 on any one surface', async () => {
    // #6E6E6E passes on paper's --bg (4.52) and --panel (5.09), not on its --panel-2.
    const { code, lines } = await run(
      CSS.replace('--text-bright: #000000;', '--text-bright: #6E6E6E;'),
    )
    expect(code).toBe(1)
    expect(lines).toContain('paper     --text-bright   4.52     5.09       4.28    4.5  FAIL')
    expect(lines.at(-1)).toBe(
      'contrast: paper --text-bright is 4.28:1 on --panel-2, under its floor of 4.5:1.',
    )
  })

  it('fails when no rule gives a theme a token', async () => {
    // A theme block without a token still gets sentinel's from :root, as in the browser.
    expect((await run(CSS.replace('--panel-2: #081018;\n', ''))).code).toBe(0)
    const { code, lines } = await run(CSS.replaceAll(/ {2}--panel-2: #\w+;\n/g, ''))
    expect(code).toBe(1)
    expect(lines).toEqual([
      expect.stringMatching(/^contrast: cannot check .*: theme sentinel has no --panel-2$/),
    ])
  })

  it('rounds ratios down so a ratio shown at the floor meets it', () => {
    const [row] = table([
      { theme: 'ice', token: '--text', ratios: [4.499, 4.5, 21], floor: 4.5, ok: false },
    ]).slice(1)
    expect(row).toBe('ice    --text  4.49     4.50      21.00    4.5  FAIL')
  })
})
