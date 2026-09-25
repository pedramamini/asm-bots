/**
 * A standings table (PRODUCT_SPEC §4): rank, bot, W/T/L, and points, each column sortable from its
 * header; a round robin's or a melee's, with the melee's own columns after them. The rank is the
 * place in the standings as scored, so it stays with the bot however the table is sorted.
 */
import type { CsvStanding } from '@asmbots/tourney'
import { Table, type TableColumn } from '@asmbots/ui'
import { useMemo } from 'react'

export interface StandingsTableProps<Row extends CsvStanding> {
  /** The standings as scored: the first is the leader. */
  rows: readonly Row[]
  /** Columns after the points: a melee's survival. */
  extra?: readonly TableColumn<Row>[] | undefined
  /** The row of the champion, once there is one: its name takes the accent. */
  champion?: number | null | undefined
  className?: string | undefined
}

const count = (n: number) => n.toLocaleString('en-US')

const NONE: readonly never[] = []

export function StandingsTable<Row extends CsvStanding>({
  rows,
  extra = NONE,
  champion = null,
  className,
}: StandingsTableProps<Row>) {
  const columns = useMemo((): TableColumn<Row>[] => {
    const rank = new Map(rows.map((s, i) => [s.entrant, i + 1]))
    const numeric = (id: 'wins' | 'ties' | 'losses' | 'points', header: string) =>
      ({
        id,
        header,
        cell: (s: Row) => count(s[id]),
        align: 'right',
        sortValue: (s: Row) => s[id],
        className: 'w-16',
      }) satisfies TableColumn<Row>
    return [
      {
        id: 'rank',
        header: '#',
        cell: (s) => rank.get(s.entrant),
        align: 'right',
        sortValue: (s) => rank.get(s.entrant) ?? 0,
        sortFirst: 'asc',
        className: 'w-10',
      },
      {
        id: 'bot',
        header: 'bot',
        cell: (s) => (
          <span className={s.entrant === champion ? 'text-accent-fg' : 'text-bright'}>
            {s.name}
          </span>
        ),
        sortValue: (s) => s.name,
      },
      numeric('wins', 'w'),
      numeric('ties', 't'),
      numeric('losses', 'l'),
      numeric('points', 'points'),
      ...extra,
    ]
  }, [rows, extra, champion])
  return (
    <Table
      aria-label="standings"
      columns={columns}
      rows={rows}
      rowKey={(s) => s.entrant}
      className={className}
      empty={<p className="text-data text-muted">no match played yet.</p>}
    />
  )
}
