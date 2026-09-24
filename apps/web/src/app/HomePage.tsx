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
import { type ComponentType, lazy, Suspense, useState } from 'react'
import type { HomeDemoProps } from '../features/arena/demo/HomeDemo'
import { NavLink } from './Frame'
import { usePaintedAndIdle } from './paint'

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
