/**
 * One match of a tournament (PRODUCT_SPEC §4): its entrants with their seeds and match points,
 * and a table of its rounds (the placement seed, who fought first, the survivors, each entrant's
 * points, the cycles run) with `watch` on each, which replays that round in the arena.
 */
import type { MatchResult, MatchRound } from '@asmbots/tourney'
import { Button, Chip, type ChipVariant, Panel, Table, type TableColumn } from '@asmbots/ui'
import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'

/** An entrant of the match, in the match's order. */
export interface MatchPanelEntrant {
  readonly name: string
  /** A bracket's seed. */
  readonly seed?: number | undefined
}

export interface MatchPanelProps {
  /** `semifinals · match 5`. */
  title: ReactNode
  /** The match's state: `done`, `live`, `pending`. */
  status: string
  entrants: readonly MatchPanelEntrant[]
  /** The match as played, whole or in part; null before it starts. */
  result: MatchResult | null
  /** The index in `entrants` of the winner, once there is one. */
  winner?: number | null | undefined
  /** What shows when there are no rounds: `a walkover: Dwarf goes through`. */
  note?: ReactNode
  onWatch: (round: MatchRound) => void
  className?: string | undefined
}

const STATUS_VARIANT: Readonly<Record<string, ChipVariant>> = {
  done: 'neutral',
  live: 'accent',
  ready: 'info',
  pending: 'info',
  walkover: 'warn',
  empty: 'warn',
}

const count = (n: number) => n.toLocaleString('en-US')

export function MatchPanel({
  title,
  status,
  entrants,
  result,
  winner = null,
  note,
  onWatch,
  className,
}: MatchPanelProps) {
  const name = (e: number) => entrants[e]?.name ?? `bot ${e + 1}`
  const columns: TableColumn<MatchRound>[] = [
    { id: 'round', header: 'round', cell: (r) => r.round + 1, align: 'right', className: 'w-12' },
    { id: 'seed', header: 'seed', cell: (r) => r.seed, align: 'right', className: 'w-24' },
    { id: 'first', header: 'first', cell: (r) => name(r.order[0] as number) },
    {
      id: 'survivors',
      header: 'survivors',
      cell: (r) =>
        r.survivors.length === 0 ? (
          <span className="text-muted">none</span>
        ) : (
          r.survivors.map(name).join(', ')
        ),
    },
    ...entrants.map(
      (entrant, e): TableColumn<MatchRound> => ({
        id: `points-${e}`,
        header: <span title={entrant.name}>{entrant.name}</span>,
        cell: (r) => r.points[e],
        align: 'right',
        className: 'w-20',
      }),
    ),
    {
      id: 'cycles',
      header: 'cycles',
      cell: (r) => count(r.durationCycles),
      align: 'right',
      className: 'w-20',
    },
    {
      id: 'watch',
      header: <span className="sr-only">watch</span>,
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          icon={Eye}
          aria-label={`watch round ${r.round + 1}`}
          onClick={() => onWatch(r)}
        >
          watch
        </Button>
      ),
      className: 'w-20',
    },
  ]
  const played = result?.rounds ?? []
  return (
    <Panel
      className={className}
      title={title}
      status={<Chip variant={STATUS_VARIANT[status] ?? 'neutral'}>{status}</Chip>}
      aria-label="match"
    >
      <div className="flex flex-col gap-3">
        <ul aria-label="entrants" className="flex flex-wrap gap-x-4 gap-y-1 text-data">
          {entrants.map((entrant, e) => (
            <li key={`${e}-${entrant.name}`} className="flex items-baseline gap-2">
              {entrant.seed !== undefined && (
                <span className="text-muted">seed {entrant.seed}</span>
              )}
              <span className={winner === e ? 'text-accent' : 'text-bright'}>{entrant.name}</span>
              {result !== null && (
                <span className="text-muted">
                  {result.points[e]} {result.points[e] === 1 ? 'point' : 'points'}
                </span>
              )}
            </li>
          ))}
        </ul>
        {played.length > 0 ? (
          <>
            {result !== null && played.length < result.of && (
              <p className="text-data text-muted">
                {played.length} of {result.of} rounds played
              </p>
            )}
            <Table
              aria-label="rounds"
              columns={columns}
              rows={played}
              rowKey={(r) => r.round}
              className="max-h-80"
            />
          </>
        ) : (
          <p className="text-data text-muted">{note ?? 'not played yet.'}</p>
        )}
      </div>
    </Panel>
  )
}
