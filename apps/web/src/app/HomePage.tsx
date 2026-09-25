import type { Tournament, TournamentSummary } from '@asmbots/protocol'
import { Button, EmptyState, Panel, PanelGrid, RadarLoader, Stat } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { CodeXml, Compass, Grid2x2, Mountain } from 'lucide-react'
import { type ComponentType, lazy, Suspense, useState } from 'react'
import { useHill, useHillMatches, useTournament, useTournaments } from '../api/queries'
import type { HomeDemoProps } from '../features/arena/demo/HomeDemo'
import { HillStandingsTable } from '../features/hills/HillStandingsTable'
import { CELL_LINK, count, day } from '../features/hills/links'
import { MatchesTable } from '../features/hills/MatchesTable'
import { EnterButton } from '../features/tournaments/EnterModal'
import { useBoot } from './boot/boot'
import { NavLink } from './Frame'
import { LoadFailure, readStatus } from './LoadFailure'
import { LogoMark } from './Logo'
import { useLinkAction } from './link-action'
import { DocsLink } from './PageIntro'
import { usePaintedAndIdle } from './paint'

/** The rows the hill and match panels hold (PRODUCT_SPEC §1): a top 10, and the last 10. */
const ROWS = 10

/** The hill the home page shows. */
const MAIN_HILL = 'main'

/** The demo battle, and the arena with it, load after the page: the page does not wait for them. */
const HomeDemo = lazy(() =>
  import('../features/arena/demo/HomeDemo').then((module) => ({ default: module.HomeDemo })),
)

export interface HomePageProps {
  /** The hero's battle. Default: the arena's demo (`features/arena/demo`). */
  demo?: ComponentType<HomeDemoProps> | undefined
}

/**
 * `/` (PRODUCT_SPEC §1): the hero over the live demo battle, how the game works in three steps,
 * then the main hill's top 10, its recent matches, and the next championship, read from the API;
 * until each read lands its panel holds a skeleton. The championship's `enter` takes one of my
 * bots while its entries are open.
 */
export function HomePage({ demo = HomeDemo }: HomePageProps) {
  return (
    <PanelGrid className="p-3">
      <Hero demo={demo} />
      <HowItWorks />
      <MainHill />
      <RecentMatches />
      <Championship />
    </PanelGrid>
  )
}

function MainHill() {
  const read = useHill(MAIN_HILL)
  const { data, error } = read
  const link = useLinkAction()
  return (
    <Panel
      className="col-span-12 xl:col-span-6"
      title="main hill"
      status={readStatus(data, error, (d) => `${d.standings.length} of ${d.hill.size}`)}
    >
      {error !== null && data === undefined ? (
        <LoadFailure read={read} />
      ) : (
        <HillStandingsTable
          aria-label="main hill, top 10"
          compact
          rows={ROWS}
          standings={data?.standings.slice(0, ROWS)}
          empty={
            <EmptyState action={link('submit a bot', `/hills/${MAIN_HILL}`)}>
              no entrants yet.
            </EmptyState>
          }
        />
      )}
    </Panel>
  )
}

function RecentMatches() {
  const read = useHillMatches(MAIN_HILL, { limit: ROWS })
  const { data, error } = read
  return (
    <Panel
      className="col-span-12 md:col-span-6 xl:col-span-3"
      title="recent matches"
      status={readStatus(data, error, () => MAIN_HILL)}
    >
      {error !== null && data === undefined ? (
        <LoadFailure read={read} />
      ) : (
        <MatchesTable aria-label="recent matches" compact rows={ROWS} matches={data?.matches} />
      )}
    </Panel>
  )
}

/**
 * The championship to show (a tournament with no owner): the one running, else the next
 * scheduled; null when neither.
 */
export function nextChampionship(tournaments: readonly Tournament[]): Tournament | null {
  const championships = tournaments.filter((t) => t.ownerId === null)
  const running = championships.find((t) => t.status === 'running')
  if (running !== undefined) return running
  const scheduled = championships
    .filter((t) => t.status === 'scheduled')
    .sort((a, b) => (a.startsAt ?? '\uffff').localeCompare(b.startsAt ?? '\uffff'))
  return scheduled[0] ?? null
}

/** The championship that finished last, with its champion; null when none has. */
export function lastChampionship(
  summaries: readonly TournamentSummary[],
): TournamentSummary | null {
  const finished = summaries.filter(
    (s) => s.tournament.ownerId === null && s.tournament.status === 'finished' && s.champion,
  )
  finished.sort((a, b) =>
    (b.tournament.finishedAt ?? '').localeCompare(a.tournament.finishedAt ?? ''),
  )
  return finished[0] ?? null
}

/**
 * The next championship (its name opens it), its entrants so far, the last one's champion, and
 * `enter` while it takes entries.
 */
