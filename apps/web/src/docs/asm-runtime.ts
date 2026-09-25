/**
 * What a docs code block (`Asm.tsx`) loads after the page paints: the editor's x16c tokenizer
 * for its colors, and the share codec for its `open in editor` and `open in arena` links. Both
 * pull in chunks a page of prose should not wait for (CodeMirror, and the roster the arena's
 * config names), so the block imports this module lazily.
 */
import type { ArenaSearch } from '../features/arena/setup/search'
import { sharedFragment } from '../features/arena/setup/url'
import { scanLine, TOKEN_COLORS } from '../features/editor/cm/x16c'
import { testedId } from '../features/editor/test-vs'

/** A run of a line in one color: a kit CSS variable, or null for plain text and whitespace. */
export interface Span {
  text: string
  color: string | null
}

/** Each line of `source`, as the editor colors it. */
export function highlight(source: string): Span[][] {
  return source.split('\n').map((line) => {
    const spans: Span[] = []
    let at = 0
    for (const { from, to, type } of scanLine(line)) {
      if (from > at) spans.push({ text: line.slice(at, from), color: null })
      spans.push({ text: line.slice(from, to), color: `var(${TOKEN_COLORS[type]})` })
      at = to
    }
    if (at < line.length) spans.push({ text: line.slice(at), color: null })
    return spans
  })
}

/**
 * The fragment that opens `source` in the editor as a bot not saved yet, the way the editor's own
 * share link does: `/editor#src=…`. The id is the editor's for an unsaved text, from its hash.
 */
export function editorHash(source: string): string {
  return sharedFragment([{ id: testedId(source, null), source }])
}

/**
 * The arena setup of `source` against the roster bots `vs`, first: the query and the fragment that
 * carries the source. The rest of the config is the arena's duel; no seed is a random seed each
 * battle.
 */
export function arenaLink(
  source: string,
  vs: readonly string[],
  seed: number | undefined,
): { search: ArenaSearch; hash: string } {
  const id = testedId(source, null)
  const rivals = vs.map((slug) => `roster:${slug}`).join(',')
  return {
    search: { b: `local:${id},${rivals}`, ...(seed !== undefined && { seed }) },
    hash: sharedFragment([{ id, source }]),
  }
}
