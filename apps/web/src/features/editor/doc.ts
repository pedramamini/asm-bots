/**
 * The documents the editor opens: a new bot (the scratch pad of `/editor`), a bot of this browser
 * (`/editor/<id>`), or a roster bot, read-only (`/editor/roster-<slug>`). A document's key is
 * `scratch`, or the arena's ref of the bot (`local:<id>`, `roster:<slug>`).
 */
import { type BotRef, formatRef, parseRef } from '../arena/setup/url'

export type DocTarget = { readonly kind: 'scratch' } | BotRef

export const SCRATCH: DocTarget = Object.freeze({ kind: 'scratch' })

/** How a roster bot's `$botId` starts: `/editor/roster-dwarf`. */
export const ROSTER_PARAM = 'roster-'

/** The document's key: drafts and the recent list keep documents by it. */
export function docKey(target: DocTarget): string {
  return target.kind === 'scratch' ? 'scratch' : formatRef(target)
}

/** The document of a key, or null for one that is not a key. */
export function parseDocKey(key: string): DocTarget | null {
  return key === 'scratch' ? SCRATCH : parseRef(key)
}

/** The document of `/editor/$botId`. */
export function targetOfParam(botId: string): DocTarget {
  return botId.startsWith(ROSTER_PARAM)
    ? { kind: 'roster', slug: botId.slice(ROSTER_PARAM.length) }
    : { kind: 'local', id: botId }
}

/** The `$botId` of a bot's document. */
export function paramOf(target: BotRef): string {
  return target.kind === 'roster' ? `${ROSTER_PARAM}${target.slug}` : target.id
}

/** The path of a document: `/editor`, `/editor/<id>`, `/editor/roster-<slug>`. */
export function pathOf(target: DocTarget): string {
  return target.kind === 'scratch' ? '/editor' : `/editor/${paramOf(target)}`
}
