import { Button, Chip, cx, Panel } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { CodeXml, Compass, Grid2x2, Mountain, Trophy } from 'lucide-react'
import type { ReactNode } from 'react'
import { HexBand, Plate, Schematic, ScopeTrace } from '../art/lazy'
import { useBoot } from './boot/boot'
import { NavLink } from './Frame'
import { DocsLink } from './PageIntro'

/** Where the screenshots are served (`e2e/docs-shots.spec.ts` takes them), 1280 × 800 each. */
const SHOTS = '/docs-shots/'

/** A small screenshot of a page, framed like a window, that opens the page. */
function Shot({
  to,
  name,
  page,
  zoom,
  children,
}: {
  to: '/editor' | '/arena' | '/tournaments'
  name: string
  page: string
  /** A crop into the shot, for a page whose point is small at this size: its scale and origin. */
  zoom?: { scale: number; origin: string } | undefined
  children: string
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <Link
        to={to}
        className="group block overflow-hidden rounded-sm border border-border bg-panel-2 hover:border-border-strong focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="relative z-10 flex items-center gap-1.5 border-b border-border bg-panel-2 px-2 py-1 text-panel-status text-muted">
          <span className="text-accent-fg">ASM BOTS</span>
          <span>{`// ${page}`}</span>
        </span>
        <img
          src={`${SHOTS}${name}.webp`}
          width={1280}
          height={800}
          loading="lazy"
          decoding="async"
          alt={children}
          className="block aspect-[16/10] h-auto w-full opacity-90 group-hover:opacity-100"
          style={zoom && { scale: zoom.scale, transformOrigin: zoom.origin }}
        />
      </Link>
      <figcaption className="text-data text-muted">{children}</figcaption>
    </figure>
  )
}

/** A concept's art box: the space the art holds before it loads, and its frame. */
function ArtBox({ black = false, children }: { black?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        'relative aspect-[16/10] min-w-0 overflow-hidden rounded-sm border border-border',
        black ? 'bg-arena-bg' : 'bg-panel-2',
      )}
    >
      {children}
    </div>
  )
}

interface Concept {
  readonly title: string
  /** The line under the title, the concept in a phrase. */
  readonly headline: string
  readonly text: ReactNode
  /** The concept's numbers and facts, as chips. */
  readonly facts: readonly string[]
  readonly links: ReactNode
  /** Right of the text on a wide screen: the art, and a screenshot beside it. */
  readonly figure: ReactNode
}

