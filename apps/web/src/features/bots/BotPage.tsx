import type { BotPlacement, BotVersion } from '@asmbots/protocol'
import {
  Chip,
  EmptyState,
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
import { IntroArt } from '../../app/IntroArt'
import { BOT_ABOUT } from '../../app/intros/bots'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { useLinkAction } from '../../app/link-action'
import { PageIntro } from '../../app/PageIntro'
import { Placeholder } from '../../app/Placeholder'
import { CELL_LINK, count, day, longAgo, UserLink } from '../hills/links'
import { BotActions } from './BotActions'

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
 * `/bots/$id` (PRODUCT_SPEC §6): the bot's card with `fork` and `challenge`, its fights and the
 * day it was first seen, where it stands on each hill, its versions, and the latest version's
 * source when the bot is public (or mine).
 */
export function BotPage({ id }: { id: string }) {
  const bot = useBot(id)
  const latest = bot.data?.versions[0] ?? null
  const source = useBotVersion(id, latest?.version ?? null)
  const link = useLinkAction()
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
          {bot.error === null ? <Skeleton rows={4} /> : <LoadFailure read={bot} />}
        </Panel>
      </PanelGrid>
    )
  }
  const { bot: record, owner, versions, placements, fights } = bot.data
  const text = source.data?.version.source
  return (
    <PanelGrid className="p-3">
      <PageIntro about={BOT_ABOUT} art={<IntroArt name="disk" />} />
      <Panel
        className="col-span-12 xl:col-span-4"
        title="bot"
        status={record.visibility}
        actions={<BotActions bot={record} source={text} />}
      >
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
            {/* The server's matches: its hill challenges and tournaments. */}
            <Stat label="fights" value={count(fights)} />
            <Stat
              label="first seen"
              value={day(record.createdAt)}
              note={longAgo(record.createdAt)}
            />
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
          empty={
            <EmptyState action={link('see the hills', '/hills')}>not on any hill yet.</EmptyState>
          }
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
          <pre
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll box the keyboard reads.
            tabIndex={0}
            className="max-h-96 overflow-auto text-code focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
          >
            {text}
          </pre>
        ) : source.isPending && latest !== null ? (
          <Skeleton rows={6} />
        ) : (
          <p className="text-data text-muted">its source is not public.</p>
        )}
      </Panel>
    </PanelGrid>
  )
}
