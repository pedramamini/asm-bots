/**
 * Finished matches (PRODUCT_SPEC §1, §5): who fought, who won, and the points. A row with a stored
 * replay opens it in the arena: a click on the row, or its `watch` link. Its `verify` runs it here
 * and checks it against the server's result (`VerifyMatch`).
 */
import type { BotLabel, MatchSummary } from '@asmbots/protocol'
import { EmptyState, Skeleton, Table, type TableColumn } from '@asmbots/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useLinkAction } from '../../app/link-action'
import { VerifyMatch } from '../verify/VerifyMatch'
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

/** Whether `verify` can run a match: it has finished, and its inputs are stored (its replay). */
export function verifiable({ match }: MatchSummary): boolean {
  return match.result !== null && match.replayKey !== null
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

/** The columns; `compact`, a narrow panel's: `verify` as an icon. */
const columns = (compact: boolean): TableColumn<MatchSummary>[] => [
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
    id: 'verify',
    header: '',
    cell: (m) =>
      verifiable(m) ? (
        <VerifyMatch id={m.match.id} label={matchTitle(m)} compact={compact} />
      ) : null,
    align: 'right',
    className: compact ? 'w-8' : 'w-24',
  },
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

const WIDE = columns(false)
const COMPACT = columns(true)

export interface MatchesTableProps {
  /** Undefined while they load. */
  matches: readonly MatchSummary[] | undefined
  /** A narrow panel's table: `verify` as an icon. */
  compact?: boolean | undefined
  rows?: number | undefined
  /** What shows when there are none: by default, the arena's way to fight one. */
  empty?: ReactNode
  'aria-label': string
  className?: string | undefined
}

export function MatchesTable({
  matches,
  compact = false,
  rows = 10,
  empty,
  'aria-label': label,
  className,
}: MatchesTableProps) {
  const navigate = useNavigate()
  const link = useLinkAction()
  return (
    <Table
      aria-label={label}
      columns={compact ? COMPACT : WIDE}
      rows={matches ?? []}
      rowKey={(m) => m.match.id}
      className={className}
      empty={
        matches === undefined ? (
          <Skeleton rows={rows} />
        ) : (
          (empty ?? (
            <EmptyState action={link('fight one in the arena', '/arena')}>
              no matches played yet.
            </EmptyState>
          ))
        )
      }
      onRowClick={(m) => {
        const key = m.match.replayKey
        if (key !== null) void navigate({ to: '/arena/$replayId', params: { replayId: key } })
      }}
    />
  )
}
