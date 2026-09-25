/**
 * `bun run docs-index` writes `apps/web/src/docs/generated/search-index.json`, the docs' search
 * index (`src/docs/search.ts`): each page of `src/docs/nav.ts` read from its MDX, cut at its `##`
 * and `###` headings, each piece's prose (paragraphs, lists, tables, callouts; not code) under its
 * heading's anchor. `--check` writes nothing and exits 1 when the file is not what it would write;
 * `test/docs-index.test.ts` runs that check in `bun test`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProcessor } from '@mdx-js/mdx'
import { DOCS, type DocPage, type DocSource, docSource } from '../src/docs/nav'
import { REMARK_PLUGINS } from '../src/docs/remark'
import { buildSearchIndex, type SearchRecord } from '../src/docs/search'
import { headingId } from '../src/docs/text'

const DOCS_URL = new URL('../src/docs/', import.meta.url)
/** The docs' MDX files: a page at slug `a/b` is `a/b.mdx` here, unless it names its file. */
export const DOCS_DIR = fileURLToPath(DOCS_URL)
/** The file this writes. */
export const OUT = fileURLToPath(
  new URL('../src/docs/generated/search-index.json', import.meta.url),
)

/** The file of `page`: its MDX, or the repository's Markdown file it renders. */
export function pageFile(page: DocPage): string {
  return fileURLToPath(new URL(docSource(page).path, DOCS_URL))
}

interface MdNode {
  type: string
  depth?: number
  name?: string | null
  value?: string
  children?: MdNode[]
}

/** The blocks whose text is not prose: code, the diagrams that draw from data, and pictures. */
const SKIPPED_ELEMENTS = new Set(['Asm', 'Encoding', 'Flags', 'Fig', 'Shot'])

/** Nodes whose children run together as one line of text; any other parent spaces them. */
const PHRASING = new Set([
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
  'tableCell',
  'mdxJsxTextElement',
])

/** The text a node reads as: its words and inline code, with no Markdown. */
function plain(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'code' || node.type === 'mdxjsEsm' || node.type.endsWith('Expression')) {
    return ''
  }
  if (node.type === 'mdxJsxFlowElement' && SKIPPED_ELEMENTS.has(node.name ?? '')) return ''
  const parts = (node.children ?? []).map(plain)
  return PHRASING.has(node.type) ? parts.join('') : parts.join(' ')
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * A page's records: its top (the text before its first `##`), then one per `##` and `###`.
 * Throws when two headings of the page share an anchor: a link could reach only the first.
 * `format` is how the page reads: MDX, or plain Markdown (the changelog).
 */
export function pageRecords(
  slug: string,
  title: string,
  mdx: string,
  format: DocSource['format'] = 'mdx',
): SearchRecord[] {
  const tree = createProcessor({ format, remarkPlugins: REMARK_PLUGINS }).parse(mdx) as MdNode
  const records: SearchRecord[] = [{ slug, heading: title, anchor: '', text: '' }]
  const texts: string[][] = [[]]
  for (const node of tree.children ?? []) {
    if (node.type === 'heading' && (node.depth === 2 || node.depth === 3)) {
      const heading = squash(plain(node))
      const anchor = headingId(heading)
      if (records.some((record) => record.anchor === anchor)) {
        throw new Error(`${slug}.mdx: two headings have the anchor #${anchor}; rename one`)
      }
      records.push({ slug, heading, anchor, text: '' })
      texts.push([])
    } else if (node.type !== 'heading' || node.depth !== 1) {
      texts[texts.length - 1]?.push(plain(node))
    }
  }
  return records.map((record, at) => ({ ...record, text: squash(texts[at]?.join(' ') ?? '') }))
}

/** The index of every page of `DOCS`, in reading order. */
export function generate(
  read: (page: DocPage) => string = (p) => readFileSync(pageFile(p), 'utf8'),
) {
  const pages = DOCS.flatMap((section) => section.pages.map((page) => ({ section, page })))
  const records = pages.flatMap(({ page }) =>
    pageRecords(page.slug, page.title, read(page), docSource(page).format),
  )
  const tops = new Map(
    pages.map(({ section, page }) => [page.slug, `${section.title} ${page.blurb}`]),
  )
  // A page's top also holds its section's name and its blurb: `strategy` finds every strategy page.
  return buildSearchIndex(records, (record) =>
    record.anchor === '' ? (tops.get(record.slug) ?? '') : '',
  )
}

/** The file's text: `generate` of the MDX on disk, as JSON with a line per record and per word. */
export function render(): string {
  const { records, words } = generate()
  const lines = (items: string[]) => items.map((item) => `    ${item}`).join(',\n')
  return `{\n  "records": [\n${lines(records.map((r) => JSON.stringify(r)))}\n  ],\n  "words": {\n${lines(
    Object.entries(words).map(([word, at]) => `${JSON.stringify(word)}: ${JSON.stringify(at)}`),
  )}\n  }\n}\n`
}

if (import.meta.main) {
  const check = process.argv.includes('--check')
  const text = render()
  const shown = relative(process.cwd(), OUT)
  if (check) {
    let old = ''
    try {
      old = readFileSync(OUT, 'utf8')
    } catch {}
    if (old !== text) {
      console.error(`${shown} is out of date: run \`bun run docs-index\``)
      process.exit(1)
    }
    console.log(`${shown} is up to date`)
  } else {
    writeFileSync(OUT, text)
    const { records } = JSON.parse(text) as { records: unknown[] }
    console.log(`wrote ${shown}: ${records.length} sections`)
  }
}
