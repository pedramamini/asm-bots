/**
 * The editor route's query, as the router reads it. Like the arena's (`../arena/setup/search.ts`),
 * this module imports nothing heavy: the route's `validateSearch` rides the app's entry chunk.
 */
import { type ArenaSearch, validateArenaSearch } from '../arena/setup/search'

/**
 * `/editor`'s query: the arena's (`open in debugger` hands over its setup, and the editor opens
 * its first bot), and `t`, a template to start a new bot from, which the page drops once used.
 */
export interface EditorSearch extends ArenaSearch {
  readonly t?: string | undefined
}

/** The route's `validateSearch`: the arena's fields, and `t` when it names a template's form. */
export function validateEditorSearch(raw: Record<string, unknown>): EditorSearch {
  const search: { -readonly [K in keyof EditorSearch]: EditorSearch[K] } = {
    ...validateArenaSearch(raw),
  }
  if (typeof raw.t === 'string' && /^[a-z]{1,32}$/.test(raw.t)) search.t = raw.t
  return search
}
