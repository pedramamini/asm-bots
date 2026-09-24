/**
 * The docs' full-text search: an inverted index over every page's headings and paragraphs, which
 * `scripts/gen-docs-index.ts` builds from the MDX and writes to `generated/search-index.json`.
 * The sidebar loads that file the first time the search is used.
 */

/** A searchable piece of a page: its top (anchor `''`), or one of its `##`/`###` sections. */
export interface SearchRecord {
  slug: string
  /** The page's title for its top; else the heading's text. */
  heading: string
  /** The heading's id on the page (`text.ts`); `''` for the page's top. */
  anchor: string
  /** The prose under the heading, up to the next one: paragraphs, lists, tables, callouts. */
  text: string
}

export interface SearchIndex {
  records: SearchRecord[]
  /** Each word, and the records that hold it, in order. */
  words: Record<string, number[]>
}

const WORD = /[a-z0-9_]+/g

/** The words of `text`, lowercase: `rep movsw`, `ModR/M` is `modr` and `m`. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? []
}

/**
 * The index of `records`. `extra` adds words to a record that its text does not show: a page's
 * top holds its section and its blurb.
 */
export function buildSearchIndex(
  records: readonly SearchRecord[],
  extra: (record: SearchRecord) => string = () => '',
): SearchIndex {
  const words = new Map<string, number[]>()
  records.forEach((record, at) => {
    const all = new Set(wordsOf(`${record.heading} ${record.text} ${extra(record)}`))
    for (const word of all) {
      const list = words.get(word)
      if (list === undefined) words.set(word, [at])
      else list.push(at)
    }
  })
  const sorted = [...words].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return { records: [...records], words: Object.fromEntries(sorted) }
}

/**
 * The records that hold a word starting with each word of `query` (`rep mov` finds `rep movsw`),
 * best first: those whose heading holds the words, then whole words over prefixes, then reading
 * order. An empty query finds nothing.
 */
export function searchIndex(index: SearchIndex, query: string, limit = 20): SearchRecord[] {
  const terms = [...new Set(wordsOf(query))]
  if (terms.length === 0) return []
  const vocabulary = Object.keys(index.words)
  const holding = terms.map((term) => {
    const found = new Set<number>()
    for (const word of vocabulary) {
      if (word.startsWith(term)) for (const at of index.words[word] ?? []) found.add(at)
    }
    return found
  })
  const hits = [...(holding[0] ?? [])].filter((at) => holding.every((found) => found.has(at)))
  const score = (at: number): number => {
    const record = index.records[at] as SearchRecord
    const heading = wordsOf(record.heading)
    const all = new Set([...heading, ...wordsOf(record.text)])
    let points = 0
    for (const term of terms) {
      if (heading.some((word) => word.startsWith(term))) points += 2
      if (all.has(term)) points += 1
    }
    return points
  }
  return hits
    .map((at) => ({ at, points: score(at) }))
    .sort((a, b) => b.points - a.points || a.at - b.at)
    .slice(0, limit)
    .map(({ at }) => index.records[at] as SearchRecord)
}

/**
 * About `width` characters of `text` around the first word of `query` it holds, with `…` where it
 * cuts: the line under a search hit.
 */
export function excerpt(text: string, query: string, width = 96): string {
  if (text.length <= width) return text
  const lower = text.toLowerCase()
  const hits = wordsOf(query)
    .map((term) => lower.search(new RegExp(`(?<![a-z0-9_])${term}`)))
    .filter((at) => at >= 0)
  const at = hits.length === 0 ? 0 : Math.min(...hits)
  const start = Math.max(0, Math.min(at - Math.floor(width / 3), text.length - width))
  const end = Math.min(text.length, start + width)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

let loading: Promise<SearchIndex> | null = null

/** The built index, loaded once, on the search's first use. */
export function loadSearchIndex(): Promise<SearchIndex> {
  loading ??= import('./generated/search-index.json').then(
    (module) => module.default as SearchIndex,
    (error: unknown) => {
      loading = null
      throw error
    },
  )
  return loading
}
