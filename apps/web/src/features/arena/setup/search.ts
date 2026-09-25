/**
 * The arena route's query, as the router reads and writes it. This module imports nothing: the
 * route's `validateSearch` lives in the app's entry chunk, and the roster, the assembler, and the
 * share codec belong in the arena's own chunk (`url.ts` reads the query into a setup there).
 */

/** The arena route's query: `?b=roster:dwarf,roster:paper&seed=42&cycles=100000&rounds=3`. */
export interface ArenaSearch {
  /** The bots, as refs joined by commas: `roster:<slug>`, `local:<id>`. */
  readonly b?: string | undefined
  /** A fixed seed; none means a random seed each battle. */
  readonly seed?: number | undefined
  readonly cycles?: number | undefined
  readonly rounds?: number | undefined
  readonly procs?: number | undefined
  readonly spacing?: number | undefined
  /** The guided demo: the header's `intro` link (`?intro=true`). The page drops it once it runs. */
  readonly intro?: true | undefined
}

const COUNTS = ['seed', 'cycles', 'rounds', 'procs', 'spacing'] as const

/**
 * The route's `validateSearch`: the fields of `raw` that have their type. A count is a whole
 * number, given as one or as digits; the page holds each to its limits (`setupFromSearch`).
 * Anything else is left out, so it takes its default.
 */
export function validateArenaSearch(raw: Record<string, unknown>): ArenaSearch {
  const search: { -readonly [K in keyof ArenaSearch]: ArenaSearch[K] } = {}
  if (typeof raw.b === 'string' && raw.b !== '') search.b = raw.b
  // `?intro=true` from the link; `?intro`, `?intro=1` typed by hand.
  if (raw.intro === true || raw.intro === 1 || raw.intro === '' || raw.intro === '1') {
    search.intro = true
  }
  for (const key of COUNTS) {
    const value = raw[key]
    const n = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value
    if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) search[key] = n
  }
  return search
}
