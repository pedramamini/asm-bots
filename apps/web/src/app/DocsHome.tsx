import { Button, cx, Kbd, Panel } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BookText,
  Bot,
  Cpu,
  type LucideIcon,
  Rocket,
  Search,
  Swords,
} from 'lucide-react'
import { Plate } from '../art/lazy'
import { DOCS, type DocSection, docEntries } from '../docs'
import { sectionAnchor, sectionMeta } from '../docs/sections'
import { focusRouteSearch } from './keys'

const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A link in a card or a row: the accent, underlined, a brighter line under the pointer. */
const TEXT_LINK = cx(
  'rounded-sm text-accent-fg underline decoration-accent-45 underline-offset-2 hover:decoration-accent',
  FOCUS,
)

/** How many of a section's pages its card lists; `all N pages` opens the rest from the first. */
export const CARD_PAGES = 4

/** A way in for a reader who knows what they want, not where it is. */
interface Path {
  icon: LucideIcon
  title: string
  text: string
  slug: string
}

const PATHS: readonly Path[] = [
  {
    icon: Rocket,
    title: 'new here',
    text: 'The 60-second tour, then a first bot you can run.',
    slug: 'start-here',
  },
  {
    icon: Cpu,
    title: 'learn the machine',
    text: 'One 64 KB core: how a bot runs, and how it dies.',
    slug: 'machine/memory',
  },
  {
    icon: BookText,
    title: 'look up an instruction',
    text: 'Every opcode, its encoding, its flags, an example.',
    slug: 'reference/data',
  },
  {
    icon: Swords,
    title: 'win more fights',
    text: 'The families of bots, and what beats each.',
    slug: 'strategy/imps',
  },
]

/**
 * The files an AI agent reads, which the build writes beside the site: the docs as an index, the
 * whole docs in one file, and the skill to install.
 */
const AGENT_FILES = [
  { href: '/llms.txt', label: 'llms.txt' },
  { href: '/llms-full.txt', label: 'llms-full.txt' },
  { href: '/skill/asm-bots.zip', label: 'the skill (zip)' },
] as const

/**
 * `/docs`: the docs home. A short header with the search, four ways in, then a card for each
 * section (its sentence, its first pages, and a link to read it all), and the files for AI agents.
 * The sidebar lists every page; this page only points the way.
 */
export function DocsHome({ docs = DOCS }: { docs?: readonly DocSection[] }) {
  const pages = docEntries(docs).length
  const sections = docs.filter(({ pages }) => pages.length > 0)
  return (
    <section aria-label="docs home" className="flex flex-col gap-3">
      <Panel>
        <div className="flex items-center gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-3 py-1">
            <p className="text-panel-title text-accent-fg">{'asm bots // manual'}</p>
            <h1 className="text-modal-title text-bright">
              Learn the machine. Write a bot. Take the hill.
            </h1>
            <p className="text-body text-muted">
              {pages} pages in {sections.length} sections. Every code block runs in the editor or
              the arena.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={Search} onClick={() => focusRouteSearch()}>
                search the docs
              </Button>
              <span className="flex items-center gap-1.5 text-data text-muted">
                or press <Kbd>/</Kbd> on any docs page
              </span>
            </div>
          </div>
          {/* Art: the manual, open. Its box holds the space while it loads. */}
          <div className="hidden h-36 w-56 shrink-0 lg:block">
            <Plate name="manual" cell={2} />
          </div>
        </div>
      </Panel>

      <section aria-labelledby="where-to-start">
        <h2 id="where-to-start" className="sr-only">
          where to start
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PATHS.map((path) => (
            <li key={path.title} className="flex">
              <PathCard path={path} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sections">
        <h2 id="sections" className="sr-only">
          sections
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <li key={section.title} className="flex">
              <SectionCard section={section} />
            </li>
          ))}
        </ul>
      </section>

      <AgentsRow />
    </section>
  )
}

function PathCard({ path }: { path: Path }) {
  const { icon: Icon, title, text, slug } = path
  return (
    <Link
      to="/docs/$"
      params={{ _splat: slug }}
      className={cx(
        'group flex flex-1 flex-col gap-1 rounded-md border border-border bg-panel px-3 py-2',
        'transition-colors duration-120 ease-out hover:border-accent-45 hover:bg-panel-2',
        FOCUS,
      )}
    >
      <span className="flex items-center gap-2 text-panel-title text-accent-fg">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {title}
        <ArrowRight
          aria-hidden="true"
          className="ml-auto size-3.5 text-muted group-hover:text-accent-fg"
        />
      </span>
      <span className="text-data text-muted">{text}</span>
    </Link>
  )
}

/**
 * A section's card, at the section's anchor: its icon, name, and page count, its sentence, its
 * first pages, and `all N pages` when it has more. The cards of a row stand equal in height.
 */
function SectionCard({ section }: { section: DocSection }) {
  const { icon: Icon, summary } = sectionMeta(section.title)
  const count = section.pages.length
  const first = section.pages[0]
  return (
    <Panel
      id={sectionAnchor(section.title)}
      aria-label={section.title}
      className="flex-1 scroll-mt-3"
      title={
        <span className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          {section.title}
        </span>
      }
      status={`${count} ${count === 1 ? 'page' : 'pages'}`}
    >
      <div className="flex h-full flex-col gap-3">
        {summary !== '' && <p className="text-body text-muted">{summary}</p>}
        <ol className="flex flex-col gap-1 text-body">
          {section.pages.slice(0, CARD_PAGES).map((page, i) => (
            <li key={page.slug} className="flex gap-2">
              <span aria-hidden="true" className="w-5 shrink-0 text-data text-muted tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <Link to="/docs/$" params={{ _splat: page.slug }} className={TEXT_LINK}>
                {page.title}
              </Link>
            </li>
          ))}
        </ol>
        {count > CARD_PAGES && first !== undefined && (
          <Link
            to="/docs/$"
            params={{ _splat: first.slug }}
            className={cx('mt-auto flex items-center gap-1 self-start text-data', TEXT_LINK)}
          >
            all {count} pages
            <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
        )}
      </div>
    </Panel>
  )
}

/** One row for an AI agent: the docs as files it reads, the skill, and the page that explains them. */
function AgentsRow() {
  return (
    <section
      aria-labelledby="for-agents"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-panel px-3 py-2 text-data"
    >
      <h2 id="for-agents" className="flex items-center gap-2 text-panel-title text-accent-fg">
        <Bot aria-hidden="true" className="size-3.5 shrink-0" />
        for AI agents
      </h2>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {AGENT_FILES.map((file) => (
          <li key={file.href}>
            <a href={file.href} className={TEXT_LINK}>
              {file.label}
            </a>
          </li>
        ))}
        <li>
          <Link to="/docs/$" params={{ _splat: 'tools/agents' }} className={TEXT_LINK}>
            how an agent plays
          </Link>
        </li>
      </ul>
    </section>
  )
}
