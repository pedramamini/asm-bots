import { pmarsPoints } from '@asmbots/engine'
import { type MatchResult, meleeStandings } from '@asmbots/tourney'
import { HueSwatch, Panel, Table, type TableColumn } from '@asmbots/ui'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import type { ArenaClient } from '../worker/client'
import { useLogTick } from './hooks'
import type { BattleLog } from './log'

export interface StandingsPanelProps {
  client: ArenaClient
  log: BattleLog
  className?: string | undefined
}

/** A bot's line: its points so far, and the points the round in play would give it now. */
export interface StandingRow {
  readonly bot: number
  readonly name: string
  readonly points: number
  readonly wins: number
  readonly ties: number
  readonly losses: number
  /** What the round in play gives it if it ends now (ISA §5.5): 0 once the round has ended. */
  readonly live: number
}

/**
 * The match's standings (pMARS points, ISA §5.5) with the round in play counted as it stands: each
 * bot alive now would score `pmarsPoints(n, alive)` if the round ended here. Highest running total
 * first; then the most wins, then the name, as `compareStandings` orders a tournament.
 */
export function runningStandings(
  match: MatchResult,
  maxCycles: number,
  alive: readonly boolean[] | null,
): StandingRow[] {
  const n = match.names.length
  const living = alive?.filter(Boolean).length ?? 0
  const share = alive === null ? 0 : pmarsPoints(n, living)
  return meleeStandings(match, { maxCycles })
    .map((s) => ({
      bot: s.entrant,
      name: s.name,
      points: s.points,
      wins: s.wins,
      ties: s.ties,
      losses: s.losses,
      live: alive?.[s.entrant] ? share : 0,
    }))
    .sort(
      (a, b) =>
        b.points + b.live - (a.points + a.live) ||
        b.wins - a.wins ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : a.bot - b.bot),
    )
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The rail's standings (PRODUCT_SPEC §2), for a match of more than one round: each bot's pMARS
 * points so far, its wins, ties, and losses, and, live, what the round in play would add if it
 * ended now.
 */
export function StandingsPanel({ client, log, className }: StandingsPanelProps) {
  // Redraws with the log, a few times a second, not with every frame.
  const tick = useLogTick(log)
  const match = useStore(client.store, (state) => state.match)
  const maxCycles = useStore(client.store, (state) => state.config?.maxCycles ?? 0)
  const status = useStore(client.store, (state) => state.status)
  const round = useStore(client.store, (state) => state.round)
  const rows = useMemo(() => {
    void tick
    if (match === null) return []
    // The round in play counts until it ends and joins the match.
    const running = status !== 'ended' && match.rounds.length === round
    const alive = running ? log.deaths.map((death) => death === null) : null
    return runningStandings(match, maxCycles, alive)
  }, [log, tick, match, maxCycles, status, round])

  const columns = useMemo<TableColumn<StandingRow>[]>(
    () => [
      {
        id: 'rank',
        header: '#',
        align: 'right',
        className: 'w-6',
        cell: (row) => <span className="text-muted">{rows.indexOf(row) + 1}</span>,
      },
      {
        id: 'bot',
        header: 'bot',
        cell: (row) => (
          <span className="inline-flex max-w-full items-center gap-2">
            <HueSwatch hue={row.bot} />
            <span className="truncate text-bright">{row.name}</span>
          </span>
        ),
      },
      {
        id: 'record',
        header: 'w/t/l',
        align: 'right',
        className: 'w-20',
        cell: (row) => (
          <span className="text-muted">
            {row.wins}/{row.ties}/{row.losses}
          </span>
        ),
      },
      {
        id: 'live',
        header: 'live',
        align: 'right',
        className: 'w-14',
        cell: (row) =>
          row.live > 0 ? (
            <span className="text-muted" title="its points if the round ended now">
              +{count(row.live)}
            </span>
          ) : null,
      },
      {
        id: 'points',
        header: 'points',
        align: 'right',
        className: 'w-16',
        cell: (row) => <span className="text-bright">{count(row.points)}</span>,
      },
    ],
    [rows],
  )

  const done = match !== null && match.rounds.length === match.of
  return (
    <Panel
      dense
      className={className}
      title="standings"
      status={done ? 'final' : `round ${round + 1}/${match?.of ?? 1}`}
    >
      <Table aria-label="standings" columns={columns} rows={rows} rowKey={(row) => row.bot} />
    </Panel>
  )
}
