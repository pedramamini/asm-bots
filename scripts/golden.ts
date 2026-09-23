/**
 * `bun run golden` plays every golden matchup of packages/bots (`src/goldens.ts`) on the main
 * thread and in a Worker, and fails when the two differ (ISA §5.6). Then it checks the results
 * against packages/bots/goldens/results.json and exits 1 with a readable diff when they differ.
 * `bun run golden --update` writes the results to the file instead, and prints a table of what
 * changed. A golden moves only when a bot, the assembler, or the engine changes what a battle
 * does, so review that table and the diff of the file as you would a code change.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diffGoldens,
  formatGoldens,
  GOLDEN_MATCHUPS,
  type GoldenChange,
  type GoldenMatchup,
  type GoldenResult,
  parseGoldens,
  playGoldens,
} from '../packages/bots/src/index'

/** The results file of the goldens. */
export const RESULTS = fileURLToPath(
  new URL('../packages/bots/goldens/results.json', import.meta.url),
)

const USAGE = `usage: bun run golden [--update]
  Plays the golden matchups and checks them against packages/bots/goldens/results.json.
  --update  write the results to the file instead, and print what changed`

/** Plays `matchups` in a new Worker and returns its results. */
export async function playInWorker(matchups: readonly GoldenMatchup[]): Promise<GoldenResult[]> {
  const worker = new Worker(new URL('../packages/bots/src/goldens.worker.ts', import.meta.url))
  try {
    return await new Promise<GoldenResult[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<GoldenResult[]>) => resolve(e.data)
      worker.onerror = (e) => reject(new Error(`golden worker: ${e.message}`))
      worker.postMessage(matchups)
    })
  } finally {
    worker.terminate()
  }
}

export interface GoldenOptions {
  /** Write the results to `file`, rather than check them against it. */
  readonly update: boolean
  /** The results file. */
  readonly file: string
  readonly matchups: readonly GoldenMatchup[]
  /** Where the report goes, a line at a time. */
  readonly log: (line: string) => void
  /** Plays the matchups a second time, for the determinism check. `playInWorker` by default. */
  readonly playElsewhere?: (matchups: readonly GoldenMatchup[]) => Promise<GoldenResult[]>
}

/** Plays the goldens, then checks `file` against them or writes them to it. Returns the exit code. */
export async function golden(options: GoldenOptions): Promise<number> {
  const { update, file, matchups, playElsewhere = playInWorker } = options
  const log = (...lines: string[]) => {
    for (const line of lines) options.log(line)
  }
  const started = performance.now()
  // The Worker plays while this thread does.
  const elsewhere = playElsewhere(matchups)
  const got = playGoldens(matchups)
  const split = diffGoldens(got, await elsewhere)
  if (split.length > 0) {
    log(
      `golden: the Worker played ${split.length} of ${got.length} rounds differently. ` +
        'The engine is not deterministic (ISA §5.6). Each line reads main thread → Worker.',
    )
    for (const change of split) log(...describe(change))
    return 1
  }

  const shown = relative(process.cwd(), file)
  let text = ''
  let want: GoldenResult[] = []
  let problem = ''
  try {
    text = await readFile(file, 'utf8')
    want = parseGoldens(JSON.parse(text))
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e)
  }
  const changes = diffGoldens(want, got)
  const took = `${((performance.now() - started) / 1000).toFixed(1)} s`

  if (update) {
    if (problem !== '') log(`golden: cannot read ${shown} (${problem}), so every result is new.`)
    const next = formatGoldens(got)
    if (next !== text) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, next)
    }
    const verb = next === text ? 'is up to date' : 'written'
    log(`golden: ${shown} ${verb}: ${many(got.length, 'result')}, ${tally(changes)} (${took}).`)
    if (changes.length > 0) log('', ...table(changes))
    return 0
  }
  if (problem !== '') {
    log(`golden: cannot read ${shown}: ${problem}`)
    log('Run `bun run golden --update` to write it, and review it before you commit it.')
    return 1
  }
  if (changes.length === 0) {
    log(
      `golden: all ${many(got.length, 'result')} match ${shown}, and the Worker agrees (${took}).`,
    )
    return 0
  }
  log(`golden: ${shown} differs in ${many(changes.length, 'round')}: ${tally(changes)}.`)
  for (const change of changes) log('', ...describe(change))
  log(
    '',
    'If the change is meant, run `bun run golden --update` and review the diff of the file ' +
      'before you commit it.',
  )
  return 1
}

