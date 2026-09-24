/**
 * Finished matches (PRODUCT_SPEC §1, §5): who fought, who won, and the points. A row with a stored
 * replay opens it in the arena: a click on the row, or its `watch` link.
 */
import type { BotLabel, MatchSummary } from '@asmbots/protocol'
import { Skeleton, Table, type TableColumn } from '@asmbots/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { CELL_LINK } from './links'

const nameOf = (bot: BotLabel | null) => bot?.name ?? '[deleted]'

/** `Dwarf vs Imp`, or `8 bots` for a melee. */
export function matchTitle({ bots }: MatchSummary): string {
  return bots.length === 2
    ? `${nameOf(bots[0] ?? null)} vs ${nameOf(bots[1] ?? null)}`
    : `${bots.length} bots`
}

/** The entrant with the most points, or `draw` when the top is shared; null before it ends. */
export function matchWinner({ match, bots }: MatchSummary): string | null {
  const points = match.result?.points
  if (points === undefined || points.length === 0) return null
  const top = Math.max(...points)
  const at = points.flatMap((p, i) => (p === top ? [i] : []))
  return at.length === 1 ? nameOf(bots[at[0] as number] ?? null) : 'draw'
}

/** `7–3`; a melee shows the winner's points only. */
export function matchScore({ match }: MatchSummary): string {
  const points = match.result?.points ?? []
  return points.length === 2
    ? points.join('–')
    : points.length > 0
      ? String(Math.max(...points))
      : ''
}

const COLUMNS: TableColumn<MatchSummary>[] = [
  {
    id: 'match',
    header: 'match',
    cell: (m) => (
      <span className="text-bright" title={matchTitle(m)}>
        {matchTitle(m)}
      </span>
    ),
  },
  { id: 'winner', header: 'winner', cell: (m) => matchWinner(m) ?? '' },
  { id: 'points', header: 'points', cell: matchScore, align: 'right', className: 'w-16' },
  {
    id: 'watch',
    header: '',
    cell: (m) =>
      m.match.replayKey === null ? null : (
        <Link to="/arena/$replayId" params={{ replayId: m.match.replayKey }} className={CELL_LINK}>
          watch
        </Link>
      ),
    align: 'right',
    className: 'w-14',
  },
]

export interface MatchesTableProps {
  /** Undefined while they load. */
  matches: readonly MatchSummary[] | undefined
  rows?: number | undefined
  empty?: ReactNode
  'aria-label': string
  className?: string | undefined
}

export function MatchesTable({
  matches,
  rows = 10,
  empty = <p className="text-data text-muted">no match played yet.</p>,
  'aria-label': label,
  className,
}: MatchesTableProps) {
  const navigate = useNavigate()
  return (
    <Table
      aria-label={label}
      columns={COLUMNS}
      rows={matches ?? []}
      rowKey={(m) => m.match.id}
      className={className}
      empty={matches === undefined ? <Skeleton rows={rows} /> : empty}
      onRowClick={(m) => {
        const key = m.match.replayKey
        if (key !== null) void navigate({ to: '/arena/$replayId', params: { replayId: key } })
      }}
    />
  )
}
