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

/**
 * `/` (PRODUCT_SPEC §1): the hero over the live demo battle, then the main hill, the recent
 * matches, and the next championship. The demo arrives with the arena renderer (EXEC 2.3) and the
 * panels with the server; until then each holds its skeleton.
 */
export function HomePage() {
  return (
    <PanelGrid className="p-3">
      <Hero />
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

/** The demo battle's frame, the name, the one line, and the two ways in. */
function Hero() {
  return (
    <Panel className="col-span-12" title="live demo" status="4 bots · loading">
      {/* The page's own background until the arena renderer draws the demo (EXEC 2.3). */}
      <div className="relative h-72 overflow-hidden rounded-sm border border-border bg-bg">
        <div className="absolute inset-0 grid place-items-center">
          <RadarLoader label="loading the demo battle" />
        </div>
        <div className="absolute bottom-0 left-0 flex flex-col gap-2 p-4">
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
