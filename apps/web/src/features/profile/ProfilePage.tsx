import type { Bot } from '@asmbots/protocol'
import { Panel, PanelGrid, Skeleton, Table, type TableColumn } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { isNotFound } from '../../api/client'
import { useUser } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { Placeholder } from '../../app/Placeholder'
import { CELL_LINK, day } from '../hills/links'

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

/** `/u/$handle` (PRODUCT_SPEC §6): who they are, since when, and their public bots. */
export function ProfilePage({ handle }: { handle: string }) {
  const { data, error } = useUser(handle)
  if (isNotFound(error)) {
    return (
      <Placeholder title="profile" status={handle}>
        there is no user {handle}.
      </Placeholder>
    )
  }
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
        status={readStatus(data, error, (d) => `${d.bots.length} public`)}
      >
        <Table
          aria-label="bots"
          columns={COLUMNS}
          rows={data?.bots ?? []}
          rowKey={(b) => b.id}
          empty={
            data === undefined ? (
              <Skeleton rows={4} />
            ) : (
              <p className="text-data text-muted">no public bots yet.</p>
            )
          }
        />
      </Panel>
    </PanelGrid>
  )
}
