/**
 * Single elimination (ARCHITECTURE §5, PRODUCT_SPEC §4): 2..32 entrants in a bracket of size 2,
 * 4, 8, 16, or 32. Seed s plays seed `size + 1 - s` in the first round, placed so that the top
 * seeds meet as late as they can (1v16, 8v9, 4v13, 5v12, ...). Seeds above the entrant count
 * are byes, so the byes land on the top seeds.
 *
 * A bracket is plain data (JSON-safe, stored as `tournaments.bracket_json`) and the functions
 * on it are pure: `advance` returns a new bracket. A match with one entrant is a walkover and a
 * match with none is empty; both settle at once, with no match run. A match with two entrants is
 * ready, and it runs its entrants in slot order. Its winner has more match points, then more
 * survival cycles over its rounds, then the better seed.
 *
 * `iterateBracket` plays the ready matches in id order and yields the bracket after each, so a
 * caller can store it and resume from it: the bracket is the whole state.
 */
import { type BattleConfigInput, type LoadedBot, Pcg32 } from '@asmbots/engine'
import { type MatchResult, runMatch } from './match'

export type BracketSize = 2 | 4 | 8 | 16 | 32

/** The most entrants in a bracket. */
export const MAX_BRACKET_ENTRANTS = 32

/**
 * How the entrants get their seeds: `given` in entrant order, `rating` by rating (highest first,
 * ties in entrant order), or `{ random }` shuffled by PCG32 from that uint32 seed.
 */
export type Seeding = 'given' | 'rating' | { readonly random: number }

/** An entrant to seed. `rating` is needed for `rating` seeding only. */
export interface BracketEntrant {
  readonly name: string
  readonly rating?: number | undefined
}

export interface BracketOptions {
  /** The bracket size. Default: the smallest that holds the entrants. */
  readonly size?: BracketSize | undefined
  readonly seeding: Seeding
  /** Adds a match between the semifinal losers. Needs size 4 or more. Default false. */
  readonly thirdPlace?: boolean | undefined
}

/** Where a slot's entrant comes from: a first-round seed, or an earlier match. */
export type SlotSource =
  | { readonly seed: number }
  | { readonly winnerOf: number }
  | { readonly loserOf: number }

export interface BracketSlot {
  readonly source: SlotSource
  /** `pending` until its source decides; then `filled` (an entrant) or `bye` (no one). */
  readonly state: 'pending' | 'filled' | 'bye'
  /** The entrant when `filled`, else null. */
  readonly entrant: number | null
}

/**
 * `pending`: a slot is not decided. `ready`: two entrants, to play. `done`: played.
 * `walkover`: one entrant, who advances. `empty`: no entrants.
 */
export type BracketMatchStatus = 'pending' | 'ready' | 'done' | 'walkover' | 'empty'

export interface BracketMatch {
  /** Its place in `Bracket.matches`. Rounds come in order, top to bottom; third place last. */
  readonly id: number
  /** The round, from 0. The final and the third-place match are in the last round. */
  readonly round: number
  /** Its place in its round, from the top. */
  readonly index: number
  readonly thirdPlace: boolean
  readonly slots: readonly [BracketSlot, BracketSlot]
  readonly status: BracketMatchStatus
  /** The entrant who advances, once `done` or `walkover`. */
  readonly winner: number | null
  /** The entrant who is out, once `done`. */
  readonly loser: number | null
  /** The match played, once `done`: its entrants in slot order. */
  readonly result: MatchResult | null
}

export interface Bracket {
  readonly size: BracketSize
  /** The rounds, final included: log2 of `size`. */
  readonly rounds: number
  readonly seeding: Seeding
  /** The entrants' names, in entrant order. */
  readonly names: readonly string[]
  /** `seeds[e]`: the seed of entrant e, from 1. */
  readonly seeds: readonly number[]
  readonly matches: readonly BracketMatch[]
  /** The id of the final. */
  readonly final: number
  /** The id of the third-place match, or null when there is none. */
  readonly thirdPlace: number | null
}

/** What `iterateBracket` yields after each match. */
export interface BracketProgress {
  /** The bracket after the match. */
  readonly bracket: Bracket
  /** The match just played, as the bracket now holds it. */
  readonly match: BracketMatch
}

/** Runs one ready match: `entrants` are its two entrants, in slot order. */
export type BracketMatchRunner = (
  entrants: readonly [number, number],
  match: BracketMatch,
) => MatchResult | Promise<MatchResult>

export interface IterateBracketOptions {
  /** When it aborts, the iterator throws the abort reason before it runs the next match. */
  readonly signal?: AbortSignal | undefined
}

const SIZES: readonly BracketSize[] = [2, 4, 8, 16, 32]

/**
 * The seed in each first-round position, top to bottom: position 2i plays 2i + 1. Each step
 * doubles the list and puts `2 * length + 1 - s` under seed s, so a pair sums to `size + 1`.
 */
