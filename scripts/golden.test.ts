import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatGoldens,
  type GoldenMatchup,
  type GoldenResult,
  playGoldens,
} from '../packages/bots/src/index'
import { type GoldenOptions, golden, main } from './golden'

const DIR = mkdtempSync(join(tmpdir(), 'asmbots-golden-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

/** A small set of goldens: three rounds, so each run takes little time. */
const MATCHUPS: GoldenMatchup[] = [
  { name: 'imp vs dwarf', bots: ['imp', 'dwarf'], seeds: [1, 2] },
  { name: 'dwarf vs stone', bots: ['dwarf', 'stone'], seeds: [1] },
]
const RESULTS = playGoldens(MATCHUPS)
const [first, second, third] = RESULTS as [GoldenResult, GoldenResult, GoldenResult]

let files = 0

/**
 * Runs `golden` on a results file that holds `text`, or on no file when `text` is undefined.
 * Returns the exit code, the report, and the text of the file after the run.
 */
async function run(text: string | undefined, options: Partial<GoldenOptions> = {}) {
  const file = join(DIR, `results-${++files}.json`)
  if (text !== undefined) writeFileSync(file, text)
  const lines: string[] = []
  const code = await golden({
    update: false,
    file,
    matchups: MATCHUPS,
    log: (line) => lines.push(line),
    ...options,
  })
  const after = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  return { code, lines, after }
}

/** `second` as a file written before a change: other survivors, points, last death, and events. */
const before: GoldenResult = {
  ...second,
  survivors: second.survivors.length === 1 ? [] : ['imp'],
  points: { imp: 7, dwarf: 7 },
  lastDeathCycle: 12,
  eventHash: '0123456789abcdef',
}

describe('golden', () => {
  it('passes when the file holds the results, and the Worker agrees', async () => {
    const { code, lines, after } = await run(formatGoldens(RESULTS))
    expect(code).toBe(0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^golden: all 3 results match .*results-\d+\.json, and the Worker agrees/,
    )
    expect(after).toBe(formatGoldens(RESULTS))
  })

  it('fails with a line for each field that changed, from the file to the play', async () => {
    const text = formatGoldens([first, before, third])
    const { code, lines, after } = await run(text)
    expect(code).toBe(1)
    expect(lines[0]).toMatch(
      /^golden: .*results-\d+\.json differs in 1 round: 1 changed, 0 new, 0 removed\.$/,
    )
    const points = `imp 7 → ${second.points.imp}, dwarf 7 → ${second.points.dwarf}`
    expect(lines.slice(1, 7)).toEqual([
      '',
      'imp vs dwarf, seed 2: changed',
      `  survivors       none → ${second.survivors.join(', ') || 'none'}`,
      `  points          ${points}`,
      `  lastDeathCycle  12 → ${second.lastDeathCycle ?? 'none'}`,
      `  eventHash       0123456789abcdef → ${second.eventHash}`,
    ])
    expect(lines.at(-1)).toContain('run `bun run golden --update` and review the diff')
    expect(after).toBe(text)
  })

  it('lists a new round and a removed round on a line each', async () => {
    const gone = { ...first, seed: 9 }
    const { code, lines } = await run(formatGoldens([first, second, gone]))
    expect(code).toBe(1)
    expect(lines).toContain(
      `dwarf vs stone, seed 1: new (survivors ${third.survivors.join(', ')}, ` +
        `last death ${third.lastDeathCycle ?? 'none'})`,
    )
    expect(lines).toContain(
      `imp vs dwarf, seed 9: removed (survivors ${first.survivors.join(', ')}, ` +
        `last death ${first.lastDeathCycle ?? 'none'})`,
    )
    expect(lines[0]).toEndWith(' differs in 2 rounds: 0 changed, 1 new, 1 removed.')
  })

  it('fails when the file is missing or is not golden results, and says how to write it', async () => {
    for (const [text, problem] of [
      [undefined, 'ENOENT'],
      ['[{', 'JSON'],
      ['[{}]', 'golden results: entry 0 has no valid matchup'],
    ] as const) {
      const { code, lines, after } = await run(text)
      expect(code).toBe(1)
      expect(lines[0]).toStartWith('golden: cannot read ')
      expect(lines[0]).toContain(problem)
      expect(lines[1]).toBe(
        'Run `bun run golden --update` to write it, and review it before you commit it.',
      )
      expect(after).toBe(text)
    }
  })

  it('with update, writes the results as formatGoldens lays them out, with a table', async () => {
    const gone = { ...first, seed: 9 }
    const { code, lines, after } = await run(formatGoldens([first, before, gone]), {
      update: true,
    })
    expect(code).toBe(0)
    expect(after).toBe(formatGoldens(RESULTS))
    expect(lines[0]).toMatch(/ written: 3 results, 1 changed, 1 new, 1 removed \(\d+\.\d s\)\.$/)
    expect(lines[1]).toBe('')
    expect(lines[2]?.split(/ {2,}/)).toEqual([
      'Matchup',
      'Seed',
      'Change',
      'Survivors',
      'Last death',
      'Hashes changed',
    ])
    const cells = (line: string | undefined) => line?.split(/ {2,}/).map((cell) => cell.trim())
    expect(cells(lines[3])).toEqual([
      'imp vs dwarf',
      '2',
      'changed',
      `none → ${second.survivors.join(', ')}`,
      `12 → ${second.lastDeathCycle ?? 'none'}`,
      'event',
    ])
    expect(cells(lines[4])?.slice(0, 3)).toEqual(['dwarf vs stone', '1', 'new'])
    expect(cells(lines[5])?.slice(0, 3)).toEqual(['imp vs dwarf', '9', 'removed'])
    expect(lines).toHaveLength(6)
  })

  it('with update, leaves a file that holds the results as it is', async () => {
    const { code, lines, after } = await run(formatGoldens(RESULTS), { update: true })
    expect(code).toBe(0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/ is up to date: 3 results, no change \(\d+\.\d s\)\.$/)
    expect(after).toBe(formatGoldens(RESULTS))
  })

  it('with update, writes a file that is missing', async () => {
    const { code, lines, after } = await run(undefined, { update: true })
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/^golden: cannot read .*ENOENT.*, so every result is new\.$/)
    expect(lines[1]).toContain(' written: 3 results, 0 changed, 3 new, 0 removed')
    expect(after).toBe(formatGoldens(RESULTS))
  })

  it('fails, and writes nothing, when the Worker plays a round differently', async () => {
    const odd = { ...third, resultHash: '0123456789abcdef' }
    const playElsewhere = async () => [first, second, odd]
    for (const update of [false, true]) {
      const { code, lines, after } = await run(undefined, { update, playElsewhere })
      expect(code).toBe(1)
      expect(lines).toEqual([
        'golden: the Worker played 1 of 3 rounds differently. The engine is not deterministic ' +
          '(ISA §5.6). Each line reads main thread → Worker.',
        'dwarf vs stone, seed 1: changed',
        `  resultHash      ${third.resultHash} → 0123456789abcdef`,
      ])
      expect(after).toBeUndefined()
    }
  })
})

describe('bun run golden', () => {
  const script = join(import.meta.dir, 'golden.ts')
  const cli = (...args: string[]) => Bun.spawnSync([process.execPath, script, ...args])

  it('exits 1 while the file differs, and 0 once --update has written it', async () => {
    const file = join(DIR, 'main.json')
    const text = formatGoldens([first, before, third])
    writeFileSync(file, text)
    const options = { file, matchups: MATCHUPS, log: () => {} }
    expect(await main([], options)).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(await main(['--update'], options)).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(formatGoldens(RESULTS))
    expect(await main([], options)).toBe(0)
  })

  it('prints its usage for --help', () => {
    const { exitCode, stdout } = cli('--help')
    expect(exitCode).toBe(0)
    expect(stdout.toString()).toStartWith('usage: bun run golden [--update]')
  })

  it('exits 2 with its usage on an unknown argument', () => {
    const { exitCode, stderr } = cli('--updat')
    expect(exitCode).toBe(2)
    expect(stderr.toString()).toStartWith('golden: unknown argument --updat\nusage: ')
  })
})
