import { type Assembled, assemble } from '@asmbots/asm'
import type { LoadedBot } from '@asmbots/engine'
import { ROSTER } from './entries'
import { rosterSource } from './sources'

export type { RosterEntry, RosterFamily, RosterTier } from './entries'
export { ROSTER, ROSTER_FAMILIES, ROSTER_TIERS } from './entries'

/** A roster bot: the text of its file and what `assemble` made of it. */
export interface RosterBot {
  source: string
  assembled: Assembled
}

let loaded: ReadonlyMap<string, RosterBot> | undefined

/**
 * Every roster bot by slug, assembled on the first call and shared after it, so do not change
 * what it holds. `assemble` does not throw: a bot with errors is in the map with its diagnostics,
 * and `test/roster.test.ts` keeps the roster free of them.
 */
export function loadRoster(): ReadonlyMap<string, RosterBot> {
  loaded ??= new Map(
    ROSTER.map(({ slug }) => {
      const source = rosterSource(slug)
      return [slug, { source, assembled: assemble(source) }]
    }),
  )
  return loaded
}

/** The roster bot `slug`, ready for a battle. */
export function fighter(slug: string): LoadedBot {
  const bot = loadRoster().get(slug)
  if (bot === undefined) throw new Error(`loadRoster has no bot '${slug}'`)
  const { name, author, strategy, version, bytes } = bot.assembled
  return { name, bytes, meta: { author, strategy, version } }
}

// `bun test` sets NODE_ENV to `test`: tests get the whole roster assembled at import, once.
// Elsewhere nothing is assembled until a caller asks. Browsers and Workers have no `process`.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (env?.NODE_ENV === 'test') loadRoster()
