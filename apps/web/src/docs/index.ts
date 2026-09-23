import type { MDXContent } from 'mdx/types'

/** One page of the docs: its path under `/docs/`, its name, and its MDX, loaded on first visit. */
export interface DocPage {
  slug: string
  /** Lowercase, as the sidebar and the tab show it: `start here`. */
  title: string
  /** One sentence for the contents page. */
  blurb: string
  load: () => Promise<{ default: MDXContent }>
}

/** A heading of the sidebar and the pages under it (PRODUCT_SPEC §7 orders them). */
export interface DocSection {
  title: string
  pages: readonly DocPage[]
}

/** The docs, in reading order. EXEC 2.6 writes the rest of PRODUCT_SPEC §7. */
export const DOCS: readonly DocSection[] = [
  {
    title: 'start here',
    pages: [
      {
        slug: 'start-here',
        title: 'start here',
        blurb: 'what asm bots is, and what the docs will cover.',
        load: () => import('./start-here.mdx'),
      },
    ],
  },
]

/** A page and the section it sits in. */
export interface DocEntry {
  section: string
  page: DocPage
}

/** Every page, in reading order. */
export function docEntries(docs: readonly DocSection[] = DOCS): DocEntry[] {
  return docs.flatMap((section) => section.pages.map((page) => ({ section: section.title, page })))
}

/** The page at `slug`, or undefined. */
export function findDoc(slug: string | undefined, docs = DOCS): DocPage | undefined {
  return docEntries(docs).find(({ page }) => page.slug === slug)?.page
}

/**
 * The pages whose title, section, or blurb holds every word of `query`, in reading order. An empty
 * query matches every page. EXEC 2.6 replaces this with a full-text index.
 */
export function searchDocs(query: string, docs = DOCS): DocEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return docEntries(docs).filter(({ section, page }) => {
    const text = `${section} ${page.title} ${page.blurb}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}