function positions(size: number): number[] {
  let seeds = [1]
  while (seeds.length < size) {
    const sum = 2 * seeds.length + 1
    seeds = seeds.flatMap((s) => [s, sum - s])
  }
  return seeds
}

/** The entrants in seed order: `order[s - 1]` has seed s. */
function seedOrder(entrants: readonly BracketEntrant[], seeding: Seeding): number[] {
  const order = entrants.map((_, e) => e)
  if (seeding === 'given') return order
  if (seeding === 'rating') {
    const ratings = entrants.map((x, e) => {
      if (typeof x.rating !== 'number' || !Number.isFinite(x.rating)) {
        throw new RangeError(`bracket: rating seeding needs a rating for entrant ${e}`)
      }
      return x.rating
    })
    return order.sort((a, b) => (ratings[b] as number) - (ratings[a] as number) || a - b)
  }
  // Fisher-Yates, from the end.
  const prng = new Pcg32(seeding.random)
  for (let i = order.length - 1; i > 0; i--) {
    const j = prng.nextInt(i + 1)
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return order
}

function slot(source: SlotSource, entrant: number | null, state: BracketSlot['state']) {
  return { source, state, entrant }
}

/** The slot `source` gives, with the matches before it settled. */
function resolveSlot(source: SlotSource, order: readonly number[], matches: BracketMatch[]) {
  if ('seed' in source) {
    const e = order[source.seed - 1]
    return e === undefined ? slot(source, null, 'bye') : slot(source, e, 'filled')
  }
  const from = matches['winnerOf' in source ? source.winnerOf : source.loserOf] as BracketMatch
  const e = 'winnerOf' in source ? from.winner : from.loser
  if (from.status === 'pending' || from.status === 'ready') return slot(source, null, 'pending')
  return e === null ? slot(source, null, 'bye') : slot(source, e, 'filled')
}

/**
 * Fills the slots of every match not yet played from the matches before it, and settles
 * walkovers and empty matches. A slot's source always has a lower id, so one pass in id order
 * settles all.
 */
function settle(matches: readonly BracketMatch[], order: readonly number[]): BracketMatch[] {
  const out: BracketMatch[] = []
  for (const m of matches) {
    if (m.status === 'done') {
      out.push(m)
      continue
    }
    const slots = m.slots.map((s) => resolveSlot(s.source, order, out)) as [
      BracketSlot,
      BracketSlot,
    ]
    const [a, b] = slots
    let status: BracketMatchStatus
    let winner: number | null = null
    if (a.state === 'pending' || b.state === 'pending') status = 'pending'
    else if (a.state === 'filled' && b.state === 'filled') status = 'ready'
    else if (a.state === 'bye' && b.state === 'bye') status = 'empty'
    else {
      status = 'walkover'
      winner = a.entrant ?? b.entrant
    }
    out.push({ ...m, slots, status, winner, loser: null, result: null })
  }
  return out
}

/** The entrants in seed order, from `bracket.seeds`. */
function orderOf(bracket: Bracket): number[] {
  const order: number[] = []
  bracket.seeds.forEach((s, e) => {
    order[s - 1] = e
  })
  return order
}

/**
 * A new bracket for `entrants` (2..32), with every walkover and empty match settled. Throws
 * `RangeError` for a bad entrant count, a size that is not a `BracketSize` or is too small, a
 * third-place match in a bracket under size 4, a missing rating for `rating` seeding, or a
 * random seed that is not a uint32.
 */
export function createBracket(
  entrants: readonly BracketEntrant[],
  options: BracketOptions,
): Bracket {
  const n = entrants.length
  if (n < 2 || n > MAX_BRACKET_ENTRANTS) {
    throw new RangeError(`bracket: needs 2..${MAX_BRACKET_ENTRANTS} entrants, got ${n}`)
  }
  const size = options.size ?? (SIZES.find((s) => s >= n) as BracketSize)
  if (!SIZES.includes(size) || size < n) {
    throw new RangeError(
      `bracket: size must be one of ${SIZES.join(', ')} and hold ${n}, got ${size}`,
    )
  }
  const thirdPlace = options.thirdPlace ?? false
  if (thirdPlace && size < 4) {
    throw new RangeError(`bracket: a third-place match needs size 4 or more, got ${size}`)
  }
  const order = seedOrder(entrants, options.seeding)
  const seeds: number[] = []
  order.forEach((e, i) => {
    seeds[e] = i + 1
  })

  const rounds = Math.log2(size)
  const pending = (source: SlotSource) => slot(source, null, 'pending')
  const blank = { status: 'pending', winner: null, loser: null, result: null } as const
  const matches: BracketMatch[] = []
  const place = positions(size)
  for (let i = 0; i < size / 2; i++) {
    const slots = [
      pending({ seed: place[2 * i] as number }),
      pending({ seed: place[2 * i + 1] as number }),
    ] as const
    matches.push({ id: i, round: 0, index: i, thirdPlace: false, slots, ...blank })
  }
  // Round r + 1, match i, takes the winners of round r, matches 2i and 2i + 1.
  let first = 0
  for (let r = 1; r < rounds; r++) {
    const count = size >> (r + 1)
    const prev = first
    first = matches.length
    for (let i = 0; i < count; i++) {
      const slots = [
        pending({ winnerOf: prev + 2 * i }),
        pending({ winnerOf: prev + 2 * i + 1 }),
      ] as const
      matches.push({ id: first + i, round: r, index: i, thirdPlace: false, slots, ...blank })
    }
  }
  const final = matches.length - 1
  if (thirdPlace) {
    const slots = [pending({ loserOf: final - 2 }), pending({ loserOf: final - 1 })] as const
    matches.push({ id: final + 1, round: rounds - 1, index: 1, thirdPlace: true, slots, ...blank })
  }

  return {
    size,
    rounds,
    seeding: options.seeding,
    names: entrants.map((x) => x.name),
    seeds,
    matches: settle(matches, order),
    final,
    thirdPlace: thirdPlace ? final + 1 : null,
  }
}

/** The matches that can be played now, in id order. */
export function nextMatches(bracket: Bracket): BracketMatch[] {
  return bracket.matches.filter((m) => m.status === 'ready')
}

/** The winner of the final, or null while it is not settled. */
export function champion(bracket: Bracket): number | null {
  return bracket.matches[bracket.final]?.winner ?? null
}

/** The survival cycles of match entrant j over the rounds of `result`. */
function survived(result: MatchResult, j: number): number {
  return result.rounds.reduce((sum, r) => sum + (r.survival[j] as number), 0)
}

/**
 * The bracket with match `matchId` played: `result` is a whole match of its two entrants, in
 * slot order. The winner has more points, then more survival cycles, then the better seed.
 * Throws `Error` when the match is not ready or `result` does not fit it.
 */
export function advance(bracket: Bracket, matchId: number, result: MatchResult): Bracket {
  const m = bracket.matches[matchId]
  if (m === undefined) throw new Error(`bracket: no match ${matchId}`)
  if (m.status !== 'ready') throw new Error(`bracket: match ${matchId} is ${m.status}, not ready`)
  const [a, b] = m.slots.map((s) => s.entrant as number) as [number, number]
  const names = [bracket.names[a], bracket.names[b]]
  if (
    result.names.length !== 2 ||
    result.names[0] !== names[0] ||
    result.names[1] !== names[1] ||
    result.points.length !== 2 ||
    result.rounds.length !== result.of
  ) {
    throw new Error(`bracket: result ${result.key} is not a whole match of ${names.join(' v ')}`)
  }
  const [pa, pb] = result.points as [number, number]
  const sa = survived(result, 0)
  const sb = survived(result, 1)
  const aWins =
    pa !== pb
      ? pa > pb
      : sa !== sb
        ? sa > sb
        : (bracket.seeds[a] as number) < (bracket.seeds[b] as number)
  const played: BracketMatch = {
    ...m,
    status: 'done',
    winner: aWins ? a : b,
    loser: aWins ? b : a,
    result,
  }
  const matches = bracket.matches.map((x) => (x.id === matchId ? played : x))
  return { ...bracket, matches: settle(matches, orderOf(bracket)) }
}

/**
 * Plays `bracket` to the end: runs each ready match with `run`, in id order, and yields
 * `{ bracket, match }` after each. Returns the settled bracket. Resume by passing a bracket
 * it yielded. With `signal`, an abort stops it before the next match: the iterator throws the
 * abort reason. Throws what `run` and `advance` throw.
 */
export async function* iterateBracket(
  bracket: Bracket,
  run: BracketMatchRunner,
  options: IterateBracketOptions = {},
): AsyncGenerator<BracketProgress, Bracket> {
  let current = bracket
  for (;;) {
    const next = nextMatches(current)[0]
    if (next === undefined) return current
    options.signal?.throwIfAborted()
    const [a, b] = next.slots.map((s) => s.entrant as number) as [number, number]
    current = advance(current, next.id, await run([a, b], next))
    yield { bracket: current, match: current.matches[next.id] as BracketMatch }
  }
}

/**
 * Runs a whole bracket of `entrants`: each match is `rounds` rounds with `config`. Throws what
 * `createBracket` and `runMatch` throw.
 */
export function bracket(
  entrants: readonly (LoadedBot & BracketEntrant)[],
  config: BattleConfigInput,
  options: BracketOptions & { readonly rounds: number },
): Bracket {
  let current = createBracket(entrants, options)
  for (;;) {
    const next = nextMatches(current)[0]
    if (next === undefined) return current
    const bots = next.slots.map((s) => entrants[s.entrant as number] as LoadedBot)
    current = advance(current, next.id, runMatch(bots, config, options.rounds))
  }
}