const CONCEPTS: readonly Concept[] = [
  {
    title: 'the core',
    headline: '65,536 bytes, shared',
    text: (
      <>
        Every bot loads into one 64 KB core at its own address. The CPU gives each process one
        instruction a turn, round robin. A process that runs a zero byte dies. A bot can fork with{' '}
        <code className="text-accent-fg">spl</code>, and then it has more to lose.
      </>
    ),
    facts: ['64 KB core', '8086 subset', '64 processes a bot', '100,000 cycles'],
    links: (
      <span className="text-data text-muted">
        read <DocsLink to="machine/memory">the machine</DocsLink>
      </span>
    ),
    figure: (
      <div className="rounded-sm border border-border bg-panel-2 p-2">
        {/* The drawing's own box: 480 × 270. */}
        <div className="aspect-[16/9]">
          <Schematic />
        </div>
      </div>
    ),
  },
  {
    title: 'write',
    headline: '512 bytes of real 8086',
    text: 'A bot is a small program in 8086 assembly. The editor assembles it as you type and marks the line that will not fit. The debugger steps it forward and back, one instruction at a time, and shows each register and each byte it writes.',
    facts: ['512 B at most', 'assembles as you type', 'steps back'],
    links: (
      <NavLink to="/editor" icon={CodeXml}>
        open the editor
      </NavLink>
    ),
    figure: (
      <>
        <ArtBox>
          <Plate name="chip" />
        </ArtBox>
        <Shot to="/editor" name="tour-editor" page="EDITOR">
          the debugger, six steps into the imp
        </Shot>
      </>
    ),
  },
  {
    title: 'fight',
    headline: 'many bots, one core',
    text: 'Load two bots, or eight, into one core and watch them fight. Each write lands as a flash, each process is a point of light, and the map redraws at 60 frames a second. The same bots and seed give the same battle, so every fight replays from a link.',
    facts: ['melee, not just duels', '60 fps', 'replays by link'],
    links: (
      <NavLink to="/arena" icon={Grid2x2}>
        pick a fight
      </NavLink>
    ),
    figure: (
      <>
        <ArtBox black>
          <ScopeTrace />
          {/* The scope's labels are SVG text: dim on black is the art's, and axe skips a drawing. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full font-mono text-panel-status"
          >
            <text x={8} y={16} className="fill-arena-ruler">
              PROCS
            </text>
            <text x={8} y="100%" dy={-8} className="fill-arena-ruler">
              CYCLE 0 → 100,000
            </text>
          </svg>
        </ArtBox>
        <Shot to="/arena" name="tour-arena" page="ARENA">
          four roster bots, 12,000 cycles in
        </Shot>
      </>
    ),
  },
  {
    title: 'climb',
    headline: 'the hill never closes',
    text: 'Submit a bot to a hill and it fights every bot there; its rank is its score. Push the king off the top. Or enter the weekly championship: a bracket, one champion, and the champion’s name on the page.',
    facts: ['3 hills', 'weekly championship', 'ratings'],
    links: (
      <div className="flex flex-wrap gap-2">
        <NavLink to="/hills" icon={Mountain}>
          see the hills
        </NavLink>
        <NavLink to="/tournaments" icon={Trophy}>
          tournaments
        </NavLink>
      </div>
    ),
    figure: (
      <>
        <ArtBox>
          <Plate name="climb" />
        </ArtBox>
        <Shot
          to="/tournaments"
          name="tour-tournament"
          page="TOURNAMENTS"
          zoom={{ scale: 1.6, origin: '50% 42%' }}
        >
          a bracket of eight, fought to one champion
        </Shot>
      </>
    ),
  },
]

/**
 * `how it works`: the game's four ideas, the core, write, fight, climb, each with its art and a
 * screenshot of the page that does it, then the name in the imp's bytes and the tour again.
 */
export function HowItWorks() {
  const openTour = useBoot((state) => state.openTour)
  return (
    <Panel className="col-span-12" title="how it works" status="core war, in 8086">
      <ol className="flex flex-col">
        {CONCEPTS.map((concept, index) => (
          <li
            key={concept.title}
            className="grid gap-4 border-b border-border py-6 first:pt-2 lg:grid-cols-12 lg:gap-8"
          >
            <div
              className={cx(
                'flex flex-col gap-3 lg:col-span-5 lg:justify-center',
                index % 2 === 1 && 'lg:order-2',
              )}
            >
              <p className="flex items-baseline gap-2 text-panel-title">
                <span className="text-muted">{`0${index + 1}`}</span>
                <span className="text-accent-fg">{concept.title}</span>
              </p>
              <h3 className="text-modal-title text-bright">{concept.headline}</h3>
              <p className="text-body text-text">{concept.text}</p>
              <ul className="flex flex-wrap gap-1.5">
                {concept.facts.map((fact) => (
                  <li key={fact}>
                    <Chip>{fact}</Chip>
                  </li>
                ))}
              </ul>
              <div className="mt-1">{concept.links}</div>
            </div>
            <div
              className={cx(
                'grid min-w-0 content-center gap-3 lg:col-span-7',
                index > 0 && 'sm:grid-cols-2',
                index % 2 === 1 && 'lg:order-1',
              )}
            >
              {concept.figure}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-4 pt-6">
        {/* The name, drawn in the imp's bytes; each box holds its drawing's size. A phone gets
            the short name in fewer bytes a row, so the bytes stay big enough to read. */}
        <div className="hidden aspect-[1202/147] overflow-hidden sm:block">
          <HexBand word="ASM BOTS" />
        </div>
        <div className="aspect-[482/147] overflow-hidden sm:hidden">
          <HexBand word="ASM" cols={24} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-data text-muted">
          <Button icon={Compass} onClick={openTour}>
            take the tour
          </Button>
          <span>
            six steps, then a guided first battle. or read{' '}
            <DocsLink to="start-here">start here</DocsLink>.
          </span>
        </div>
      </div>
    </Panel>
  )
}
