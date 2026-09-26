import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHECKS, FILLS, main, measure, SURFACES, TOKENS, table } from './check-contrast'

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
  it('passes tokens.css and prints a row per theme and token', async () => {
    const lines: string[] = []
    expect(await main({ log: (line) => lines.push(line) })).toBe(0)
    expect(lines[0]).toBe(
      'Theme        Token           --bg  --panel  --panel-2  --accent-10  --accent-25  --accent-45  Floor',
    )
    expect(lines.slice(1, 71)).toHaveLength(70)
    expect(lines).toContain(
      'sentinel     --text          9.71     8.93       9.38         7.13            -            -    4.5  ok',
    )
    expect(lines).toContain(
      'pedurple     --accent-fg     6.36     5.97       6.16         5.48         4.57            -    4.5  ok',
    )
    expect(lines).toContain(
      'paper        --text-dim      2.30     2.59       2.18            -            -            -      -',
    )
    expect(lines.at(-1)).toBe(
      'contrast: all 63 checks meet their floor in packages/ui/src/tokens.css.',
    )
  })

  it('measures each token on the three surfaces and on its fills, against its floor', () => {
    const rows = measure(CSS)
    expect(rows).toHaveLength(70)
    expect(SURFACES).toEqual(['--bg', '--panel', '--panel-2'])
    expect(FILLS).toEqual([10, 25, 45])
    expect(Object.fromEntries(CHECKS.map((c) => [c.token, [c.floor, c.fills]]))).toEqual({
      '--text': [4.5, [10]],
      '--text-bright': [4.5, [10, 25, 45]],
      '--text-muted': [4.5, [10]],
      '--text-dim': [null, []],
      '--accent-fg': [4.5, [10, 25]],
      '--accent-2': [4.5, [10]],
      '--warn': [4.5, [10]],
      '--danger': [4.5, [10]],
      '--info': [4.5, [10]],
      '--accent': [3, []],
    })
    // White on white is 1:1 and still ok: --text-dim is reported, never gated.
    const dim = measure(CSS.replace('--text-dim: #9AA39A;', '--text-dim: #FFFFFF;'))
    expect(dim.find((r) => r.theme === 'paper' && r.token === '--text-dim')?.ok).toBe(true)
  })

  it('fails a muted token under 4.5:1 and names the theme and the surface', async () => {
    const { code, lines } = await run(
      CSS.replace('--text-muted: #8B7FA7;', '--text-muted: #7A6C9A;'),
    )
    expect(code).toBe(1)
    expect(lines).toContain(
      'pedurple     --text-muted    4.20     3.94       4.07         3.62            -            -    4.5  FAIL',
    )
    expect(lines.at(-1)).toBe(
      'contrast: pedurple --text-muted is 3.62:1 on --accent-10 over --panel, under its floor of 4.5:1.',
    )
  })

  it('fails a token that passes the surfaces but not an accent fill', async () => {
    // Sentinel's old --text-bright: 4.02:1 on the widest win's --accent-45, over --panel.
    const { code, lines } = await run(
      CSS.replace('--text-bright: #E0FFE0;', '--text-bright: #D0F0D0;'),
    )
    expect(code).toBe(1)
    expect(lines.at(-1)).toBe(
      'contrast: sentinel --text-bright is 4.02:1 on --accent-45 over --panel, under its floor of 4.5:1.',
    )
  })

  it('fails the accent as text, and the ring under 3:1', async () => {
    // Pedurple's brand #9146FF reads at 4.02:1 on its --panel: a ring, not text.
    const text = await run(CSS.replace('--accent-fg: #AD74FF;', '--accent-fg: #9146FF;'))
    expect(text.code).toBe(1)
    expect(text.lines.at(-1)).toBe(
      'contrast: pedurple --accent-fg is 3.08:1 on --accent-25 over --panel, under its floor of 4.5:1.',
    )
    const ring = await run(CSS.replace('--accent: #0A7A4A;', '--accent: #9AA39A;'))
    expect(ring.code).toBe(1)
    expect(ring.lines).toContain(
      'contrast: paper --accent is 2.18:1 on --panel-2, under its floor of 3:1.',
    )
  })

  it('fails body text under 4.5:1 on any one surface', async () => {
    // #6E6E6E passes on paper's --bg (4.52) and --panel (5.09), not on its --panel-2.
    const { code, lines } = await run(
      CSS.replace('--text-bright: #000000;', '--text-bright: #6E6E6E;'),
    )
    expect(code).toBe(1)
    expect(lines).toContain(
      'paper        --text-bright   4.52     5.09       4.28         3.76         3.06         2.27    4.5  FAIL',
    )
    expect(lines.at(-1)).toBe(
      'contrast: paper --text-bright is 2.27:1 on --accent-45 over --panel-2, under its floor of 4.5:1.',
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
      {
        theme: 'ice',
        token: '--text',
        ratios: [4.499, 4.5, 21],
        fills: { 10: 4.5001 },
        floor: 4.5,
        worst: { ratio: 4.499, on: '--bg' },
        ok: false,
      },
    ]).slice(1)
    expect(row).toBe(
      'ice    --text  4.49     4.50      21.00         4.50            -            -    4.5  FAIL',
    )
  })
})
