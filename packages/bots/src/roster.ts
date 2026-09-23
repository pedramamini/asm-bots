import { type Assembled, assemble } from '@asmbots/asm'
import halt from '../roster/test/halt.asm' with { type: 'text' }
import spin from '../roster/test/spin.asm' with { type: 'text' }

/**
 * The families of roster/README.md: the six classic Core War families, the painters that make the
 * arena worth watching, and the test bots that each pin down one engine behavior.
 */
export const ROSTER_FAMILIES = [
  'imp',
  'dwarf',
  'stone',
  'paper',
  'scanner',
  'vampire',
  'painter',
  'test',
] as const
export type RosterFamily = (typeof ROSTER_FAMILIES)[number]

/** `showcase` bots headline the arena and the goldens, `solid` ones fill out the roster. */
export const ROSTER_TIERS = ['showcase', 'solid', 'test'] as const
export type RosterTier = (typeof ROSTER_TIERS)[number]

export interface RosterEntry {
  /** Kebab-case and unique: the key of `loadRoster` and the file name. */
  slug: string
  /** The path in the package: `roster/<slug>.asm`, or `roster/test/<slug>.asm` for a test bot. */
  file: string
  /** The `%name` of the file. */
  name: string
  /** The `%author` of the file. */
  author: string
  family: RosterFamily
  tier: RosterTier
  /** One line for roster lists. */
  blurb: string
}

/** A roster bot: the text of its file and what `assemble` made of it. */
export interface RosterBot {
  source: string
  assembled: Assembled
}

/** An entry with the text of its file. A new bot is a file, an import above, and a row here. */
interface Row extends RosterEntry {
  source: string
}

const ROWS: readonly Row[] = [
  {
    slug: 'halt',
    file: 'roster/test/halt.asm',
    name: 'Halt',
    author: 'ASM Bots',
    family: 'test',
    tier: 'test',
    blurb: 'Runs hlt on its first turn: the bot that dies first.',
    source: halt,
  },
  {
    slug: 'spin',
    file: 'roster/test/spin.asm',
    name: 'Spin',
    author: 'ASM Bots',
    family: 'test',
    tier: 'test',
    blurb: 'Jumps to itself forever: the bot that lives to the cycle cap.',
    source: spin,
  },
]

export const ROSTER: readonly RosterEntry[] = ROWS.map(({ source, ...entry }) => entry)

let loaded: ReadonlyMap<string, RosterBot> | undefined

/**
 * Every roster bot by slug, assembled on the first call and shared after it, so do not change
 * what it holds. `assemble` does not throw: a bot with errors is in the map with its diagnostics,
 * and `test/roster.test.ts` keeps the roster free of them.
 */
export function loadRoster(): ReadonlyMap<string, RosterBot> {
  loaded ??= new Map(
    ROWS.map(({ slug, source }) => [slug, { source, assembled: assemble(source) }]),
  )
  return loaded
}

// `bun test` sets NODE_ENV to `test`: tests get the whole roster assembled at import, once.
// Elsewhere nothing is assembled until a caller asks. Browsers and Workers have no `process`.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (env?.NODE_ENV === 'test') loadRoster()
