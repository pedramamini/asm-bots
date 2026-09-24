import type { Tournament } from '@asmbots/protocol'
import { Button, Panel, PanelGrid, RadarLoader, Stat } from '@asmbots/ui'
import { CodeXml, Grid2x2 } from 'lucide-react'
import { type ComponentType, lazy, Suspense, useState } from 'react'
import { useHill, useHillMatches, useTournament, useTournaments } from '../api/queries'
import type { HomeDemoProps } from '../features/arena/demo/HomeDemo'
import { HillStandingsTable } from '../features/hills/HillStandingsTable'
import { count, day } from '../features/hills/links'
import { MatchesTable } from '../features/hills/MatchesTable'
import { NavLink } from './Frame'
import { LoadFailure, readStatus } from './LoadFailure'
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
 * `/` (PRODUCT_SPEC §1): the hero over the live demo battle, then the main hill's top 10, its
 * recent matches, and the next championship, read from the API; until each read lands its panel
 * holds a skeleton. Entering a championship waits for sign-in (EXEC 3.2) and the Runner (3.3).
 */
export function HomePage({ demo = HomeDemo }: HomePageProps) {
  return (
    <PanelGrid className="p-3">
      <Hero demo={demo} />
      <MainHill />
      <RecentMatches />
      <Championship />
    </PanelGrid>
  )
}

function MainHill() {
  const { data, error } = useHill(MAIN_HILL)
  return (
    <Panel
      className="col-span-12 xl:col-span-6"
      title="main hill"
      status={readStatus(data, error, (d) => `${d.standings.length} of ${d.hill.size}`)}
    >
      {error !== null && data === undefined ? (
        <LoadFailure error={error} />
      ) : (
        <HillStandingsTable
          aria-label="main hill, top 10"
          compact
          rows={ROWS}
          standings={data?.standings.slice(0, ROWS)}
        />
      )}
    </Panel>
  )
}

function RecentMatches() {
  const { data, error } = useHillMatches(MAIN_HILL, { limit: ROWS })
  return (
    <Panel
      className="col-span-12 md:col-span-6 xl:col-span-3"
      title="recent matches"
      status={readStatus(data, error, () => MAIN_HILL)}
    >
      {error !== null && data === undefined ? (
        <LoadFailure error={error} />
      ) : (
        <MatchesTable aria-label="recent matches" rows={ROWS} matches={data?.matches} />
      )}
    </Panel>
  )
}

/** The championship to show: the one running, else the next scheduled; null when neither. */
export function nextChampionship(tournaments: readonly Tournament[]): Tournament | null {
  const running = tournaments.find((t) => t.status === 'running')
  if (running !== undefined) return running
  const scheduled = tournaments
    .filter((t) => t.status === 'scheduled')
    .sort((a, b) => (a.startsAt ?? '\uffff').localeCompare(b.startsAt ?? '\uffff'))
  return scheduled[0] ?? null
}

function Championship() {
  const list = useTournaments()
  const next = list.data === undefined ? undefined : nextChampionship(list.data.tournaments)
  const detail = useTournament(next?.id ?? null)
  const loading = list.data === undefined && list.error === null
  return (
    <Panel
      className="col-span-12 md:col-span-6 xl:col-span-3"
      title="championship"
      status={readStatus(list.data, list.error, () => next?.status ?? 'none')}
    >
      {list.error !== null && list.data === undefined ? (
        <LoadFailure error={list.error} />
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <Stat
            label="next event"
            loading={loading}
            value={next === undefined ? undefined : next === null ? 'none scheduled' : next.name}
            note={next?.startsAt ? day(next.startsAt) : undefined}
          />
          <Stat
            label="entrants so far"
            loading={loading || (next != null && detail.data === undefined)}
            value={
              next === null ? '–' : detail.data ? count(detail.data.entrants.length) : undefined
            }
          />
          <Button variant="primary" className="mt-auto self-start" disabled>
            enter
          </Button>
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
  const idle = usePaintedAndIdle()
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
          <h1 className="text-modal-title text-bright">ASM BOTS</h1>
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
