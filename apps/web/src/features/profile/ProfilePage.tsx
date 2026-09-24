import type { Bot, ChampionshipResult, HillBest } from '@asmbots/protocol'
import { Panel, PanelGrid, Skeleton, Table, type TableColumn } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { isNotFound } from '../../api/client'
import { useUser } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { Placeholder } from '../../app/Placeholder'
import { BotLink, CELL_LINK, count, day } from '../hills/links'

const COLUMNS: TableColumn<Bot>[] = [
  {
    id: 'bot',
    header: 'bot',
    cell: (b) => (
      <Link to="/bots/$id" params={{ id: b.id }} className={CELL_LINK}>
        {b.name}
      </Link>
    ),
    sortValue: (b) => b.name,
  },
  { id: 'visibility', header: 'shown to', cell: (b) => b.visibility, className: 'w-24' },
  {
    id: 'updated',
    header: 'updated',
    cell: (b) => day(b.updatedAt),
    align: 'right',
    sortValue: (b) => b.updatedAt,
    className: 'w-24',
  },
]

const HILL_COLUMNS: TableColumn<HillBest>[] = [
  {
    id: 'hill',
    header: 'hill',
    cell: (h) => (
      <Link to="/hills/$slug" params={{ slug: h.hill.slug }} className={CELL_LINK}>
        {h.hill.name}
      </Link>
    ),
  },
  { id: 'rank', header: 'rank', cell: (h) => h.entry.rank, align: 'right', className: 'w-14' },
  { id: 'bot', header: 'bot', cell: (h) => <BotLink bot={h.bot} /> },
  {
    id: 'rating',
    header: 'rating',
    cell: (h) => count(Math.round(h.entry.rating)),
    align: 'right',
    className: 'w-20',
  },
]

const CHAMPIONSHIP_COLUMNS: TableColumn<ChampionshipResult>[] = [
  {
    id: 'championship',
    header: 'championship',
    cell: (r) => (
      <Link to="/tournaments/$id" params={{ id: r.tournament.id }} className={CELL_LINK}>
        {r.tournament.name}
      </Link>
    ),
  },
  { id: 'bot', header: 'bot', cell: (r) => <BotLink bot={r.bot} /> },
  {
    id: 'record',
    header: 'w/t/l',
    cell: (r) => `${r.wins}/${r.ties}/${r.losses}`,
    align: 'right',
    className: 'w-20',
  },
  {
    id: 'result',
    header: 'result',
    cell: (r) => (r.champion ? 'champion' : ''),
    className: 'w-24',
  },
]

/**
 * `/u/$handle` (PRODUCT_SPEC §6): who they are, since when, their bots (the public ones, or all of
 * them for the user themself), their best place on each hill, and their championship results.
 */
export function ProfilePage({ handle }: { handle: string }) {
  const { data, error } = useUser(handle)
  if (isNotFound(error)) {
    return (
      <Placeholder title="profile" status={handle}>
        there is no user {handle}.
      </Placeholder>
    )
  }
  const loading = data === undefined ? <Skeleton rows={3} /> : null
  return (
    <PanelGrid className="p-3">
      <Panel
        className="col-span-12 xl:col-span-4"
        title="profile"
        status={readStatus(data, error, (d) => `joined ${day(d.user.createdAt)}`)}
      >
        {data !== undefined ? (
          <div className="flex items-center gap-3">
            {data.user.avatarUrl !== null && (
              <img src={data.user.avatarUrl} alt="" className="size-10 rounded-sm" />
            )}
            <h1 className="text-modal-title text-bright">{data.user.handle}</h1>
          </div>
        ) : error !== null ? (
          <LoadFailure error={error} />
        ) : (
          <Skeleton rows={2} />
        )}
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-8"
        title="bots"
        status={readStatus(
          data,
          error,
          (d) => `${d.bots.length} ${d.bots.length === 1 ? 'bot' : 'bots'}`,
        )}
      >
        <Table
          aria-label="bots"
          columns={COLUMNS}
          rows={data?.bots ?? []}
          rowKey={(b) => b.id}
          empty={loading ?? <p className="text-data text-muted">no public bots yet.</p>}
        />
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-6"
        title="hills"
        status={readStatus(data, error, (d) => `best of ${d.hills.length}`)}
      >
        <Table
          aria-label="best hill ranks"
          columns={HILL_COLUMNS}
          rows={data?.hills ?? []}
          rowKey={(h) => h.hill.slug}
          empty={loading ?? <p className="text-data text-muted">on no hill yet.</p>}
        />
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-6"
        title="championships"
        status={readStatus(data, error, (d) => `${d.championships.length} entered`)}
      >
        <Table
          aria-label="championship results"
          columns={CHAMPIONSHIP_COLUMNS}
          rows={data?.championships ?? []}
          rowKey={(r) => `${r.tournament.id}:${r.bot.versionId}`}
          empty={loading ?? <p className="text-data text-muted">no championships yet.</p>}
        />
      </Panel>
    </PanelGrid>
  )
}
