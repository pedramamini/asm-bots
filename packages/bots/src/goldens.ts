/**
 * The goldens (ARCHITECTURE §9): fixed matchups of roster bots under hill rules, and the results
 * that `goldens/results.json` keeps for them. A golden that changes means that a bot, the
 * assembler, or the engine changed what a battle does. `scripts/golden.ts` at the repo root checks
 * the goldens against the file and rewrites it. Nothing here reads a file or the clock, so the
 * goldens play the same in Bun, browsers, and Workers (ISA §5.6).
 */
import {
  Battle,
  type BattleConfigInput,
  type BotResult,
  eventHash,
  HashSink,
  resultHash,
} from '@asmbots/engine'
import { fighter, ROSTER } from './roster'

/** The hill rules: 80,000 cycles (ISA §5.5), everything else at its default. */
export const HILL_RULES: BattleConfigInput = { maxCycles: 80_000 }

/** Roster bots that fight in one core, one round a seed. */
export interface GoldenMatchup {
  /** The slugs joined by ` vs `: the key of its results. */
  readonly name: string
  /** Roster slugs, none twice. */
  readonly bots: readonly string[]
  /** One round each, in order. */
  readonly seeds: readonly number[]
}

const matchup = (bots: readonly string[], seeds: readonly number[]): GoldenMatchup => ({
  name: bots.join(' vs '),
  bots,
  seeds,
})

const PAIR_SEEDS = [1, 2, 3, 4, 5]
const MELEE_SEEDS = [1, 2, 3]

const SHOWCASE = ROSTER.filter((e) => e.tier === 'showcase').map((e) => e.slug)

/**
 * Every pair of showcase bots, in roster order, at seeds 1..5. Then, at seeds 1..3, three 4-bot
 * melees and one 8-bot melee: the solid bots of the imp, dwarf, paper, and scanner families; the
 * gate and the decoy, with the imp the gate kills and the scanner the decoy's noise is for; four
 * showcase fighters; and the eight showcase bots. So each bot has goldens except the test bots,
 * which `test/test-bots.test.ts` pins instead.
 */
export const GOLDEN_MATCHUPS: readonly GoldenMatchup[] = [
  ...SHOWCASE.flatMap((a, i) => SHOWCASE.slice(i + 1).map((b) => matchup([a, b], PAIR_SEEDS))),
  matchup(['imp-ring', 'dwarf-wide', 'silk', 'hybrid'], MELEE_SEEDS),
  matchup(['gate', 'decoy', 'imp', 'scanner'], MELEE_SEEDS),
  matchup(['dwarf', 'stone', 'paper', 'vampire'], MELEE_SEEDS),
  matchup(
    ['imp', 'dwarf', 'stone', 'paper', 'scanner', 'vampire', 'painter-lcg', 'painter-spiral'],
    MELEE_SEEDS,
  ),
]

/** What a round of a golden matchup came to: one entry of `goldens/results.json`. */
export interface GoldenResult {
  /** The name of the matchup. */
  readonly matchup: string
  readonly seed: number
  /** The slugs of the bots alive at the end, in the matchup's order. */
  readonly survivors: readonly string[]
  /** The pMARS points of each bot (ISA §5.5), by slug, in the matchup's order. */
  readonly points: Readonly<Record<string, number>>
  /** The cycle the last bot to die died in, or null when no bot died. */
  readonly lastDeathCycle: number | null
  /** `resultHash` of the battle's result. */
  readonly resultHash: string
  /** `eventHash` of every event of the battle. */
  readonly eventHash: string
}

/**
 * Plays the round of `matchup` at `seed` under hill rules. Round `i` plays `seeds[i]` with the
 * bots rotated left by `i`: the order rotates each round, as in a match (ISA §5.5), so no bot is
 * always placed first.
 */
export function playGolden(matchup: GoldenMatchup, seed: number): GoldenResult {
  const round = matchup.seeds.indexOf(seed)
  if (round < 0) throw new RangeError(`golden: ${matchup.name} has no round at seed ${seed}`)
  const { bots } = matchup
  const order = bots.map((_, i) => bots[(i + round) % bots.length] as string)
  const sink = new HashSink()
  const battle = new Battle(
    order.map((slug) => fighter(slug)),
    { ...HILL_RULES, seed },
    sink,
  )
  battle.run()
  const result = battle.result()
  const of = new Map(order.map((slug, i) => [slug, result.bots[i] as BotResult]))
  const deaths = result.bots.flatMap((b) => (b.deathCycle === null ? [] : [b.deathCycle]))
  return {
    matchup: matchup.name,
    seed,
    survivors: bots.filter((slug) => of.get(slug)?.alive),
    points: Object.fromEntries(bots.map((slug) => [slug, of.get(slug)?.points ?? 0])),
    lastDeathCycle: deaths.length > 0 ? Math.max(...deaths) : null,
    resultHash: resultHash(result),
    eventHash: eventHash(sink),
  }
}

/** Every round of `matchups`, in order. With the default, what `goldens/results.json` holds. */
export function playGoldens(matchups: readonly GoldenMatchup[] = GOLDEN_MATCHUPS): GoldenResult[] {
  return matchups.flatMap((m) => m.seeds.map((seed) => playGolden(m, seed)))
}

/**
 * A round whose result differs between two lists: `changed` when both have it with other values,
 * `new` when only the list played has it, and `removed` when only the list wanted has it.
 */