function Championship() {
  const list = useTournaments()
  const next =
    list.data === undefined
      ? undefined
      : nextChampionship(list.data.tournaments.map((s) => s.tournament))
  const detail = useTournament(next?.id ?? null)
  const last = list.data === undefined ? null : lastChampionship(list.data.tournaments)
  const loading = list.data === undefined && list.error === null
  return (
    <Panel
      className="col-span-12 md:col-span-6 xl:col-span-3"
      title="championship"
      status={readStatus(list.data, list.error, () => next?.status ?? 'none')}
    >
      {list.error !== null && list.data === undefined ? (
        <LoadFailure read={list} />
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <Stat
            label="next event"
            loading={loading}
            value={
              next === undefined ? undefined : next === null ? (
                'none scheduled'
              ) : (
                <Link to="/tournaments/$id" params={{ id: next.id }} className={CELL_LINK}>
                  {next.name}
                </Link>
              )
            }
            note={next?.startsAt ? day(next.startsAt) : undefined}
          />
          <Stat
            label="entrants so far"
            loading={loading || (next != null && detail.data === undefined)}
            value={
              next === null ? '–' : detail.data ? count(detail.data.entrants.length) : undefined
            }
          />
          {last?.champion != null && (
            <p className="text-data text-muted">
              last: <span className="text-accent-fg">{last.champion.name}</span> won{' '}
              {last.tournament.name}
            </p>
          )}
          <div className="mt-auto self-start">
            {next == null ? (
              <Button variant="primary" disabled>
                enter
              </Button>
            ) : (
              <EnterButton tournament={next} entrants={detail.data?.entrants} />
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

/**
 * The demo battle on the arena's black, and over it the name, the one line, and the two ways in.
 * They sit on a panel: the arena is black in every theme, and paper's text is dark.
 */
function Hero({ demo: Demo }: { demo: ComponentType<HomeDemoProps> }) {
  const [status, setStatus] = useState('4 bots · loading')
  // Not under the boot screen: the demo starts when the page shows.
  const booting = useBoot((state) => state.phase === 'boot')
  const idle = usePaintedAndIdle() && !booting
  const loader = (
    <div className="absolute inset-0 grid place-items-center">
      <RadarLoader label="loading the demo battle" framed />
    </div>
  )
  return (
    <Panel className="col-span-12" title="live demo" status={status}>
      <div className="relative h-80 overflow-hidden rounded-sm border border-border bg-arena-bg">
        {idle ? (
          <Suspense fallback={loader}>
            <Demo onStatus={setStatus} />
          </Suspense>
        ) : (
          loader
        )}
        <div className="absolute bottom-3 left-3 flex flex-col gap-2 rounded-md border border-border bg-panel p-4">
          <h1 className="flex items-center gap-2 text-modal-title text-bright">
            <LogoMark size={24} />
            ASM BOTS
          </h1>
          <p className="text-body text-muted">Write 8086 assembly. Fight for 64 KB.</p>
          <div className="mt-1 flex gap-2">
            <NavLink to="/arena" icon={Grid2x2}>
              open arena
            </NavLink>
            <NavLink to="/editor" icon={CodeXml}>
              write a bot
            </NavLink>
          </div>
        </div>
      </div>
    </Panel>
  )
}

/** A step of `HowItWorks`. */
interface HowStep {
  title: string
  text: string
  link: { to: '/editor' | '/arena' | '/hills'; label: string; icon: typeof Grid2x2 }
}

const HOW: readonly HowStep[] = [
  {
    title: 'write',
    text: 'A bot is a small 8086 program, 512 bytes at most. The editor assembles it as you type, and its debugger steps it one instruction at a time.',
    link: { to: '/editor', label: 'open the editor', icon: CodeXml },
  },
  {
    title: 'fight',
    text: 'Load two or more bots into one 64 KB core. They take turns, one instruction each. A process that runs a zero byte dies; the last bot running wins.',
    link: { to: '/arena', label: 'pick a fight', icon: Grid2x2 },
  },
  {
    title: 'climb',
    text: 'Submit a bot to a hill, a ladder that never closes, and see where it ranks. Or enter the weekly championship.',
    link: { to: '/hills', label: 'see the hills', icon: Mountain },
  },
]

/** Three steps, write, fight, climb, and the tour again for whoever wants it. */
function HowItWorks() {
  const openTour = useBoot((state) => state.openTour)
  return (
    <Panel className="col-span-12" title="how it works" status="core war, in 8086">
      <div className="flex flex-col gap-4">
        <ol className="grid gap-3 md:grid-cols-3">
          {HOW.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-2 rounded-md border border-border bg-panel-2 p-3"
            >
              <p className="flex items-baseline gap-2 text-panel-title">
                <span className="text-muted">{`0${index + 1}`}</span>
                <span className="text-accent-fg">{step.title}</span>
              </p>
              <p className="flex-1 text-body text-text">{step.text}</p>
              <div>
                <NavLink to={step.link.to} icon={step.link.icon}>
                  {step.link.label}
                </NavLink>
              </div>
            </li>
          ))}
        </ol>
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
