import { DOCS, type DocPage, type DocSection } from './nav'

export type { DocPage, DocSection, DocSource } from './nav'
export { DOCS, docFile, docSource } from './nav'

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

/** Where a page sits: its section, and its place in it (from 0) of the section's pages. */
export interface DocPlace {
  section: DocSection
  page: DocPage
  at: number
  of: number
}

/** The section and place of the page at `slug`, or undefined. */
export function docPlace(slug: string | undefined, docs = DOCS): DocPlace | undefined {
  for (const section of docs) {
    const at = section.pages.findIndex((page) => page.slug === slug)
    const page = section.pages[at]
    if (page !== undefined) return { section, page, at, of: section.pages.length }
  }
  return undefined
}

/** The pages before and after `slug` in reading order, across sections: the page's prev/next. */
export function docNeighbors(
  slug: string,
  docs = DOCS,
): { prev: DocEntry | undefined; next: DocEntry | undefined } {
  const entries = docEntries(docs)
  const at = entries.findIndex(({ page }) => page.slug === slug)
  if (at < 0) return { prev: undefined, next: undefined }
  return { prev: entries[at - 1], next: entries[at + 1] }
}
