import type { BotPlacement, BotVersion } from '@asmbots/protocol'
import {
  Chip,
  Identicon,
  Panel,
  PanelGrid,
  Skeleton,
  Stat,
  Table,
  type TableColumn,
} from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { isNotFound } from '../../api/client'
import { useBot, useBotVersion } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { Placeholder } from '../../app/Placeholder'
import { CELL_LINK, count, day, UserLink } from '../hills/links'

const PLACEMENT_COLUMNS: TableColumn<BotPlacement>[] = [
  {
    id: 'hill',
    header: 'hill',
    cell: (p) => (
      <Link to="/hills/$slug" params={{ slug: p.hill.slug }} className={CELL_LINK}>
        {p.hill.name}
      </Link>
    ),
  },
  { id: 'version', header: 'version', cell: (p) => `v${p.version}`, className: 'w-20' },
  { id: 'rank', header: 'rank', cell: (p) => p.entry.rank, align: 'right', className: 'w-12' },
  {
    id: 'score',
    header: 'score',
    cell: (p) => count(p.entry.score),
    align: 'right',
    className: 'w-16',
  },
  {
    id: 'wtl',
    header: 'w/t/l',
    cell: (p) => `${p.entry.wins}/${p.entry.ties}/${p.entry.losses}`,
    align: 'right',
    className: 'w-20',
  },
]

const VERSION_COLUMNS: TableColumn<BotVersion>[] = [
  { id: 'version', header: 'version', cell: (v) => `v${v.version}`, className: 'w-20' },
  {
    id: 'size',
    header: 'size',
    cell: (v) => `${count(v.size)} B`,
    align: 'right',
    className: 'w-16',
  },
  {
    id: 'sha256',
    header: 'sha-256',
    cell: (v) => <span className="text-muted">{v.bytesSha256.slice(0, 16)}</span>,
  },
  {
    id: 'created',
    header: 'made',
    cell: (v) => day(v.createdAt),
    align: 'right',
    className: 'w-24',
  },
]

/**
 * `/bots/$id` (PRODUCT_SPEC §6): the bot's card, where it stands on each hill, its versions, and
 * the latest version's source when the bot is public.
 */
export function BotPage({ id }: { id: string }) {
  const bot = useBot(id)
  const latest = bot.data?.versions[0] ?? null
  const source = useBotVersion(id, latest?.version ?? null)
  if (isNotFound(bot.error)) {
    return (
      <Placeholder title="bots" status={id}>
        there is no bot {id}, or it is private.
      </Placeholder>
    )
  }
  if (bot.data === undefined) {
    return (
      <PanelGrid className="p-3">
        <Panel
          className="col-span-12"
          title="bot"
          status={readStatus(undefined, bot.error, () => '')}
        >
          {bot.error === null ? <Skeleton rows={4} /> : <LoadFailure error={bot.error} />}
        </Panel>
      </PanelGrid>
    )
  }
  const { bot: record, owner, versions, placements } = bot.data
  const text = source.data?.version.source
  return (
    <PanelGrid className="p-3">
      <Panel className="col-span-12 xl:col-span-4" title="bot" status={record.visibility}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Identicon value={latest?.bytesSha256 ?? record.id} size={40} />
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-modal-title text-bright">{record.name}</h1>
              <p className="text-data text-muted">
                by <UserLink handle={owner.handle} />
                {latest?.author ? ` · ${latest.author}` : ''}
              </p>
            </div>
          </div>
          {latest?.strategy && <p className="text-body">{latest.strategy}</p>}
          <div className="flex flex-wrap gap-4">
            <Stat label="size" value={latest ? `${count(latest.size)} B` : '–'} />
            <Stat label="versions" value={count(versions.length)} />
            <Stat label="isa" value={latest?.isa ?? '–'} />
          </div>
        </div>
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-8"
        title="hill placements"
        status={`${placements.length} hills`}
      >
        <Table
          aria-label="hill placements"
          columns={PLACEMENT_COLUMNS}
          rows={placements}
          rowKey={(p) => `${p.hill.slug}:${p.entry.botVersionId}`}
          empty={<p className="text-data text-muted">not on any hill.</p>}
        />
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="versions" status={`${versions.length}`}>
        <Table
          aria-label="versions"
          columns={VERSION_COLUMNS}
          rows={versions}
          rowKey={(v) => v.id}
        />
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-8"
        title="source"
        status={latest ? `v${latest.version}` : undefined}
        actions={record.visibility === 'public' ? <Chip>public</Chip> : undefined}
      >
        {text !== undefined ? (
          <pre className="max-h-96 overflow-auto text-code">{text}</pre>
        ) : source.isPending && latest !== null ? (
          <Skeleton rows={6} />
        ) : (
          <p className="text-data text-muted">its source is not public.</p>
        )}
      </Panel>
    </PanelGrid>
  )
}
