/**
 * The docs' tree (PRODUCT_SPEC §7): the sidebar's sections, their pages in reading order, and
 * each page's MDX. A page at slug `machine/memory` is the file `src/docs/machine/memory.mdx`,
 * unless it names another (`docFile`), or renders a Markdown file of the repository (`markdown`:
 * the changelog is CHANGELOG.md); `scripts/gen-docs-index.ts` reads the files this way
 * (`docSource`), and the docs tests hold every file to a page here. This module is in the entry
 * chunk (the docs route's `head` names the page), so it imports only the generated reference's
 * list: each page's MDX loads on its first visit.
 */
import type { MDXContent } from 'mdx/types'
import { REFERENCE } from './generated/reference/nav'

/** One page of the docs: its path under `/docs/`, its name, and its MDX, loaded on first visit. */
export interface DocPage {
  slug: string
  /** The MDX file under `src/docs/`, less `.mdx`, when it is not the slug: a generated page's. */
  file?: string
  /**
   * A Markdown file of the repository that the page renders in place of an MDX file, from
   * `src/docs/`: the changelog's is the root CHANGELOG.md, where release names live.
   */
  markdown?: string
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
  {
    title: 'strategy guide',
    pages: [
      {
        slug: 'strategy/imps',
        title: 'imps and imp rings',
        blurb: 'the self-copying bot: why it is hard to kill, and rings of spares.',
        load: () => import('./strategy/imps.mdx'),
      },
      {
        slug: 'strategy/dwarves',
        title: 'dwarves and stride math',
        blurb: 'bombers, what a stride hits, and which strides self-avoid.',
        load: () => import('./strategy/dwarves.mdx'),
      },
      {
        slug: 'strategy/stones',
        title: 'stones',
        blurb: 'several bombers in one bot, unrolled loops, and a decoy.',
        load: () => import('./strategy/stones.mdx'),
      },
      {
        slug: 'strategy/papers',
        title: 'papers and silk',
        blurb: 'replicators, what a copy costs, and why silk splits first.',
        load: () => import('./strategy/papers.mdx'),
      },
      {
        slug: 'strategy/scanners',
        title: 'scanners',
        blurb: 'repe scasb, the self-skip, carpets, and sampling.',
        load: () => import('./strategy/scanners.mdx'),
      },
      {
        slug: 'strategy/vampires',
        title: 'vampires and pits',
        blurb: 'jmp fangs built at run time, and the pit that holds a bot.',
        load: () => import('./strategy/vampires.mdx'),
      },
      {
        slug: 'strategy/imp-gates',
        title: 'imp gates',
        blurb: 'one word that kills every imp that walks through it.',
        load: () => import('./strategy/imp-gates.mdx'),
      },
      {
        slug: 'strategy/stack-tricks',
        title: 'stack tricks',
        blurb: 'call and pop for the base, and push as a one-byte bomb.',
        load: () => import('./strategy/stack-tricks.mdx'),
      },
      {
        slug: 'strategy/hygiene',
        title: 'anti-scanner hygiene',
        blurb: 'what a scanner sees, and what noise buys against it.',
        load: () => import('./strategy/hygiene.mdx'),
      },
      {
        slug: 'strategy/melee',
        title: 'melee tactics',
        blurb: 'scoring in a crowd: aggression against survival.',
        load: () => import('./strategy/melee.mdx'),
      },
      {
        slug: 'strategy/hill-meta',
        title: 'hill meta',
        blurb: 'what a hill score rewards, from a hill of the roster.',
        load: () => import('./strategy/hill-meta.mdx'),
      },
    ],
  },
  {
    title: 'tournaments and hills',
    pages: [
      {
        slug: 'tournaments/formats',
        title: 'formats',
        blurb: 'rounds, matches, round robins, brackets, and melees.',
        load: () => import('./tournaments/formats.mdx'),
      },
      {
        slug: 'tournaments/brackets',
        title: 'brackets',
        blurb: 'seeds, byes, who goes on, and the third-place match.',
        load: () => import('./tournaments/brackets.mdx'),
      },
      {
        slug: 'tournaments/hills',
        title: 'hills',
        blurb: 'king of the hill: how a challenge scores.',
        load: () => import('./tournaments/hills.mdx'),
      },
      {
        slug: 'tournaments/ratings',
        title: 'ratings',
        blurb: 'glicko-2 in plain words, with examples.',
        load: () => import('./tournaments/ratings.mdx'),
      },
      {
        slug: 'tournaments/verification',
        title: 'verification',
        blurb: 'why every result can be run again, and the verified chip.',
        load: () => import('./tournaments/verification.mdx'),
      },
    ],
  },
  {
    title: 'tools',
    pages: [
      {
        slug: 'tools/cli',
        title: 'the cli',
        blurb: 'asmbots: assemble, disassemble, fight, and run tournaments in a shell.',
        load: () => import('./tools/cli.mdx'),
      },
      {
        slug: 'tools/replay-format',
        title: 'the replay format',
        blurb: 'every field of a replay file and a replay link.',
        load: () => import('./tools/replay-format.mdx'),
      },
      {
        slug: 'tools/share-links',
        title: 'share links',
        blurb: 'what each link carries, and how it opens.',
        load: () => import('./tools/share-links.mdx'),
      },
      {
        slug: 'tools/keys',
        title: 'keyboard map',
        blurb: 'every key of the app.',
        load: () => import('./tools/keys.mdx'),
      },
      {
        slug: 'tools/api',
        title: 'api',
        blurb: 'the server api: sign in with a token, push bots, submit to hills.',
        load: () => import('./tools/api.mdx'),
      },
      {
        slug: 'tools/agents',
        title: 'agents',
        blurb: 'the docs as markdown, the skill download, and api tokens for ai agents.',
        load: () => import('./tools/agents.mdx'),
      },
    ],
  },
  {
    title: 'changelog',
    pages: [
      {
        slug: 'changelog',
        markdown: '../../../../CHANGELOG.md',
        title: 'changelog',
        blurb: 'what each release changed, and each release name.',
        load: () => import('../../../../CHANGELOG.md'),
      },
      {
        slug: 'isa-versions',
        title: 'isa versions',
        blurb: 'x16c v1, frozen, and what makes a new version.',
        load: () => import('./isa-versions.mdx'),
      },
    ],
  },
]

/** The MDX file of a page under `src/docs/`, less `.mdx`: `generated/reference/data`. */
export function docFile(page: DocPage): string {
  return page.file ?? page.slug
}

/** The file a page renders, from `src/docs/`, and how it reads: MDX, or plain Markdown. */
export interface DocSource {
  path: string
  format: 'md' | 'mdx'
}

/** A page's file: its MDX (`docFile`), or the repository's Markdown file it names. */
export function docSource(page: DocPage): DocSource {
  return page.markdown === undefined
    ? { path: `${docFile(page)}.mdx`, format: 'mdx' }
    : { path: page.markdown, format: 'md' }
}
