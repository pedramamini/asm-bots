import type { Tournament, TournamentSummary } from '@asmbots/protocol'
import { Button, cx, EmptyState, Panel, PanelGrid, Stat } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  Bot,
  CodeXml,
  Compass,
  Grid2x2,
  type LucideIcon,
  Mountain,
  Trophy,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useHill, useHillMatches, useTournament, useTournaments } from '../api/queries'
import { HexBand, Plate } from '../art/lazy'
import { HillStandingsTable } from '../features/hills/HillStandingsTable'
import { CELL_LINK, count, day } from '../features/hills/links'
import { MatchesTable } from '../features/hills/MatchesTable'
import { EnterButton } from '../features/tournaments/EnterModal'
import { useBoot } from './boot/boot'
import { HowItWorks } from './HowItWorks'
import { LoadFailure, readStatus } from './LoadFailure'
import { LogoMark } from './Logo'
import { useLinkAction } from './link-action'
import { DocsLink } from './PageIntro'

/** The rows the hill and match panels hold (PRODUCT_SPEC §1): a top 10, and the last 10. */
const ROWS = 10

/** The hill the home page shows. */
const MAIN_HILL = 'main'

/** A keyboard focus: the kit's 1 px accent outline, 2 px out. */
const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A part's name, its link: the title's accent, underlined under the pointer. */
const NAME = cx('rounded-sm underline-offset-2 hover:underline', FOCUS)

/** A link in a part's text: the accent, underlined, as a link in running text is. */
const TEXT_LINK = cx(
  'rounded-sm text-accent-fg underline decoration-accent-45 underline-offset-2 hover:decoration-accent',
  FOCUS,
)

/** A part of the site, as the home page's overview names it. */
interface Part {
  readonly key: string
  /** The nav's icon for it (DESIGN_SYSTEM §6). */
  readonly icon: LucideIcon
  /** The part's name, a link to it. */
  readonly name: ReactNode
  readonly text: string
  /** More ways in, under the text. */
  readonly more?: ReactNode
}

const PARTS: readonly Part[] = [
  {
    key: 'arena',
    icon: Grid2x2,
    name: (
      <Link to="/arena" className={NAME}>
        arena
      </Link>
    ),
    text: 'Load bots into one 64 KB core and watch them fight. Every battle replays from a link.',
    more: (
      <Link to="/arena" search={{ intro: true }} className={TEXT_LINK}>
        watch the intro fight
      </Link>
    ),
  },
  {
    key: 'editor',
    icon: CodeXml,
    name: (
      <Link to="/editor" className={NAME}>
        editor
      </Link>
    ),
    text: 'Write 8086 assembly, 512 bytes at most. The debugger steps it forward and back.',
  },
  {
    key: 'hills',
    icon: Mountain,
    name: (
      <Link to="/hills" className={NAME}>
        hills
      </Link>
    ),
    text: 'Ladders that never close. Its rank on the hill is its score.',
  },
  {
    key: 'tournaments',
    icon: Trophy,
    name: (
      <Link to="/tournaments" className={NAME}>
        tournaments
      </Link>
    ),
    text: 'Brackets, round robins, melees, and the weekly championship.',
  },
  {
    key: 'docs',
    icon: BookOpen,
    name: (
      <Link to="/docs" className={NAME}>
        docs
      </Link>
    ),
    text: 'The machine, every instruction, and the strategies that win.',
    more: (
      <Link to="/docs/$" params={{ _splat: 'start-here' }} className={TEXT_LINK}>
        start here
      </Link>
    ),
  },
  {
    key: 'agents',
    icon: Bot,
    name: (
      <Link to="/docs/$" params={{ _splat: 'tools/agents' }} className={NAME}>
        for agents
      </Link>
    ),
    text: 'The docs, a skill, and API tokens, so an AI agent can write and push bots.',
    more: (
      <>
        <a href="/llms.txt" className={TEXT_LINK}>
          llms.txt
        </a>
        <a href="/skill/asm-bots.zip" className={TEXT_LINK}>
          the skill
        </a>
      </>
    ),
  },
]

/**
 * `/` (PRODUCT_SPEC §1): the banner (the name in the imp's bytes, the one line, and the tour),
 * how the game works with its art (`HowItWorks`, the parts of the site at its head), then the
 * main hill's top 10, its recent matches, and the next championship, read from the API; until
 * each read lands its panel holds a skeleton. The championship's `enter` takes one of my bots
 * while its entries are open. Nothing on the page moves (DESIGN_SYSTEM §10).
 */
export function HomePage() {
  return (
    <PanelGrid className="p-3">
      <Banner />
      <HowItWorks site={<SiteParts />} />
      <MainHill />
      <RecentMatches />
      <Championship />
    </PanelGrid>
  )
}

/** The name drawn in the imp's bytes, the name and the one line, and the tour. */
function Banner() {
  const openTour = useBoot((state) => state.openTour)
  return (
    <section
      aria-labelledby="home-title"
      className="col-span-12 flex flex-col gap-3 rounded-md border border-border bg-panel p-3"
    >
      {/* Each box holds its drawing's size. A phone gets the short name in fewer bytes a row, so
          the bytes stay big enough to read. */}
      <div className="hidden aspect-[1202/147] overflow-hidden sm:block">
        <HexBand word="ASM BOTS" />
      </div>
      <div className="aspect-[482/147] overflow-hidden sm:hidden">
        <HexBand word="ASM" cols={24} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <h1 id="home-title" className="flex items-center gap-2 text-modal-title text-bright">
            <LogoMark size={24} />
            ASM BOTS
          </h1>
          <p className="text-body text-muted">Write 8086 assembly. Fight for 64 KB.</p>
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
    </section>
  )
}

/** The parts of the site, a line each: the name (its link), what it is, and more ways in. */
function SiteParts() {
  return (
    <ul aria-label="the site" className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {PARTS.map(({ key, icon: Icon, name, text, more }) => (
        <li key={key} className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-panel-title text-accent-fg">
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            {name}
          </h3>
          <p className="text-data text-muted">{text}</p>
          {more !== undefined && <p className="flex flex-wrap gap-x-4 text-data">{more}</p>}
        </li>
      ))}
    </ul>
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
      data-tour="home-hill"
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
          {/* The cup, as art; the box holds its space while it loads. */}
          <div className="h-28 overflow-hidden rounded-sm border border-border bg-panel-2">
            <Plate name="trophy" />
          </div>
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
