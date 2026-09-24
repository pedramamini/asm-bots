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
        file: 'start/index',
        title: 'start here',
        blurb: 'what asm bots is, the 60-second tour, and your first bot.',
        load: () => import('./start/index.mdx'),
      },
    ],
  },
  {
    title: 'the machine',
    pages: [
      {
        slug: 'machine/memory',
        title: 'memory',
        blurb: 'one 64 KB ring: wrap, zero as DAT, code as data, and ownership.',
        load: () => import('./machine/memory.mdx'),
      },
      {
        slug: 'machine/registers',
        title: 'registers and flags',
        blurb: 'what each register is for, how a process starts, and the seven flags.',
        load: () => import('./machine/registers.mdx'),
      },
      {
        slug: 'machine/processes',
        title: 'processes and cycles',
        blurb: 'the process queue, one instruction a turn, rep, spl, and the cap.',
        load: () => import('./machine/processes.mdx'),
      },
      {
        slug: 'machine/death',
        title: 'death',
        blurb: 'every reason a process dies, and what does not kill.',
        load: () => import('./machine/death.mdx'),
      },
      {
        slug: 'machine/placement',
        title: 'placement and seeds',
        blurb: 'where the loader puts each bot, and why one seed replays a battle.',
        load: () => import('./machine/placement.mdx'),
      },
      {
        slug: 'machine/scoring',
        title: 'scoring',
        blurb: 'pMARS points for a round, and the sum for a match.',
        load: () => import('./machine/scoring.mdx'),
      },
      {
        slug: 'machine/position-independence',
        title: 'position independence',
        blurb: 'why [label] is absolute, and the base idiom that fixes it.',
        load: () => import('./machine/position-independence.mdx'),
      },
      {
        slug: 'machine/debugger',
        title: 'the debugger tour',
        blurb: 'the panels, the moves and their keys, and a walk through the imp.',
        load: () => import('./machine/debugger.mdx'),
      },
    ],
  },
  REFERENCE,
]

/** The MDX file of a page under `src/docs/`, less `.mdx`: `generated/reference/data`. */
export function docFile(page: DocPage): string {
  return page.file ?? page.slug
}
