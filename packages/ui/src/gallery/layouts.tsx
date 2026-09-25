/*
 * The three reference layouts of DESIGN_SYSTEM §4, each a frame of ticker, header, optional
 * toolbar, content, and status row, built from the primitives with placeholder data:
 *
 *   arena        no toolbar, an instrument beside a rail      (ref-atxsentinel-map.png)
 *   hills        the filter row over loaded panels            (§4's own sketch)
 *   tournaments  no toolbar, every panel loading, the radar   (ref-atxsentinel-stats.png)
 */
import {
  BookOpen,
  Camera,
  CodeXml,
  Download,
  Grid2x2,
  Keyboard,
  MapIcon,
  Maximize,
  Mountain,
  Palette,
  Pause,
  RefreshCw,
  StepBack,
  StepForward,
  Trophy,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { type ReactNode, useId, useMemo } from 'react'
import { hueColor } from '../hue'
import { Button } from '../primitives/Button'
import { Chip } from '../primitives/Chip'
import { EmptyState } from '../primitives/EmptyState'
import { Header } from '../primitives/Header'
import { HueSwatch } from '../primitives/HueSwatch'
import { IconButton } from '../primitives/IconButton'
import { Identicon } from '../primitives/Identicon'
import { Input } from '../primitives/Input'
import { NavButton } from '../primitives/NavButton'
import { Panel } from '../primitives/Panel'
import { PanelGrid } from '../primitives/PanelGrid'
import { RadarLoader } from '../primitives/RadarLoader'
import { Segmented } from '../primitives/Segmented'
import { Select } from '../primitives/Select'
import { Skeleton } from '../primitives/Skeleton'
import { Slider } from '../primitives/Slider'
import { Sparkline } from '../primitives/Sparkline'
import { Stat } from '../primitives/Stat'
import { StatusBar } from '../primitives/StatusBar'
import { Table, type TableColumn } from '../primitives/Table'
import { Ticker } from '../primitives/Ticker'
import { Toggle } from '../primitives/Toggle'
import { Toolbar } from '../primitives/Toolbar'
import { cx, vars } from '../style'
import type { Theme } from '../themes'
import { ArenaMock } from './ArenaMock'
import { battle, footprints } from './battle'
import {
  BATTLE_BOTS,
  BATTLE_EVENTS,
  type BattleBot,
  type BattleEvent,
  CYCLE,
  type Entrant,
  grouped,
  HILL,
  KING_RATINGS,
  MAX_CYCLES,
  SUBMISSIONS,
  type Submission,
  YOUR_RANKS,
} from './data'
import { stay } from './specimen'

/** The header's routes and their icons (DESIGN_SYSTEM §6). */
const ROUTES = [
  { route: 'arena', icon: Grid2x2 },
  { route: 'editor', icon: CodeXml },
  { route: 'tournaments', icon: Trophy },
  { route: 'hills', icon: Mountain },
  { route: 'docs', icon: BookOpen },
] as const

type Route = (typeof ROUTES)[number]['route']

interface FrameProps {
  route: Route
  /** What the frame shows: `/arena · battle state`. */
  note: string
  /** What to hold it against. */
  compare: string
  ticker: readonly ReactNode[]
  stat: ReactNode
  toolbar?: ReactNode
  /** The status row's left chips. */
  status: ReactNode
  children: ReactNode
}

/**
 * One reference layout in a 780 px frame: the page chrome of DESIGN_SYSTEM §4 around `children`.
 * A figure, named by its caption.
 */
function Frame({ route, note, compare, ticker, stat, toolbar, status, children }: FrameProps) {
  const caption = useId()
  return (
    <figure aria-labelledby={caption} className="flex flex-col gap-2">
      <figcaption id={caption} className="flex items-baseline gap-3 text-panel-status text-muted">
        <span className="text-accent-fg">{route}</span>
        <span className="normal-case">{note}</span>
        <span className="ml-auto normal-case">{compare}</span>
      </figcaption>
      <div className="relative isolate flex h-195 flex-col overflow-hidden rounded-md border border-border-strong bg-bg">
        <Ticker
          items={ticker}
          link={{ href: `#${route}`, label: 'open the story', onClick: stay }}
        />
        <Header
          brand={
            <>
              ASM BOTS <span className="text-muted">{`// ${route}`}</span>
            </>
          }
          stat={stat}
          nav={ROUTES.map(({ route: to, icon }) => (
            <NavButton key={to} href={`#${to}`} icon={icon} active={to === route} onClick={stay}>
              {to}
            </NavButton>
          ))}
          right={
            <>
              <IconButton icon={Palette} label="theme" shortcut="t" />
              <IconButton icon={Keyboard} label="keys" shortcut="?" />
            </>
          }
        />
        {toolbar}
        <div className="relative min-h-0 flex-1 overflow-hidden p-3">{children}</div>
        <StatusBar
          className="mb-2"
          left={status}
          center={<Chip>made with maestro</Chip>}
          right={
            <>
              <Chip>2026.09.23</Chip>
              <Chip>x16c v1</Chip>
              <Chip variant="accent">60 fps</Chip>
            </>
          }
        />
      </div>
    </figure>
  )
}

// ─── arena ──────────────────────────────────────────────────────────────────────────────────────

/** The arena in battle (PRODUCT_SPEC §2): the instrument at 8 of 12 columns, the rail at 4. */
export function ArenaLayout({ theme }: { theme: Theme }) {
  return (
    <Frame
      route="arena"
      note="/arena · battle state · 8-bot melee"
      compare="hold against docs/ref-atxsentinel-map.png"
      ticker={[
        <b key="lead">▍LIVE</b>,
        'HILL "MAIN"',
        'dwarf-v3 took #1',
        `${grouped(CYCLE)} cycles`,
      ]}
      stat={`8 bots · 41 procs · cycle ${grouped(CYCLE)}`}
      status={
        <>
          <Chip variant="accent">● live</Chip>
          <Chip>6 alive · 2 dead</Chip>
        </>
      }
    >
      <PanelGrid className="h-full grid-rows-[auto_minmax(0,1fr)_auto]">
        <Panel className="col-span-8 row-span-3" title="arena" status="round 1/3 · seed 0x1A2F">
          <div className="flex h-full flex-col gap-2">
            <ArenaMock
              theme={theme}
              label={`the core at cycle ${grouped(CYCLE)}`}
              className="min-h-0 flex-1 rounded-sm"
            >
              <div className="absolute top-2 left-2 flex gap-1">
                <Chip>
                  cycle {grouped(CYCLE)} / {grouped(MAX_CYCLES)}
                </Chip>
                <Chip>240/f</Chip>
              </div>
              {/* Controls over the arena sit on a panel: paper's dark text vanishes on black. */}
              <div className="absolute top-2 right-2 flex gap-1 rounded-md bg-panel p-1">
                <IconButton size="sm" icon={ZoomIn} label="zoom in" />
                <IconButton size="sm" icon={ZoomOut} label="zoom out" />
                <IconButton size="sm" icon={MapIcon} label="minimap" pressed />
                <IconButton size="sm" icon={Maximize} label="fullscreen" shortcut="f" />
                <IconButton size="sm" icon={Camera} label="screenshot" shortcut="s" />
              </div>
              <div className="absolute bottom-2 left-2">
                <Chip>zoom 1x</Chip>
              </div>
            </ArenaMock>
            <Transport />
          </div>
        </Panel>
        <Panel dense className="col-span-4" title="bots" status="8 · 2 dead">
          <BotsTable />
        </Panel>
        <Panel dense className="col-span-4" title="events" status="live">
          <Table
            aria-label="events"
            className="h-full"
            columns={EVENT_COLUMNS}
            rows={BATTLE_EVENTS}
            rowKey={(event) => `${event.cycle}:${event.text}`}
          />
        </Panel>
        <Panel dense className="col-span-4" title="standings" status="round 1/3">
          <Table
            aria-label="standings"
            columns={STANDING_COLUMNS}
            rows={STANDINGS}
            rowKey={(bot) => bot.name}
          />
        </Panel>
      </PanelGrid>
    </Frame>
  )
}

/** The transport under the arena (PRODUCT_SPEC §2): step back, play, step, speed, scrub, round. */
function Transport() {
  const deaths = BATTLE_BOTS.flatMap((bot) => (bot.died === null ? [] : [{ bot, at: bot.died }]))
  return (
    <div className="flex h-6 shrink-0 items-center gap-2">
      <IconButton icon={StepBack} label="step back" shortcut="," />
      <IconButton icon={Pause} label="pause" shortcut="space" pressed />
      <IconButton icon={StepForward} label="step" shortcut="." />
      <Slider
        aria-label="speed"
        className="w-44"
        min={1}
        max={10_000}
        scale="log"
        defaultValue={240}
        format={(n) => `${grouped(n)}/f`}
        showValue
      />
      {/* The scrub bar, with a mark in the bot's hue where each bot died. */}
      <div className="relative flex min-w-0 flex-1 items-center">
        <Slider
          aria-label="cycle"
          className="w-full"
          min={0}
          max={MAX_CYCLES}
          defaultValue={CYCLE}
          format={(n) => `cycle ${grouped(n)}`}
        />
        {deaths.map(({ bot, at }) => (
          <span
            key={bot.index}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-(--at) h-2.5 w-0.5 -translate-y-1/2 bg-(--hue)"
            style={vars({ '--at': `${(at / MAX_CYCLES) * 100}%`, '--hue': hueColor(bot.index) })}
          />
        ))}
      </div>
      <Chip>round 1/3</Chip>
    </div>
  )
}

/** The rail's bots table: hue, name, processes over time, bytes owned, alive or dead. */
function BotsTable() {
  const owned = useMemo(() => footprints(battle(), BATTLE_BOTS.length), [])
  const columns = useMemo<TableColumn<BattleBot>[]>(
    () => [
      {
        id: 'bot',
        header: 'bot',
        sortValue: (bot) => bot.name,
        cell: (bot) => (
          <span className="inline-flex items-center gap-2">
            <HueSwatch hue={bot.index} />
            <Identicon value={bot.name} size={16} hue={bot.index} />
            <span className={bot.died === null ? 'text-bright' : 'text-muted'}>{bot.name}</span>
          </span>
        ),
      },
      {
        id: 'procs',
        header: 'procs',
        align: 'right',
        className: 'w-24',
        sortValue: (bot) => bot.procs,
        cell: (bot) => (
          <span className="inline-flex items-center gap-2">
            <Sparkline values={bot.history} hue={bot.index} width={40} height={12} />
            <span className="w-5">{bot.procs}</span>
          </span>
        ),
      },
      {
        id: 'bytes',
        header: 'bytes',
        align: 'right',
        className: 'w-16',
        sortValue: (bot) => owned[bot.index] ?? 0,
        cell: (bot) => grouped(owned[bot.index] ?? 0),
      },
      {
        id: 'status',
        header: 'status',
        className: 'w-26',
        sortValue: (bot) => bot.died ?? Number.POSITIVE_INFINITY,
        cell: (bot) =>
          bot.died === null ? (
            <span className="text-accent-fg">alive</span>
          ) : (
            <span className="text-danger">dead @ {grouped(bot.died)}</span>
          ),
      },
    ],
    [owned],
  )
  return (
    <Table
      aria-label="bots"
      columns={columns}
      rows={BATTLE_BOTS}
      rowKey={(bot) => bot.name}
      defaultSort={{ column: 'bytes', direction: 'desc' }}
    />
  )
}

const EVENT_TONE: Readonly<Record<BattleEvent['kind'], string>> = {
  spawn: 'text-text',
  death: 'text-danger',
  blood: 'text-warn',
  round: 'text-muted',
}

const EVENT_COLUMNS: TableColumn<BattleEvent>[] = [
  {
    id: 'cycle',
    header: 'cycle',
    align: 'right',
    className: 'w-16',
    cell: (event) => <span className="text-muted">{grouped(event.cycle)}</span>,
  },
  {
    id: 'event',
    header: 'event',
    cell: (event) => (
      <span className={cx('inline-flex items-center gap-2', EVENT_TONE[event.kind])}>
        {event.bot === null ? <span className="size-2.5" /> : <HueSwatch hue={event.bot} />}
        {event.text}
      </span>
    ),
  },
]

const STANDINGS = [...BATTLE_BOTS].sort((a, b) => b.points - a.points).slice(0, 4)

const STANDING_COLUMNS: TableColumn<BattleBot>[] = [
  {
    id: 'rank',
    header: '#',
    align: 'right',
    className: 'w-6',
    cell: (bot) => <span className="text-muted">{STANDINGS.indexOf(bot) + 1}</span>,
  },
  {
    id: 'bot',
    header: 'bot',
    cell: (bot) => (
      <span className="inline-flex items-center gap-2">
        <HueSwatch hue={bot.index} />
        <span className="text-bright">{bot.name}</span>
      </span>
    ),
  },
  { id: 'points', header: 'points', align: 'right', className: 'w-16', cell: (bot) => bot.points },
]

// ─── hills ──────────────────────────────────────────────────────────────────────────────────────

/** A hill page (PRODUCT_SPEC §5) under the filter row that §4 sketches. */
export function HillLayout() {
  return (
    <Frame
      route="hills"
      note="/hills/main · loaded, under the filter row"
      compare="hold against DESIGN_SYSTEM §4, the toolbar row"
      ticker={[
        <b key="lead">HILL "MAIN"</b>,
        'paper-v2 climbed to #3',
        '32 entrants',
        'next championship in 2d 04:12',
      ]}
      stat='hill "main" · 32 entrants · king dwarf-v3'
      toolbar={
        <Toolbar aria-label="filters">
          <Input className="w-80" placeholder="search bots..." aria-label="search bots" />
          <Select aria-label="hill" className="w-36" defaultValue="all hills">
            <option>all hills</option>
            <option>main</option>
            <option>tiny</option>
            <option>melee</option>
          </Select>
          <Select aria-label="size" className="w-32" defaultValue="any size">
            <option>any size</option>
            <option>≤ 256 B</option>
            <option>≤ 512 B</option>
          </Select>
          <Select aria-label="visibility" className="w-28" defaultValue="public">
            <option>public</option>
            <option>mine</option>
          </Select>
          <Toggle>verified</Toggle>
          <Button variant="ghost">clear</Button>
          <Button variant="primary" icon={Upload} className="ml-auto">
            submit
          </Button>
        </Toolbar>
      }
      status={
        <>
          <Chip>hill · main</Chip>
          <Chip>10 rounds · 512 B</Chip>
        </>
      }
    >
      <PanelGrid className="h-full grid-rows-[auto_auto_minmax(0,1fr)_auto]">
        <Stat className="col-span-3" label="king" value="dwarf-v3" note="held 38 submissions">
          <Identicon value="dwarf-v3" size={32} hue={0} />
        </Stat>
        <Stat className="col-span-3" label="entrants" value="32" delta={3} note="this week" />
        <Stat
          className="col-span-3"
          label="top score"
          value="186.4"
          delta={4.2}
          note="vs last week"
        />
        <Stat
          className="col-span-3"
          label="your best"
          value="#7"
          delta={-2}
          invert
          note="vs last week"
        >
          <Sparkline values={YOUR_RANKS.map((rank) => -rank)} width={72} height={24} />
        </Stat>
        <Panel
          className="col-span-8 row-span-3"
          title="standings"
          status="32 entrants · 10 rounds · 512 B"
          actions={
            <Button size="sm" icon={Download}>
              export
            </Button>
          }
        >
          <Table
            aria-label="hill standings"
            className="h-full"
            columns={HILL_COLUMNS}
            rows={HILL}
            rowKey={(entrant) => entrant.name}
            defaultSort={{ column: 'score', direction: 'desc' }}
          />
        </Panel>
        <Panel className="col-span-4" title="king of the hill" status="38 submissions">
          <div className="flex items-center gap-3">
            <Identicon value="dwarf-v3" size={64} hue={0} aria-label="dwarf-v3" />
            <div className="flex min-w-0 flex-col">
              <span className="text-stat text-bright">dwarf-v3</span>
              <span className="text-data text-muted">@pedram · 142 B · dwarf</span>
              <span className="text-data">rating 1,842 ± 41 · 212/41/57</span>
            </div>
          </div>
          <Sparkline
            className="mt-3 w-full"
            values={KING_RATINGS}
            width={400}
            height={32}
            aria-label="the king's rating over 38 submissions"
          />
        </Panel>
        <Panel className="col-span-4" title="recent submissions" status="live">
          <ul className="flex flex-col">
            {SUBMISSIONS.map((submission) => (
              <li
                key={submission.name}
                className="flex h-6 items-center gap-2 border-b border-border text-data last:border-b-0"
              >
                <Identicon value={submission.name} size={16} hue={submission.hue} />
                <span className="text-bright">{submission.name}</span>
                <span className="text-muted">{submission.author}</span>
                <span className="ml-auto">
                  <Outcome submission={submission} />
                </span>
                <span className="w-7 text-right text-muted">{submission.ago}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="col-span-4" title="your bots" status="signed out">
          <EmptyState
            className="py-2"
            action={{ label: 'submit a bot', href: '#submit', onClick: stay }}
          >
            no bots on this hill yet.
          </EmptyState>
        </Panel>
      </PanelGrid>
    </Frame>
  )
}

/** A submission's result: the places it moved and the rank it took, or the score it fell short by. */
function Outcome({ submission }: { submission: Submission }) {
  const { rank, change, scored } = submission
  if (rank === null) {
    return <span className="text-danger">no place · {scored?.join(' / ')}</span>
  }
  if (change === 0) return <span>#{rank}</span>
  return (
    <span className={change > 0 ? 'text-accent-fg' : 'text-danger'}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change)} → #{rank}
    </span>
  )
}

const HILL_COLUMNS: TableColumn<Entrant>[] = [
  {
    id: 'rank',
    header: '#',
    align: 'right',
    className: 'w-8',
    cell: (entrant) => <span className="text-muted">{HILL.indexOf(entrant) + 1}</span>,
  },
  {
    id: 'bot',
    header: 'bot',
    sortValue: (entrant) => entrant.name,
    cell: (entrant) => (
      <span className="inline-flex items-center gap-2">
        <Identicon value={entrant.name} size={16} hue={entrant.hue} />
        <span className="text-bright">{entrant.name}</span>
        {HILL.indexOf(entrant) === 0 && <Chip variant="accent">king</Chip>}
      </span>
    ),
  },
  {
    id: 'author',
    header: 'author',
    className: 'w-24',
    sortValue: (entrant) => entrant.author,
    cell: (entrant) => <span className="text-muted">{entrant.author}</span>,
  },
  {
    id: 'score',
    header: 'score',
    align: 'right',
    className: 'w-18',
    sortValue: (entrant) => entrant.score,
    cell: (entrant) => entrant.score.toFixed(1),
  },
  {
    id: 'rating',
    header: 'rating',
    align: 'right',
    className: 'w-28',
    sortValue: (entrant) => entrant.rating,
    cell: (entrant) => (
      <>
        {grouped(entrant.rating)} <span className="text-muted">± {entrant.rd}</span>
      </>
    ),
  },
  {
    id: 'wtl',
    header: 'w/t/l',
    align: 'right',
    className: 'w-28',
    cell: (entrant) => `${entrant.wins}/${entrant.ties}/${entrant.losses}`,
  },
  {
    id: 'age',
    header: 'age',
    align: 'right',
    className: 'w-12',
    sortValue: (entrant) => entrant.age,
    cell: (entrant) => entrant.age,
  },
  {
    id: 'trend',
    header: 'trend',
    align: 'right',
    className: 'w-14',
    sortValue: (entrant) => entrant.trend,
    cell: ({ trend }) =>
      trend === 0 ? (
        <span className="text-muted">·</span>
      ) : (
        <span className={trend > 0 ? 'text-accent-fg' : 'text-danger'}>
          {trend > 0 ? '▲' : '▼'} {Math.abs(trend)}
        </span>
      ),
  },
  {
    id: 'challenge',
    header: '',
    align: 'right',
    className: 'w-24',
    cell: () => (
      <Button variant="ghost" size="sm">
        challenge
      </Button>
    ),
  },
]

// ─── tournaments ────────────────────────────────────────────────────────────────────────────────

/** Bar heights for the loading histograms, 0..1: the reference's peak hours and weekdays. */
const HOURS = [
  0.34, 0.5, 0.64, 0.8, 0.44, 0.6, 0.76, 0.42, 0.58, 0.74, 0.4, 0.54, 0.7, 0.46, 0.62, 0.86,
]
const DEATHS = [
  0.3, 0.44, 0.6, 0.72, 0.4, 0.5, 0.66, 0.36, 0.52, 0.68, 0.3, 0.46, 0.62, 0.4, 0.58, 0.8,
]
const ROUNDS = [0.26, 0.36, 0.5, 0.62, 0.4, 0.48, 0.6]

/** A tournament page while its data loads: skeletons in every panel, the radar over them. */
export function TournamentLayout() {
  return (
    <Frame
      route="tournaments"
      note="/tournaments/september · loading"
      compare="hold against docs/ref-atxsentinel-stats.png"
      ticker={[
        <b key="lead">CHAMPIONSHIP</b>,
        <b key="date">SEP 26</b>,
        'main hill',
        '16 entrants',
        'round robin · starts in 2d 04:12',
      ]}
      stat="3 running · 12 scheduled · 481 finished"
      status={
        <>
          <Chip variant="warn">loading</Chip>
          <Chip>6 sections</Chip>
        </>
      }
    >
      <PanelGrid>
        <Panel className="col-span-12" aria-label="september championship">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="truncate text-modal-title text-accent-fg">september championship</h3>
              <p className="text-data text-muted">bringing standings online</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Segmented
                label="round"
                options={['round 1', 'round 2', 'round 3', 'all']}
                defaultValue="all"
              />
              <Button icon={RefreshCw}>refresh</Button>
            </div>
          </div>
        </Panel>
        {['entrants', 'matches', 'rounds', 'leader'].map((label) => (
          <Stat key={label} className="col-span-3" label={label} loading />
        ))}
        <Panel className="col-span-6" title="standings" status="loading">
          <Skeleton rows={6} />
        </Panel>
        <Panel className="col-span-6" title="points · per round" status="loading">
          <Bars heights={HOURS} className="h-36" />
        </Panel>
        {['results matrix', 'top scorers', 'survival · cycles'].map((title) => (
          <Panel key={title} className="col-span-4" title={title} status="loading">
            <Skeleton rows={5} />
          </Panel>
        ))}
        <Panel className="col-span-6" title="deaths · by cycle" status="loading">
          <Bars heights={DEATHS} className="h-36" />
        </Panel>
        <Panel className="col-span-6" title="writes · by round" status="loading">
          <Bars heights={ROUNDS} className="h-36" />
        </Panel>
      </PanelGrid>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <RadarLoader framed label="loading tournament" detail="6 sections remaining" />
      </div>
    </Frame>
  )
}

/** A histogram still on its way: skeleton bars of the given heights, 0..1 of the box. */
function Bars({ heights, className }: { heights: readonly number[]; className?: string }) {
  return (
    <div aria-hidden="true" className={cx('flex items-end gap-1', className)}>
      {heights.map((height, bar) => (
        <Skeleton
          // A placeholder bar has no identity but its place.
          key={bar}
          className="h-(--bar) flex-1"
          style={vars({ '--bar': `${Math.round(height * 100)}%` })}
        />
      ))}
    </div>
  )
}
