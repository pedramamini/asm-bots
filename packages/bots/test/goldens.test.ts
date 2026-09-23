import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Battle, eventHash, HashSink, pmarsPoints, resultHash } from '@asmbots/engine'
import { playInWorker } from '../../../scripts/golden'
import {
  diffGoldens,
  formatGoldens,
  GOLDEN_MATCHUPS,
  type GoldenMatchup,
  type GoldenResult,
  HILL_RULES,
  parseGoldens,
  playGolden,
  playGoldens,
} from '../src/goldens'
import { fighter, ROSTER } from '../src/roster'

const TEXT = readFileSync(join(import.meta.dir, '..', 'goldens', 'results.json'), 'utf8')
const RESULTS = parseGoldens(JSON.parse(TEXT))

const SHOWCASE = ROSTER.filter((e) => e.tier === 'showcase').map((e) => e.slug)

/** The golden matchup called `name`. */
function matchupOf(name: string): GoldenMatchup {
  const m = GOLDEN_MATCHUPS.find((g) => g.name === name)
  if (m === undefined) throw new Error(`no golden matchup '${name}'`)
  return m
}

/** A round as a line: `imp vs dwarf, seed 3`. */
const roundOf = (r: { matchup: string; seed: number }) => `${r.matchup}, seed ${r.seed}`

let played: GoldenResult[] | undefined

/** `playGoldens()`, played once for the tests that need it. */
const playedGoldens = () => {
  played ??= playGoldens()
  return played
}

describe('GOLDEN_MATCHUPS', () => {
  const pairs = GOLDEN_MATCHUPS.filter((m) => m.bots.length === 2)
  const melees = GOLDEN_MATCHUPS.filter((m) => m.bots.length > 2)

  it('pairs every two showcase bots once, at seeds 1..5, and no other bots', () => {
    const want = SHOWCASE.flatMap((a, i) => SHOWCASE.slice(i + 1).map((b) => `${a} ${b}`))
    const got = pairs.map((m) =>
      [...m.bots].sort((a, b) => SHOWCASE.indexOf(a) - SHOWCASE.indexOf(b)),
    )
    expect(got.map((bots) => bots.join(' ')).sort()).toEqual(want.sort())
    for (const m of pairs) expect(m.seeds).toEqual([1, 2, 3, 4, 5])
  })

  it('has three 4-bot melees and one 8-bot melee, at seeds 1..3', () => {
    expect(melees.map((m) => m.bots.length)).toEqual([4, 4, 4, 8])
    for (const m of melees) expect(m.seeds).toEqual([1, 2, 3])
  })

  it('names each matchup by its bots, and holds roster bots, none twice', () => {
    const slugs = new Set(ROSTER.map((e) => e.slug))
    for (const m of GOLDEN_MATCHUPS) {
      expect(m.name).toBe(m.bots.join(' vs '))
      expect(new Set(m.bots).size).toBe(m.bots.length)
      for (const slug of m.bots) expect(slugs).toContain(slug)
    }
    expect(new Set(GOLDEN_MATCHUPS.map((m) => m.name)).size).toBe(GOLDEN_MATCHUPS.length)
  })

  it('plays every bot but the test bots', () => {
    const played = new Set(GOLDEN_MATCHUPS.flatMap((m) => m.bots))
    const fighters = ROSTER.filter((e) => e.tier !== 'test').map((e) => e.slug)
    expect([...played].sort()).toEqual([...fighters].sort())
  })

  it('plays under hill rules: 80,000 cycles, everything else at its default', () => {
    expect(HILL_RULES).toEqual({ maxCycles: 80_000 })
  })
})

