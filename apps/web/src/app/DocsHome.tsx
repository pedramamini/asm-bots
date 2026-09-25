import { Button, cx, Kbd, Panel } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookText, Cpu, type LucideIcon, Rocket, Search, Swords } from 'lucide-react'
import { DOCS, type DocSection, docEntries } from '../docs'
import { sectionAnchor, sectionMeta } from '../docs/sections'
import { focusRouteSearch } from './keys'

const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
    text: 'The 60-second tour, then a first bot you can run in the arena.',
    slug: 'start-here',
  },
  {
    icon: Cpu,
    title: 'learn the machine',
    text: 'One 64 KB core, many processes: how a bot runs, and how it dies.',
    slug: 'machine/memory',
  },
  {
    icon: BookText,
    title: 'look up an instruction',
    text: 'Every opcode with its encoding, its flags, and an example to run.',
    slug: 'reference/data',
  },
  {
    icon: Swords,
    title: 'win more fights',
    text: 'Imps, dwarves, papers, scanners: the families, and what beats each.',
    slug: 'strategy/imps',
  },
]

/**
 * The hero's backdrop: the start page's imp, assembled, a few turns in. Its `movsw nop` (A5 90)
 * has begun to walk up the core; the rest is zero, which is `dat`.
 */
const DUMP = [
  '0000  E8 00 00 5B 83 EB 03 8D  77 0D 8D 7F 0F A5 90 A5',
  '0010  90 A5 90 A5 90 A5 90 00  00 00 00 00 00 00 00 00',
  '0020  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00',
]

/** `/docs`: the docs home. Where to start, and every page, by section, with its one sentence. */
export function DocsHome({ docs = DOCS }: { docs?: readonly DocSection[] }) {
  const pages = docEntries(docs).length
  const sections = docs.filter(({ pages }) => pages.length > 0)
  return (
    <section aria-label="docs home" className="flex flex-col gap-3">
      <Panel className="relative overflow-hidden">
        {/* An SVG, so the backdrop's dim bytes are drawing, not text held to a contrast ratio. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 400 54"
          className="pointer-events-none absolute top-3 right-3 hidden w-[400px] text-dim xl:block"
        >
          {DUMP.map((line, i) => (
            <text
              key={line}
              x="0"
              y={12 + i * 18}
              fill="currentColor"
              fontSize="12"
              xmlSpace="preserve"
            >
              {line}
            </text>
          ))}
        </svg>
        <div className="relative flex max-w-[64ch] flex-col gap-3 py-2">
          <p className="text-panel-title text-accent-fg">{'asm bots // manual'}</p>
          <h1 className="text-modal-title text-bright">
            Learn the machine. Write a bot. Take the hill.
          </h1>
          <p className="text-body text-muted">
            {pages} pages in {sections.length} sections. Every code block runs: open it in the
            editor to step through it, or in the arena to watch it fight.
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
      </Panel>

      <section aria-labelledby="where-to-start">
        <h2 id="where-to-start" className="sr-only">
          where to start
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {PATHS.map((path) => (
            <li key={path.title} className="flex">
              <PathCard path={path} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="every-page" className="flex flex-col gap-3">
        <h2 id="every-page" className="px-1 pt-2 text-panel-title text-muted">
          every page
        </h2>
        <div className="gap-3 lg:columns-2 2xl:columns-3">
          {sections.map((section) => (
            <SectionCard key={section.title} section={section} />
          ))}
        </div>
      </section>
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
        'group flex flex-1 flex-col gap-2 rounded-md border border-border bg-panel p-3',
        'transition-colors duration-120 ease-out hover:border-accent-45 hover:bg-panel-2',
        FOCUS,
      )}
    >
      <span className="flex items-center gap-2 text-panel-title text-accent-fg">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {title}
        <ArrowRight
          aria-hidden="true"
          className="ml-auto size-3.5 text-muted transition-transform duration-120 ease-out group-hover:translate-x-0.5 group-hover:text-accent-fg"
        />
      </span>
      <span className="text-body text-muted">{text}</span>
    </Link>
  )
}

/** A section's card: its icon, name, and sentence, then each page with its own. */
function SectionCard({ section }: { section: DocSection }) {
  const { icon: Icon, summary } = sectionMeta(section.title)
  const id = sectionAnchor(section.title)
  return (
    <Panel
      id={id}
      aria-label={section.title}
      className="mb-3 scroll-mt-3 break-inside-avoid"
      title={
        <span className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          {section.title}
        </span>
      }
      status={`${section.pages.length} ${section.pages.length === 1 ? 'page' : 'pages'}`}
    >
      {summary !== '' && <p className="mb-3 text-body text-muted">{summary}</p>}
      <ol className="flex flex-col">
        {section.pages.map((page, i) => (
          <li key={page.slug}>
            <Link
              to="/docs/$"
              params={{ _splat: page.slug }}
              className={cx(
                'group grid grid-cols-[1.75rem_1fr] rounded-sm px-1 py-1 transition-colors duration-120 ease-out hover:bg-panel-2',
                FOCUS,
              )}
            >
              <span aria-hidden="true" className="text-data text-muted tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span className="block text-body text-accent-fg underline decoration-accent-45 underline-offset-2 group-hover:decoration-accent">
                  {page.title}
                </span>
                <span className="block text-data text-muted">{page.blurb}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
