/**
 * A round robin's results matrix (PRODUCT_SPEC §4): the entrants down and across, each cell the
 * row bot's points against the column bot. A win takes the accent, deeper the wider the margin; a
 * tie stays plain; a loss dims. The diagonal is blank, and so is a match not played yet, but the
 * one in flight pulses. A played cell's tooltip breaks the match down by round; a click selects
 * the match, as the cell across the diagonal does.
 */
import { type MatchResult, roundRobinSchedule } from '@asmbots/tourney'
import { cx, Tooltip } from '@asmbots/ui'
import { useMemo } from 'react'
import { useMotionReduced } from '../../store/settings'
import type { Tournament } from './store'

/** One cell: the row entrant's side of a played match. */
export interface MatrixCell {
  /** The match's place in the schedule, and in `Tournament.matches`. */
  readonly match: number
  /** The row entrant's place in the match: 0 or 1. */
  readonly side: number
  /** The row entrant's match points, and the column entrant's. */
  readonly points: number
  readonly against: number
  readonly result: MatchResult
}

/**
 * The matrix of `t`: `cells[row][col]` for each pair that has played, null on the diagonal and
 * for the rest. `live`: the match in flight while `t` runs, its place in the schedule.
 */
export function resultsMatrix(t: Tournament): {
  cells: (MatrixCell | null)[][]
  live: number | null
} {
  const n = t.entrants.length
  const cells: (MatrixCell | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null))
  if (n < 2) return { cells, live: null }
  const schedule = roundRobinSchedule(n)
  t.matches.forEach((result, match) => {
    const [a, b] = schedule[match]?.entrants ?? []
    if (a === undefined || b === undefined) return
    const [pa, pb] = result.points as [number, number]
    ;(cells[a] as (MatrixCell | null)[])[b] = { match, side: 0, points: pa, against: pb, result }
    ;(cells[b] as (MatrixCell | null)[])[a] = { match, side: 1, points: pb, against: pa, result }
  })
  const next = t.matches.length
  return { cells, live: t.status === 'running' && next < schedule.length ? next : null }
}

/** The fill of a played cell: the accent by the margin of a win, none for a tie, dim for a loss. */
export function cellTone(cell: MatrixCell): string {
  const { points, against } = cell
  if (points < against) return 'text-dim'
  if (points === against) return 'text-text'
  const share = points / (points + against)
  const fill = share >= 0.85 ? 'bg-accent-45' : share >= 0.67 ? 'bg-accent-25' : 'bg-accent-10'
  return cx(fill, 'text-bright')
}

/** `2 – 1, 0 – 0, 3 – 0`: the row entrant's round points, then the column entrant's. */
function breakdown(cell: MatrixCell): string {
  const other = 1 - cell.side
  return cell.result.rounds.map((r) => `${r.points[cell.side]} – ${r.points[other]}`).join(', ')
}

export interface ResultsMatrixProps {
  tournament: Tournament
  /** The match chosen: its place in the schedule, or null. */
  selected: number | null
  onSelect: (match: number) => void
}

const CELL = 'h-6 w-9 min-w-9 p-0 text-center tabular-nums'

export function ResultsMatrix({ tournament: t, selected, onSelect }: ResultsMatrixProps) {
  const reduced = useMotionReduced()
  const { cells, live } = useMemo(() => resultsMatrix(t), [t])
  const schedule = useMemo(
    () => (t.entrants.length < 2 ? [] : roundRobinSchedule(t.entrants.length)),
    [t.entrants.length],
  )
  const liveSpec = live === null ? undefined : schedule[live]
  const isLive = (row: number, col: number) =>
    (liveSpec?.entrants.includes(row) && liveSpec.entrants.includes(col)) ?? false
  const names = t.entrants.map((e) => e.name)

  return (
    <div className="overflow-auto">
      <table aria-label="results matrix" className="border-separate border-spacing-0.5 text-data">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">bot</span>
            </th>
            {names.map((name, col) => (
              <th
                key={`${col}-${name}`}
                scope="col"
                title={name}
                className={cx(CELL, 'font-normal text-muted')}
              >
                <abbr title={name} className="no-underline">
                  {col + 1}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, r) => (
            <tr key={`${r}-${names[r]}`}>
              <th
                scope="row"
                className="max-w-40 truncate pr-2 text-left font-normal whitespace-nowrap"
              >
                <span className="text-muted">{r + 1}</span> {names[r]}
              </th>
              {row.map((cell, c) => {
                const key = `${r}-${c}`
                if (r === c) return <td key={key} data-diagonal="" className={CELL} />
                if (cell === null) {
                  const now = isLive(r, c)
                  return (
                    <td
                      key={key}
                      data-live={now ? 'true' : undefined}
                      className={cx(
                        CELL,
                        'rounded-sm border',
                        now ? 'border-accent' : 'border-border',
                        now && !reduced && 'animate-skeleton',
                      )}
                    >
                      {now && <span className="sr-only">playing now</span>}
                    </td>
                  )
                }
                const label = `${names[r]} v ${names[c]}: ${cell.points} to ${cell.against}`
                return (
                  <td key={key} data-played="" className={CELL}>
                    <Tooltip
                      content={
                        <span>
                          <span className="text-bright">{label}</span>
                          <span className="text-muted"> · by round {breakdown(cell)}</span>
                        </span>
                      }
                    >
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={selected === cell.match}
                        data-match={cell.match}
                        onClick={() => onSelect(cell.match)}
                        className={cx(
                          'size-full rounded-sm border tabular-nums transition-colors duration-120 ease-out focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
                          cellTone(cell),
                          selected === cell.match
                            ? 'border-accent'
                            : 'border-transparent hover:border-border-strong',
                        )}
                      >
                        {cell.points}
                      </button>
                    </Tooltip>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