export type GoldenChange =
  | { readonly kind: 'changed'; readonly want: GoldenResult; readonly got: GoldenResult }
  | { readonly kind: 'new'; readonly got: GoldenResult }
  | { readonly kind: 'removed'; readonly want: GoldenResult }

/** The key of a round: its seed and its matchup. */
const keyOf = (r: GoldenResult): string => `${r.seed} ${r.matchup}`

/** Whether two results of a round agree: the same survivors, points, last death, and hashes. */
function same(a: GoldenResult, b: GoldenResult): boolean {
  const slugs = Object.keys(a.points)
  return (
    a.survivors.length === b.survivors.length &&
    a.survivors.every((slug, i) => slug === b.survivors[i]) &&
    slugs.length === Object.keys(b.points).length &&
    slugs.every((slug) => Object.hasOwn(b.points, slug) && a.points[slug] === b.points[slug]) &&
    a.lastDeathCycle === b.lastDeathCycle &&
    a.resultHash === b.resultHash &&
    a.eventHash === b.eventHash
  )
}

/**
 * How `got` (the results played) differs from `want` (what `goldens/results.json` holds): the
 * changed and new rounds in the order of `got`, then the removed rounds in the order of `want`.
 * Empty when the two agree.
 */
export function diffGoldens(
  want: readonly GoldenResult[],
  got: readonly GoldenResult[],
): GoldenChange[] {
  const wanted = new Map(want.map((r) => [keyOf(r), r]))
  const played = new Set(got.map(keyOf))
  const changes: GoldenChange[] = []
  for (const g of got) {
    const w = wanted.get(keyOf(g))
    if (w === undefined) changes.push({ kind: 'new', got: g })
    else if (!same(w, g)) changes.push({ kind: 'changed', want: w, got: g })
  }
  for (const w of want) if (!played.has(keyOf(w))) changes.push({ kind: 'removed', want: w })
  return changes
}

const HASH = /^[0-9a-f]{16}$/
const isCount = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0

/** Each field of a golden result, and whether a JSON value is one. */
const FIELDS: Readonly<Record<keyof GoldenResult, (v: unknown) => boolean>> = {
  matchup: (v) => typeof v === 'string',
  seed: isCount,
  survivors: (v) => Array.isArray(v) && v.every((slug) => typeof slug === 'string'),
  points: (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isCount),
  lastDeathCycle: (v) => v === null || isCount(v),
  resultHash: (v) => typeof v === 'string' && HASH.test(v),
  eventHash: (v) => typeof v === 'string' && HASH.test(v),
}

/**
 * `json`, the parsed text of `goldens/results.json`, as golden results. Throws a `TypeError` that
 * names the first entry that is not a golden result, or that repeats a round.
 */
export function parseGoldens(json: unknown): GoldenResult[] {
  if (!Array.isArray(json)) throw new TypeError('golden results: not a JSON list')
  const rounds = new Set<string>()
  json.forEach((entry: unknown, i) => {
    const at = `golden results: entry ${i}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError(`${at} is not an object`)
    }
    const fields = entry as Record<string, unknown>
    for (const [name, valid] of Object.entries(FIELDS)) {
      if (!valid(fields[name])) throw new TypeError(`${at} has no valid ${name}`)
    }
    const extra = Object.keys(fields).find((name) => !Object.hasOwn(FIELDS, name))
    if (extra !== undefined) throw new TypeError(`${at} has an unknown field, ${extra}`)
    const r = entry as GoldenResult
    if (rounds.has(keyOf(r))) throw new TypeError(`${at} repeats ${r.matchup}, seed ${r.seed}`)
    rounds.add(keyOf(r))
  })
  return json as GoldenResult[]
}

/** The line width of biome.json. */
const LINE_WIDTH = 100

/**
 * The text of `goldens/results.json` for `results`: JSON as Biome formats it, so the formatter
 * leaves the file as it is. A result has one field a line. A list of survivors or a set of points
 * is on one line when the line fits in 100 columns, and has one item a line when it does not.
 */
export function formatGoldens(results: readonly GoldenResult[]): string {
  const entries = results.map((r) => {
    const fields = Object.entries({
      matchup: r.matchup,
      seed: r.seed,
      survivors: r.survivors,
      points: r.points,
      lastDeathCycle: r.lastDeathCycle,
      resultHash: r.resultHash,
      eventHash: r.eventHash,
    }).map(([name, value], i, all) => field(name, value, i < all.length - 1 ? ',' : ''))
    return `  {\n${fields.join('\n')}\n  }`
  })
  return entries.length === 0 ? '[]\n' : `[\n${entries.join(',\n')}\n]\n`
}

/** The lines of a field of a result, `comma` after it. */
function field(name: string, value: unknown, comma: string): string {
  const head = `    ${JSON.stringify(name)}: `
  if (typeof value !== 'object' || value === null) return head + JSON.stringify(value) + comma
  const list = Array.isArray(value)
  const items = list
    ? value.map((v) => JSON.stringify(v))
    : Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  const [open, close] = list ? ['[', ']'] : ['{', '}']
  const pad = list || items.length === 0 ? '' : ' '
  const flat = `${open}${pad}${items.join(', ')}${pad}${close}`
  if (head.length + flat.length + comma.length <= LINE_WIDTH) return head + flat + comma
  return `${head}${open}\n${items.map((s) => `      ${s}`).join(',\n')}\n    ${close}${comma}`
}
