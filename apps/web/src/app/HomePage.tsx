import {
  Button,
  Panel,
  PanelGrid,
  RadarLoader,
  Skeleton,
  Stat,
  Table,
  type TableColumn,
} from '@asmbots/ui'
import { CodeXml, Grid2x2 } from 'lucide-react'
import { type ComponentType, lazy, Suspense, useEffect, useState } from 'react'
import type { HomeDemoProps } from '../features/arena/demo/HomeDemo'
import { NavLink } from './Frame'

/** The rows the hill and match panels hold (PRODUCT_SPEC §1): a top 10, and the last 10. */
const ROWS = 10

/** A column the panel draws before its data exists: the header only. */
function column(id: string, align?: 'right'): TableColumn<never> {
  return { id, header: id, cell: () => null, align }
}

const HILL_COLUMNS = [
  column('rank', 'right'),
  column('bot'),
  column('author'),
  column('score', 'right'),
  column('rating', 'right'),
  column('age', 'right'),
]

const MATCH_COLUMNS = [column('match'), column('winner'), column('cycles', 'right')]

/** The demo battle, and the arena with it, load after the page: the page does not wait for them. */
const HomeDemo = lazy(() =>
  import('../features/arena/demo/HomeDemo').then((module) => ({ default: module.HomeDemo })),
)

/** The longest the demo waits for the browser to be idle once the page has painted, ms. */
const IDLE_TIMEOUT = 2000

/** The paint timing entry of the page's first text or image. */
const FIRST_CONTENTFUL_PAINT = 'first-contentful-paint'

/**
 * Calls `then` once the page has painted content: at its first contentful paint, or where the
 * browser does not report paints, two display frames on. The load event comes too early to tell:
 * before the app's first render. Returns what cancels the call.
 */
function afterFirstPaint(then: () => void): () => void {
  const reports =
    typeof PerformanceObserver === 'function' &&
    PerformanceObserver.supportedEntryTypes?.includes('paint') === true
  if (!reports) {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(then)
    })
    return () => cancelAnimationFrame(id)
  }
  const observer = new PerformanceObserver((entries) => {
    if (entries.getEntriesByName(FIRST_CONTENTFUL_PAINT).length === 0) return
    observer.disconnect()
    then()
  })
  // Buffered: a paint before this call, as on a return to `/`, reports at once.
  observer.observe({ type: 'paint', buffered: true })
  return () => observer.disconnect()
}

/**
 * Whether the page has painted and the browser has since been idle. The demo waits for it, so
 * its arena and its Worker take no bandwidth or main-thread time from the page's first paint.
 */
function usePaintedAndIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let cancel = () => {}
    const whenIdle = () => {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(() => setIdle(true), { timeout: IDLE_TIMEOUT })
        cancel = () => cancelIdleCallback(id)
      } else {
        // Safari has no idle callback: the next task.
        const id = setTimeout(() => setIdle(true), 0)
        cancel = () => clearTimeout(id)
      }
    }
    cancel = afterFirstPaint(whenIdle)
    return () => cancel()
  }, [])
  return idle
}

export interface HomePageProps {
  /** The hero's battle. Default: the arena's demo (`features/arena/demo`). */
  demo?: ComponentType<HomeDemoProps> | undefined
}

/**
 * `/` (PRODUCT_SPEC §1): the hero over the live demo battle, then the main hill, the recent
 * matches, and the next championship. The panels arrive with the server; until then each holds
 * its skeleton.
 */
export function HomePage({ demo = HomeDemo }: HomePageProps) {
  return (
    <PanelGrid className="p-3">
      <Hero demo={demo} />
      <Panel className="col-span-12 xl:col-span-6" title="main hill" status="loading">
        <Table
          aria-label="main hill, top 10"
          columns={HILL_COLUMNS}
          rows={[]}
          rowKey={() => 0}
          empty={<Skeleton rows={ROWS} />}
        />
      </Panel>
      <Panel
        className="col-span-12 md:col-span-6 xl:col-span-3"
        title="recent matches"
        status="loading"
      >
        <Table
          aria-label="recent matches"
          columns={MATCH_COLUMNS}
          rows={[]}
          rowKey={() => 0}
          empty={<Skeleton rows={ROWS} />}
        />
      </Panel>
      <Panel
        className="col-span-12 md:col-span-6 xl:col-span-3"
        title="championship"
        status="loading"
      >
        <div className="flex flex-1 flex-col gap-4">
          <Stat label="next event" loading />
          <Stat label="entrants so far" loading />
          <Button variant="primary" className="mt-auto self-start" disabled>
            enter
          </Button>
        </div>
      </Panel>
    </PanelGrid>
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
