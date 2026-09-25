/**
 * The editor's reading of the arena's catalog. A roster bot there comes prebuilt, with no source
 * and no listing (`setup/bots.ts`); the editor opens, forks, and debugs roster bots, so it reads
 * the roster's sources and assembles them. Its chunks hold the assembler anyway.
 */
import type { Assembled } from '@asmbots/asm'
import { rosterSource } from '@asmbots/bots'
import { assembleCached } from '../arena/setup/assembly'
import type { CatalogBot } from '../arena/setup/bots'

/** A catalog bot's source: a roster bot's read from the roster. */
export function sourceOf(bot: CatalogBot): string {
  if (bot.source !== null) return bot.source
  return bot.ref.kind === 'roster' ? rosterSource(bot.ref.slug) : ''
}

/** A catalog bot's whole assembly: its listing and symbols as well as its image. */
export function assemblyOf(bot: CatalogBot): Assembled {
  return assembleCached(sourceOf(bot))
}
