/**
 * King of the Hill (ARCHITECTURE §5, PRODUCT_SPEC §5): a hill holds up to `size` entries. A
 * challenger fights every entry, one match of `rounds` rounds each, and its score is the sum of
 * its match points. Every entry's score is the sum of its points over its matches against the
 * other entries, so the field (hill plus challenger) is ranked on equal terms. When the field is
 * over `size`, the lowest entry is pushed off; the scores then drop its matches.
 *
 * The rank orders by score, then age (older stays), then the old board order, with the
 * challenger after the incumbents. So a challenger stays only when it beats the lowest entry.
 * Each entry that stays through a challenge ages by one.
 *
 * The state holds one match summary per pair of entries, keyed by `matchHash`. Re-scoring reads
 * those summaries and never runs a match again. A challenger with the same bytes as an entry
 * (the same `botHash`) replaces that entry: the old entry and its matches go, and the
 * challenger fights the rest with the old entry's age.
 *
 * The state is plain data (JSON-safe) and the functions on it are pure. `submitToHill` runs one
 * match per step through the caller's runner, so the Durable Object can load bots by id, persist
 * each match, and resume with the matches it has.
 */
import { type BattleConfigInput, fnv1a64, type LoadedBot } from '@asmbots/engine'
import { type MatchResult, runMatch } from './match'

export interface HillConfig {
  /** The most entries on the hill. */
  readonly size: number
  /** Rounds per match. */
  readonly rounds: number
  /** The config of every match. Its seed is the seed base of the hill. */
  readonly battle: BattleConfigInput
}

export interface HillEntry {
  /** The caller's id for the entry (a bot version id). Unique on the hill. */
  readonly id: string
  readonly name: string
  /** `botHash` of the bot's bytes. */
  readonly hash: string
  /** The score: the sum of its match points against the other entries. */
  readonly points: number
  readonly wins: number
  readonly ties: number
  readonly losses: number
  /** The challenges it stayed on the hill through. */
  readonly age: number
  /** Kept for the rating layer; the hill does not change it. null when unrated. */
  readonly rating: number | null
}

/** A stored match of two entries. `entries[0]` was the challenger. */
export interface HillMatch {
  /** The match's `matchHash`. */
  readonly key: string
  readonly entries: readonly [string, string]
  /** Match points, in `entries` order. */
  readonly points: readonly [number, number]
}

export interface HillState {
  readonly config: HillConfig
  /** The board, best first. */
  readonly entries: readonly HillEntry[]
  /** One match per pair of entries. */
  readonly matches: readonly HillMatch[]
}

export interface HillChallenger {
  /** Its id on the hill. */
  readonly id: string
  readonly bot: LoadedBot
  readonly rating?: number | undefined
}

/** A line of the board after a challenge. */
export interface HillBoardRow {
  /** From 1. */
  readonly rank: number
  readonly entry: HillEntry
  /** The old rank minus the new: up is positive. null for a new entry. */
  readonly rankDelta: number | null
  /** The new score minus the old. null for a new entry. */
  readonly pointsDelta: number | null
}

export interface HillResult {
  /** The hill after the challenge. */
  readonly state: HillState
  /** `state.entries` with ranks and deltas. A replacing challenger takes the old entry's. */
  readonly board: readonly HillBoardRow[]
  /** The challenger as ranked in the field, before the lowest entry went. */
  readonly challenger: HillEntry
  readonly accepted: boolean
  /** The challenger's rank on the new board, or null when it did not stay. */
  readonly rank: number | null
  /** The entry pushed off (the challenger when it did not stay), as ranked in the field. */
  readonly evicted: HillEntry | null
  /** The entry with the challenger's bytes that the challenger replaced. */
  readonly replaced: HillEntry | null
  /** The challenger's matches, one per defender in board order: challenger first. */
  readonly matches: readonly MatchResult[]
}

/** What `submitToHill` yields: once after each match, then once with the result. */
export interface HillProgress {
  readonly progress: { readonly match: number; readonly of: number }
  /** The challenger's matches so far. */
  readonly matches: readonly MatchResult[]
  /** The result, on the last yield only. */
  readonly final: HillResult | null
}

