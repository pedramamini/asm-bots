import { type Assembled, assemble } from '@asmbots/asm'
import decoy from '../roster/decoy.asm' with { type: 'text' }
import dwarf from '../roster/dwarf.asm' with { type: 'text' }
import dwarfWide from '../roster/dwarf-wide.asm' with { type: 'text' }
import gate from '../roster/gate.asm' with { type: 'text' }
import hybrid from '../roster/hybrid.asm' with { type: 'text' }
import imp from '../roster/imp.asm' with { type: 'text' }
import impRing from '../roster/imp-ring.asm' with { type: 'text' }
import paper from '../roster/paper.asm' with { type: 'text' }
import scanner from '../roster/scanner.asm' with { type: 'text' }
import silk from '../roster/silk.asm' with { type: 'text' }
import stone from '../roster/stone.asm' with { type: 'text' }
import halt from '../roster/test/halt.asm' with { type: 'text' }
import spin from '../roster/test/spin.asm' with { type: 'text' }
import vampire from '../roster/vampire.asm' with { type: 'text' }

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
    slug: 'imp',
    file: 'roster/imp.asm',
    name: 'Imp',
    author: 'ASM Bots',
    family: 'imp',
    tier: 'showcase',
    blurb: 'Copies itself one word ahead with movsw and runs into the copy, forever.',
    source: imp,
  },
  {
    slug: 'imp-ring',
    file: 'roster/imp-ring.asm',
    name: 'Imp Ring',
    author: 'ASM Bots',
    family: 'imp',
    tier: 'solid',
    blurb: 'Three imps a third of the core apart: kill one and two still walk.',
    source: impRing,
  },
  {
    slug: 'dwarf',
    file: 'roster/dwarf.asm',
    name: 'Dwarf',
    author: 'ASM Bots',
    family: 'dwarf',
    tier: 'showcase',
    blurb: 'Drops a DAT word every 4 bytes, walking backward, and ends each lap short of itself.',
    source: dwarf,
  },
  {
    slug: 'dwarf-wide',
    file: 'roster/dwarf-wide.asm',
    name: 'Dwarf Wide',
    author: 'ASM Bots',
    family: 'dwarf',
    tier: 'solid',
    blurb: 'An unrolled dwarf with a DAT word every 3 bytes: two bytes in three are zero.',
    source: dwarfWide,
  },
  {
    slug: 'gate',
    file: 'roster/gate.asm',
    name: 'Gate',
    author: 'ASM Bots',
    family: 'dwarf',
    tier: 'solid',
    blurb: 'Kills imps at a word it decrements under its body, and bombs every 9th byte.',
    source: gate,
  },
  {
    slug: 'decoy',
    file: 'roster/decoy.asm',
    name: 'Decoy',
    author: 'ASM Bots',
    family: 'dwarf',
    tier: 'solid',
    blurb: 'Covers 2 KB around itself with mov noise, then bombs as an unrolled dwarf.',
    source: decoy,
  },
  {
    slug: 'stone',
    file: 'roster/stone.asm',
    name: 'Stone',
    author: 'ASM Bots',
    family: 'stone',
    tier: 'showcase',
    blurb: 'Two bombers with strides of 4 and 11 and a decoy imp, as three processes.',
    source: stone,
  },
  {
    slug: 'paper',
    file: 'roster/paper.asm',
    name: 'Paper',
    author: 'ASM Bots',
    family: 'paper',
    tier: 'showcase',
    blurb: 'Copies itself all over the core with rep movsw and starts every copy with spl.',
    source: paper,
  },
  {
    slug: 'silk',
    file: 'roster/silk.asm',
    name: 'Silk',
    author: 'ASM Bots',
    family: 'paper',
    tier: 'solid',
    blurb: 'Starts each copy on a jmp $ pad first, then writes the copy over the pad.',
    source: silk,
  },
  {
    slug: 'scanner',
    file: 'roster/scanner.asm',
    name: 'Scanner',
    author: 'ASM Bots',
    family: 'scanner',
    tier: 'showcase',
    blurb: 'Scans down for non-zero bytes and carpet-bombs 32 bytes around each one it finds.',
    source: scanner,
  },
  {
    slug: 'hybrid',
    file: 'roster/hybrid.asm',
    name: 'Hybrid',
    author: 'ASM Bots',
    family: 'scanner',
    tier: 'solid',
    blurb: 'A scanner that turns to paper when bombs land in a guard 768 bytes over its body.',
    source: hybrid,
  },
  {
    slug: 'vampire',
    file: 'roster/vampire.asm',
    name: 'Vampire',
    author: 'ASM Bots',
    family: 'vampire',
    tier: 'showcase',
    blurb: 'Bites code with jmp fangs and holds each bitten process in a pit until the lap ends.',
    source: vampire,
  },
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