describe('playGolden', () => {
  // Test bots: halt dies in cycle 0 and div-zero in cycle 1, while spin and count live on.
  const tests: GoldenMatchup = {
    name: 'halt vs spin vs div-zero vs count',
    bots: ['halt', 'spin', 'div-zero', 'count'],
    seeds: [1, 2, 3],
  }

  it('plays round i with the bots rotated left by i, under hill rules', () => {
    const sink = new HashSink()
    const order = ['div-zero', 'count', 'halt', 'spin']
    const battle = new Battle(
      order.map((slug) => fighter(slug)),
      { maxCycles: 80_000, seed: 3 },
      sink,
    )
    battle.run()
    const r = playGolden(tests, 3)
    expect([r.resultHash, r.eventHash]).toEqual([resultHash(battle.result()), eventHash(sink)])
  })

  it('reports the survivors and the points in the matchup order, and the last death', () => {
    expect(playGolden(tests, 3)).toMatchObject({
      matchup: tests.name,
      seed: 3,
      survivors: ['spin', 'count'],
      points: { halt: 0, spin: 7, 'div-zero': 0, count: 7 },
      lastDeathCycle: 1,
    })
    expect(Object.keys(playGolden(tests, 2).points)).toEqual([...tests.bots])
  })

  it('has no last death when every bot lives to the cycle cap', () => {
    const both: GoldenMatchup = { name: 'spin vs count', bots: ['spin', 'count'], seeds: [1] }
    expect(playGolden(both, 1)).toMatchObject({
      survivors: ['spin', 'count'],
      points: { spin: 1, count: 1 },
      lastDeathCycle: null,
    })
  })

  it('throws for a seed the matchup has no round at', () => {
    expect(() => playGolden(matchupOf('imp vs dwarf'), 6)).toThrow(
      'golden: imp vs dwarf has no round at seed 6',
    )
  })
})

describe('goldens/results.json', () => {
  let inWorker: Promise<GoldenResult[]> = Promise.resolve([])
  // The Worker plays while the main thread runs the tests before the last one.
  beforeAll(() => {
    inWorker = playInWorker(GOLDEN_MATCHUPS)
  })

  it('holds one result for each round of GOLDEN_MATCHUPS, in order', () => {
    const rounds = GOLDEN_MATCHUPS.flatMap((m) =>
      m.seeds.map((seed) => ({ matchup: m.name, seed })),
    )
    expect(RESULTS.map(roundOf)).toEqual(rounds.map(roundOf))
  })

  it('is laid out as formatGoldens writes it', () => {
    expect(formatGoldens(RESULTS)).toBe(TEXT)
  })

  it('scores the survivors as ISA §5.5 does, and has a last death just when a bot died', () => {
    const wrong = RESULTS.filter((r) => {
      const bots = matchupOf(r.matchup).bots
      const points = pmarsPoints(bots.length, r.survivors.length)
      const want = bots.map((slug) => [slug, r.survivors.includes(slug) ? points : 0])
      return (
        JSON.stringify(r.points) !== JSON.stringify(Object.fromEntries(want)) ||
        r.survivors.some((slug) => !bots.includes(slug)) ||
        (r.lastDeathCycle === null) !== (r.survivors.length === bots.length) ||
        (r.lastDeathCycle ?? 0) >= 80_000
      )
    })
    expect(wrong.map(roundOf)).toEqual([])
  })

  it('is what the goldens play (for the diff, run bun run golden; to accept it, --update)', () => {
    const changes = diffGoldens(RESULTS, playedGoldens())
    expect(
      changes.map((c) => `${c.kind}: ${roundOf(c.kind === 'removed' ? c.want : c.got)}`),
    ).toEqual([])
  })

  it('is what a Worker plays too (ISA §5.6)', async () => {
    expect(await inWorker).toEqual(playedGoldens())
  })
})