/** Runs the match of the challenger and a defender: the challenger is entrant 0. */
export type HillMatchRunner = (
  challenger: HillChallenger,
  defender: HillEntry,
  config: HillConfig,
) => MatchResult | Promise<MatchResult>

export interface SubmitToHillOptions {
  /** When it aborts, the iterator throws the abort reason before it runs the next match. */
  readonly signal?: AbortSignal | undefined
  /** The challenger's first matches, from an earlier run: the iterator skips them. */
  readonly resume?: readonly MatchResult[] | undefined
}

/** The identity of a bot's code: FNV-1a 64 of its bytes. */
export function botHash(bot: LoadedBot): string {
  return fnv1a64(bot.bytes)
}

function checkConfig(config: HillConfig): void {
  for (const k of ['size', 'rounds'] as const) {
    if (!Number.isInteger(config[k]) || config[k] < 1) {
      throw new RangeError(`hill: ${k} must be a positive integer, got ${config[k]}`)
    }
  }
}

/** An empty hill. Throws `RangeError` for a bad size or round count. */
export function createHill(config: HillConfig): HillState {
  checkConfig(config)
  return { config, entries: [], matches: [] }
}

interface Plan {
  readonly hash: string
  /** The entries the challenger fights, in board order. */
  readonly defenders: readonly HillEntry[]
  readonly replaced: HillEntry | null
}

function plan(state: HillState, challenger: HillChallenger): Plan {
  checkConfig(state.config)
  if (state.entries.length > state.config.size) {
    throw new RangeError(`hill: ${state.entries.length} entries on a hill of ${state.config.size}`)
  }
  const hash = botHash(challenger.bot)
  const replaced = state.entries.find((e) => e.hash === hash) ?? null
  const clash = state.entries.find((e) => e.id === challenger.id)
  if (clash !== undefined && clash !== replaced) {
    throw new Error(`hill: entry ${challenger.id} is on the hill with other bytes`)
  }
  return { hash, defenders: state.entries.filter((e) => e !== replaced), replaced }
}

function checkResult(
  result: MatchResult,
  challenger: HillChallenger,
  defender: HillEntry,
  config: HillConfig,
): void {
  const [a, b] = result.names
  if (
    result.names.length !== 2 ||
    a !== challenger.bot.name ||
    b !== defender.name ||
    result.of !== config.rounds ||
    result.rounds.length !== result.of
  ) {
    throw new Error(
      `hill: match ${result.key} is not a whole match of ${challenger.id} and ${defender.id}`,
    )
  }
}

/**
 * `entries` with their scores and W/T/L over `matches` between them, ranked: score, then age,
 * both descending, then the order of `entries`.
 */
function rank(entries: readonly HillEntry[], matches: readonly HillMatch[]): HillEntry[] {
  const rows = new Map(
    entries.map((e) => [e.id, { ...e, points: 0, wins: 0, ties: 0, losses: 0 }] as const),
  )
  const tally = (
    row: { points: number; wins: number; ties: number; losses: number },
    p: number,
    q: number,
  ) => {
    row.points += p
    if (p > q) row.wins++
    else if (p === q) row.ties++
    else row.losses++
  }
  for (const m of matches) {
    const a = rows.get(m.entries[0])
    const b = rows.get(m.entries[1])
    if (a === undefined || b === undefined) continue
    tally(a, m.points[0], m.points[1])
    tally(b, m.points[1], m.points[0])
  }
  return [...rows.values()]
    .map((row, i) => ({ row, i }))
    .sort((x, y) => y.row.points - x.row.points || y.row.age - x.row.age || x.i - y.i)
    .map(({ row }) => row)
}

