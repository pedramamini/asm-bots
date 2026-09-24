/**
 * A hill's standings (PRODUCT_SPEC §5): rank, bot, author, score, rating ± RD, W/T/L, age, and
 * an action per row (the hill page's `challenge`). The home page's top 10 leaves W/T/L and the RD
 * out. The king's name takes the accent.
 */
import type { HillStanding } from '@asmbots/protocol'
import { Skeleton, Table, type TableColumn } from '@asmbots/ui'
import type { ReactNode } from 'react'
import { authorOf, BotLink, count } from './links'

const number = (
  id: string,
  header: string,
  value: (s: HillStanding) => number,
  show: (n: number) => string = count,
): TableColumn<HillStanding> => ({
  id,
  header,
  cell: (s) => show(value(s)),
  align: 'right',
  sortValue: value,
  className: 'w-16',
})

const RANK: TableColumn<HillStanding> = {
  id: 'rank',
  header: 'rank',
  cell: (s) => s.entry.rank,
  align: 'right',
  sortValue: (s) => s.entry.rank,
  sortFirst: 'asc',
  className: 'w-12',
}

const BOT: TableColumn<HillStanding> = {
  id: 'bot',
  header: 'bot',
  cell: (s) =>
    s.entry.rank === 1 ? (
      <span className="text-accent">
        <BotLink bot={s.bot} />
      </span>
    ) : (
      <BotLink bot={s.bot} />
    ),
  sortValue: (s) => s.bot.name,
}

const AUTHOR: TableColumn<HillStanding> = {
  id: 'author',
  header: 'author',
  cell: (s) => <span className="text-muted">{authorOf(s.bot)}</span>,
  sortValue: (s) => authorOf(s.bot),
}

const SCORE = number('score', 'score', (s) => s.entry.score)
const RATING = number(
  'rating',
  'rating',
  (s) => s.entry.rating,
  (n) => count(Math.round(n)),
)
/** `1,523 ± 87`: the rating and its deviation, once a submission has rated the entry. */
export function ratingText(s: HillStanding): string {
  const rating = count(Math.round(s.entry.rating))
  return s.rd === null ? rating : `${rating} ± ${count(Math.round(s.rd))}`
}
const RATING_RD: TableColumn<HillStanding> = {
  ...RATING,
  cell: ratingText,
  className: 'w-28 whitespace-nowrap',
}
const AGE = number('age', 'age', (s) => s.entry.age)

const FULL = [
  RANK,
  BOT,
  AUTHOR,
  SCORE,
  RATING_RD,
  number('wins', 'w', (s) => s.entry.wins),
  number('ties', 't', (s) => s.entry.ties),
  number('losses', 'l', (s) => s.entry.losses),
  AGE,
]
const COMPACT = [RANK, BOT, AUTHOR, SCORE, RATING, AGE]

export interface HillStandingsTableProps {
  /** Undefined while they load. */
  standings: readonly HillStanding[] | undefined
  /** The home page's panel: no W/T/L, no RD. */
  compact?: boolean | undefined
  /** A last column: what a row offers (the hill page's `challenge`). */
  action?: ((standing: HillStanding) => ReactNode) | undefined
  /** Skeleton rows while loading. */
  rows?: number | undefined
  /** What shows when the hill has no entries. */
  empty?: ReactNode
  'aria-label': string
  className?: string | undefined
}

export function HillStandingsTable({
  standings,
  compact = false,
  action,
  rows = 10,
  empty = <p className="text-data text-muted">nobody holds this hill yet.</p>,
  'aria-label': label,
  className,
}: HillStandingsTableProps) {
  return (
    <Table
      aria-label={label}
      columns={
        action === undefined
          ? compact
            ? COMPACT
            : FULL
          : [
              ...(compact ? COMPACT : FULL),
              { id: 'action', header: '', cell: action, align: 'right', className: 'w-32' },
            ]
      }
      rows={standings ?? []}
      rowKey={(s) => s.entry.botVersionId}
      className={className}
      empty={standings === undefined ? <Skeleton rows={rows} /> : empty}
    />
  )
}
