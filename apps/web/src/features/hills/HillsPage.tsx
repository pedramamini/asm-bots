import type { HillBest, HillSummary } from '@asmbots/protocol'
import { EmptyState, Panel, PanelGrid, Skeleton, Table, type TableColumn } from '@asmbots/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useHills, useMaybeUser, useMe } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { useLinkAction } from '../../app/link-action'
import { PageIntro } from '../../app/PageIntro'
import { HILLS_ABOUT } from '../../app/page-intros'
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

/** The column of the reader's best place on each hill: rank and bot, or `–`. */
function bestColumn(best: ReadonlyMap<string, HillBest> | null): TableColumn<HillSummary> {
  return {
    id: 'best',
    header: 'your best',
    cell: ({ hill }) => {
      if (best === null) return ''
      const place = best.get(hill.slug)
      return place === undefined ? (
        <span className="text-muted">–</span>
      ) : (
        <span>
          #{place.entry.rank} <BotLink bot={place.bot} />
        </span>
      )
    },
    sortValue: ({ hill }) => best?.get(hill.slug)?.entry.rank ?? Number.POSITIVE_INFINITY,
  }
}

/**
 * `/hills` (PRODUCT_SPEC §5): each hill, its rules, how full it is, its king, and, signed in, the
 * reader's best place there.
 */
export function HillsPage() {
  const read = useHills()
  const { data, error } = read
  const link = useLinkAction()
  const handle = useMe().data?.user.handle ?? null
  const profile = useMaybeUser(handle)
  const best = profile.data ? new Map(profile.data.hills.map((b) => [b.hill.slug, b])) : null
  const navigate = useNavigate()
  return (
    <PanelGrid className="p-3">
      <PageIntro about={HILLS_ABOUT} />
      <Panel
        className="col-span-12"
        title="hills"
        status={readStatus(data, error, (d) => `${d.hills.length} hills`)}
      >
        {error !== null && data === undefined ? (
          <LoadFailure read={read} />
        ) : (
          <Table
            aria-label="hills"
            columns={handle === null ? COLUMNS : [...COLUMNS, bestColumn(best)]}
            rows={data?.hills ?? []}
            rowKey={({ hill }) => hill.id}
            empty={
              data === undefined ? (
                <Skeleton rows={3} />
              ) : (
                <EmptyState action={link('see how hills work', '/docs/tournaments/hills')}>
                  no hill is open yet.
                </EmptyState>
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