/** The hill after `challenger` played `results`, one per defender of `p`. */
function settle(
  state: HillState,
  challenger: HillChallenger,
  p: Plan,
  results: readonly MatchResult[],
): HillResult {
  const { config } = state
  const { defenders, replaced } = p
  const ids = new Set(defenders.map((d) => d.id))
  let matches: HillMatch[] = [
    ...state.matches.filter((m) => ids.has(m.entries[0]) && ids.has(m.entries[1])),
    ...results.map((r, i) => ({
      key: r.key,
      entries: [challenger.id, (defenders[i] as HillEntry).id] as const,
      points: [r.points[0] as number, r.points[1] as number] as const,
    })),
  ]
  const field = rank(
    [
      ...defenders,
      {
        id: challenger.id,
        name: challenger.bot.name,
        hash: p.hash,
        points: 0,
        wins: 0,
        ties: 0,
        losses: 0,
        age: replaced?.age ?? 0,
        rating: challenger.rating ?? replaced?.rating ?? null,
      },
    ],
    matches,
  )
  let evicted: HillEntry | null = null
  let members = field
  if (field.length > config.size) {
    const out = field[field.length - 1] as HillEntry
    evicted = out
    members = field.slice(0, -1)
    matches = matches.filter((m) => m.entries[0] !== out.id && m.entries[1] !== out.id)
  }
  const entries = rank(
    members.map((e) => (e.id === challenger.id ? e : { ...e, age: e.age + 1 })),
    matches,
  )
  const before = new Map(state.entries.map((e, i) => [e.id, { entry: e, rank: i + 1 }] as const))
  const board = entries.map((entry, i) => {
    const old =
      entry.id === challenger.id && replaced !== null
        ? before.get(replaced.id)
        : before.get(entry.id)
    return {
      rank: i + 1,
      entry,
      rankDelta: old === undefined ? null : old.rank - (i + 1),
      pointsDelta: old === undefined ? null : entry.points - old.entry.points,
    }
  })
  const at = entries.findIndex((e) => e.id === challenger.id)
  return {
    state: { config, entries, matches },
    board,
    challenger: field.find((e) => e.id === challenger.id) as HillEntry,
    accepted: at >= 0,
    rank: at >= 0 ? at + 1 : null,
    evicted,
    replaced,
    matches: results,
  }
}

/**
 * Submits `challenger` to the hill: runs its matches with `lookup` (the bot of an entry) and
 * `runMatch`, then ranks the field. Throws `RangeError` for a bad hill, an `Error` when the
 * challenger's id is on the hill with other bytes, and what `runMatch` throws.
 */
export function hill(
  state: HillState,
  challenger: HillChallenger,
  lookup: (entry: HillEntry) => LoadedBot,
): HillResult {
  const p = plan(state, challenger)
  const { config } = state
  const results = p.defenders.map((d) => {
    const r = runMatch([challenger.bot, lookup(d)], config.battle, config.rounds)
    checkResult(r, challenger, d, config)
    return r
  })
  return settle(state, challenger, p, results)
}

/**
 * `hill` one match at a time, with the caller's runner: yields `{ progress, matches, final }`
 * after each match, then once more with `final` set, and returns the result. With `resume`, it
 * skips the matches given. With `signal`, an abort stops it before the next match: the iterator
 * throws the abort reason. Throws what `hill` throws, and an `Error` when a match (run or
 * resumed) is not a whole match of the challenger and its defender.
 */
export async function* submitToHill(
  state: HillState,
  challenger: HillChallenger,
  run: HillMatchRunner,
  options: SubmitToHillOptions = {},
): AsyncGenerator<HillProgress, HillResult> {
  const { signal, resume = [] } = options
  const p = plan(state, challenger)
  const { config } = state
  const of = p.defenders.length
  if (resume.length > of) {
    throw new Error(`hill: ${resume.length} matches to resume, ${of} defenders`)
  }
  resume.forEach((r, i) => {
    checkResult(r, challenger, p.defenders[i] as HillEntry, config)
  })
  const matches = [...resume]
  for (let i = matches.length; i < of; i++) {
    signal?.throwIfAborted()
    const d = p.defenders[i] as HillEntry
    const r = await run(challenger, d, config)
    checkResult(r, challenger, d, config)
    matches.push(r)
    yield { progress: { match: matches.length, of }, matches: [...matches], final: null }
  }
  const final = settle(state, challenger, p, matches)
  yield { progress: { match: of, of }, matches: final.matches, final }
  return final
}
