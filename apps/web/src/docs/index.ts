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