describe('diffGoldens', () => {
  const [a, b, c] = RESULTS as [GoldenResult, GoldenResult, GoldenResult]

  it('finds no change in the same results, with the points in any order', () => {
    const turned = { ...a, points: Object.fromEntries(Object.entries(a.points).reverse()) }
    expect(Object.keys(turned.points)).not.toEqual(Object.keys(a.points))
    expect(diffGoldens([a, b, c], [a, b, c])).toEqual([])
    expect(diffGoldens([a], [turned])).toEqual([])
  })

  it('finds a changed round when any one field differs', () => {
    const [slug = ''] = Object.keys(a.points)
    const edits: Partial<GoldenResult>[] = [
      { survivors: [...a.survivors, 'x'] },
      { survivors: a.survivors.length > 0 ? ['x', ...a.survivors.slice(1)] : ['x'] },
      { points: { ...a.points, [slug]: 99 } },
      { points: { ...a.points, x: 0 } },
      { lastDeathCycle: (a.lastDeathCycle ?? 0) + 1 },
      { lastDeathCycle: a.lastDeathCycle === null ? 0 : null },
      { resultHash: '0123456789abcdef' },
      { eventHash: '0123456789abcdef' },
    ]
    for (const edit of edits) {
      const got = { ...a, ...edit }
      expect(diffGoldens([a], [got])).toEqual([{ kind: 'changed', want: a, got }])
    }
  })

  it('finds new rounds in the order played, then removed rounds in the order wanted', () => {
    const changed = { ...b, eventHash: '0123456789abcdef' }
    expect(diffGoldens([a, b, c], [c, changed, { ...a, seed: 9 }])).toEqual([
      { kind: 'changed', want: b, got: changed },
      { kind: 'new', got: { ...a, seed: 9 } },
      { kind: 'removed', want: a },
    ])
  })
})

describe('parseGoldens', () => {
  const [a] = RESULTS as [GoldenResult]

  it('gives back a list of golden results', () => {
    expect(parseGoldens(JSON.parse(JSON.stringify(RESULTS)))).toEqual(RESULTS)
  })

  it('names the first entry that is not a golden result', () => {
    expect(() => parseGoldens({})).toThrow('golden results: not a JSON list')
    expect(() => parseGoldens([a, null])).toThrow('golden results: entry 1 is not an object')
    const bad: Record<string, unknown[]> = {
      matchup: [undefined, 7],
      seed: [-1, 1.5, '1'],
      survivors: ['imp', [1]],
      points: [[1], null, { imp: -1 }, { imp: '3' }],
      lastDeathCycle: [undefined, -1, '5'],
      resultHash: ['abc', 'ECA2CEB936857C0B', 7],
      eventHash: [undefined, '0123456789abcdef0'],
    }
    for (const [field, values] of Object.entries(bad)) {
      for (const value of values) {
        const entry: Record<string, unknown> = { ...a, [field]: value }
        if (value === undefined) delete entry[field]
        expect(() => parseGoldens([entry])).toThrow(`golden results: entry 0 has no valid ${field}`)
      }
    }
    expect(() => parseGoldens([{ ...a, extra: 1 }])).toThrow(
      'golden results: entry 0 has an unknown field, extra',
    )
    expect(() => parseGoldens([a, { ...a }])).toThrow(
      `golden results: entry 1 repeats ${a.matchup}, seed ${a.seed}`,
    )
  })
})

describe('formatGoldens', () => {
  /** A result whose survivors take `width` characters on their line, comma and all. */
  const withSurvivors = (width: number): GoldenResult => ({
    ...(RESULTS[0] as GoldenResult),
    survivors: ['x'.repeat(width - '    "survivors": [""],'.length)],
  })

  it('keeps a list on one line up to 100 columns, as Biome does, and breaks it after', () => {
    const lineOf = (text: string) => text.split('\n').find((l) => l.includes('"survivors"'))
    expect(lineOf(formatGoldens([withSurvivors(100)]))).toHaveLength(100)
    expect(lineOf(formatGoldens([withSurvivors(101)]))).toBe('    "survivors": [')
  })

  it('writes one field a line, and breaks the points of a melee that do not fit', () => {
    const eight = RESULTS.filter((r) => r.matchup.split(' vs ').length === 8)
    expect(eight).toHaveLength(3)
    for (const r of eight) {
      const text = formatGoldens([r])
      expect(text).toContain('    "points": {\n      "imp": ')
      expect(JSON.parse(text)).toEqual([r])
    }
    expect(formatGoldens([])).toBe('[]\n')
  })
})
