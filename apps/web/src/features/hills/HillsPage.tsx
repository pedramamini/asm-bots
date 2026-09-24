import type { HillSummary } from '@asmbots/protocol'
import { Panel, PanelGrid, Skeleton, Table, type TableColumn } from '@asmbots/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useHills } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { BotLink, CELL_LINK, count, rules } from './links'

const COLUMNS: TableColumn<HillSummary>[] = [
  {
    id: 'hill',
    header: 'hill',
    cell: ({ hill }) => (
      <Link to="/hills/$slug" params={{ slug: hill.slug }} className={CELL_LINK}>
        {hill.name}
      </Link>
    ),
    sortValue: ({ hill }) => hill.name,
    className: 'w-28',
  },
  {
    id: 'rules',
    header: 'rules',
    cell: ({ hill }) => <span className="text-muted">{rules(hill.rounds, hill.config)}</span>,
  },
  {
    id: 'entrants',
    header: 'entrants',
    cell: ({ hill, entrants }) => `${count(entrants)} / ${count(hill.size)}`,
    align: 'right',
    sortValue: ({ entrants }) => entrants,
    className: 'w-24',
  },
  {
    id: 'king',
    header: 'king',
    cell: ({ king }) =>
      king === null ? <span className="text-muted">none</span> : <BotLink bot={king.bot} />,
    sortValue: ({ king }) => king?.bot.name ?? '',
  },
  {
    id: 'score',
    header: 'score',
    cell: ({ king }) => (king === null ? '' : count(king.entry.score)),
    align: 'right',
    className: 'w-16',
  },
]

/** `/hills` (PRODUCT_SPEC §5): each hill, its rules, how full it is, and its king. */
export function HillsPage() {
  const { data, error } = useHills()
  const navigate = useNavigate()
  return (
    <PanelGrid className="p-3">
      <Panel
        className="col-span-12"
        title="hills"
        status={readStatus(data, error, (d) => `${d.hills.length} hills`)}
      >
        {error !== null && data === undefined ? (
          <LoadFailure error={error} />
        ) : (
          <Table
            aria-label="hills"
            columns={COLUMNS}
            rows={data?.hills ?? []}
            rowKey={({ hill }) => hill.id}
            empty={
              data === undefined ? (
                <Skeleton rows={3} />
              ) : (
                <p className="text-data text-muted">no hill is open yet.</p>
              )
            }
            onRowClick={({ hill }) =>
              void navigate({ to: '/hills/$slug', params: { slug: hill.slug } })
            }
          />
        )}
      </Panel>
    </PanelGrid>
  )
}
