/**
 * The docs' tree (PRODUCT_SPEC §7): the sidebar's sections, their pages in reading order, and
 * each page's MDX. A page at slug `machine/memory` is the file `src/docs/machine/memory.mdx`,
 * unless it names another (`docFile`); `scripts/gen-docs-index.ts` reads the files this way, and
 * the docs tests hold every file to a page here. This module is in the entry chunk (the docs
 * route's `head` names the page), so it imports only the generated reference's list: each page's
 * MDX loads on its first visit.
 */
import type { MDXContent } from 'mdx/types'
import { REFERENCE } from './generated/reference/nav'

/** One page of the docs: its path under `/docs/`, its name, and its MDX, loaded on first visit. */
export interface DocPage {
  slug: string
  /** The MDX file under `src/docs/`, less `.mdx`, when it is not the slug: a generated page's. */
  file?: string
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

/** The docs, in reading order. */
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
  REFERENCE,
]

/** The MDX file of a page under `src/docs/`, less `.mdx`: `generated/reference/data`. */
export function docFile(page: DocPage): string {
  return page.file ?? page.slug
}