/** How many changes of each kind: `2 changed, 1 new, 0 removed`, or `no change`. */
function tally(changes: readonly GoldenChange[]): string {
  if (changes.length === 0) return 'no change'
  const count = (kind: GoldenChange['kind']) => changes.filter((c) => c.kind === kind).length
  return `${count('changed')} changed, ${count('new')} new, ${count('removed')} removed`
}

const many = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
const roundOf = (r: GoldenResult) => `${r.matchup}, seed ${r.seed}`
const slugsText = (slugs: readonly string[]) => (slugs.length > 0 ? slugs.join(', ') : 'none')
const cycleText = (cycle: number | null) => (cycle === null ? 'none' : String(cycle))
const moved = (from: string, to: string) => (from === to ? to : `${from} → ${to}`)

/** The points that differ, bot by bot: `imp 0 → 1, dwarf 3 → 1`. */
function pointsMoved(from: GoldenResult['points'], to: GoldenResult['points']): string {
  const slugs = [...new Set([...Object.keys(from), ...Object.keys(to)])]
  return slugs
    .filter((slug) => from[slug] !== to[slug])
    .map((slug) => `${slug} ${from[slug] ?? '-'} → ${to[slug] ?? '-'}`)
    .join(', ')
}

/**
 * A change as lines of the readable diff: a new or removed round on one line, and a changed round
 * with a line for each field that moved, from → to.
 */
function describe(change: GoldenChange): string[] {
  if (change.kind !== 'changed') {
    const r = change.kind === 'new' ? change.got : change.want
    const end = `survivors ${slugsText(r.survivors)}, last death ${cycleText(r.lastDeathCycle)}`
    return [`${roundOf(r)}: ${change.kind} (${end})`]
  }
  const { want, got } = change
  const fields: [string, string, string][] = [
    ['survivors', slugsText(want.survivors), slugsText(got.survivors)],
    ['points', '', pointsMoved(want.points, got.points)],
    ['lastDeathCycle', cycleText(want.lastDeathCycle), cycleText(got.lastDeathCycle)],
    ['resultHash', want.resultHash, got.resultHash],
    ['eventHash', want.eventHash, got.eventHash],
  ]
  return [
    `${roundOf(got)}: changed`,
    ...fields
      .filter(([, from, to]) => from !== to)
      .map(([name, from, to]) => `  ${name.padEnd(16)}${from === '' ? to : `${from} → ${to}`}`),
  ]
}

/** The changes as a table: a row for each round, with its survivors and last death. */
function table(changes: readonly GoldenChange[]): string[] {
  const rows = changes.map((change) => {
    const r = change.kind === 'removed' ? change.want : change.got
    const was = change.kind === 'changed' ? change.want : r
    const hashes = [
      was.resultHash !== r.resultHash ? 'result' : '',
      was.eventHash !== r.eventHash ? 'event' : '',
    ].filter((h) => h !== '')
    return [
      r.matchup,
      String(r.seed),
      change.kind,
      moved(slugsText(was.survivors), slugsText(r.survivors)),
      moved(cycleText(was.lastDeathCycle), cycleText(r.lastDeathCycle)),
      change.kind === 'changed' ? hashes.join(', ') || 'same' : '',
    ]
  })
  const all = [['Matchup', 'Seed', 'Change', 'Survivors', 'Last death', 'Hashes changed'], ...rows]
  const widths = all[0]?.map((_, i) => Math.max(...all.map((row) => (row[i] ?? '').length))) ?? []
  return all.map((row) =>
    row
      .map((cell, i) => (i === 1 ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd(),
  )
}

/**
 * The command line, given its arguments. Returns the exit code: 0, 1 when the goldens and the file
 * differ, or 2 for an unknown argument. A test passes its own file, matchups, and log.
 */
export async function main(
  args: readonly string[],
  options: Partial<Omit<GoldenOptions, 'update'>> = {},
): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  const unknown = args.find((arg) => arg !== '--update')
  if (unknown !== undefined) {
    console.error(`golden: unknown argument ${unknown}\n${USAGE}`)
    return 2
  }
  const update = args.includes('--update')
  return golden({ file: RESULTS, matchups: GOLDEN_MATCHUPS, log: console.log, ...options, update })
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
