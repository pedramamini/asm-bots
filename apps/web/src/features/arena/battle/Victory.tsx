import type { BotResult, Result } from '@asmbots/engine'
import { type MatchResult, type MeleeStanding, meleeStandings } from '@asmbots/tourney'
import { Button, HueSwatch, IconButton, Table, type TableColumn, Toggle } from '@asmbots/ui'
import { Bug, Dices, Download, Link, RotateCcw, SkipForward, X } from 'lucide-react'
import { useId, useMemo } from 'react'
import { botResults } from '../worker/protocol'
import { reasonText } from './log'

const count = (n: number) => n.toLocaleString('en-US')

/** How a round or a match came out, in the overlay's words (PRODUCT_SPEC §2). */
export interface Outcome {
  /** A sole winner, a draw between the best, or nobody left. */
  readonly kind: 'winner' | 'draw' | 'none'
  /** The winners: one, the bots that share first place, or none. */
  readonly winners: readonly number[]
  /** `WINNER · Dwarf`, `DRAW · Dwarf, Imp`, `NO WINNER`. */
  readonly headline: string
  /** `last bot standing · cycle 41,203`. */
  readonly detail: string
}

function joinNames(bots: readonly number[], names: readonly string[]): string {
  return bots.map((bot) => names[bot] ?? `bot ${bot + 1}`).join(', ')
}

/** A round's outcome: the bots standing at its end (ISA §5.5). */
export function roundOutcome(
  result: Result,
  order: readonly number[],
  names: readonly string[],
): Outcome {
  const standing = botResults(result, order).flatMap((bot, index) => (bot.alive ? [index] : []))
  const at = `cycle ${count(result.cycles)}`
  if (standing.length === 1) {
    return {
      kind: 'winner',
      winners: standing,
      headline: `winner · ${joinNames(standing, names)}`,
      detail: `last bot standing · ${at}`,
    }
  }
  if (standing.length === 0) {
    return { kind: 'none', winners: [], headline: 'no winner', detail: `no bot standing · ${at}` }
  }
  return {
    kind: 'draw',
    winners: standing,
    headline: `draw · ${joinNames(standing, names)}`,
    detail: `time ran out · ${standing.length} bots standing · ${at}`,
  }
}

/** A match's outcome: the most pMARS points over its rounds (ISA §5.5). */
export function matchOutcome(match: MatchResult, standings: readonly MeleeStanding[]): Outcome {
  const top = Math.max(...match.points)
  const winners = standings.filter((s) => s.points === top).map((s) => s.entrant)
  const rounds = `${match.rounds.length} ${match.rounds.length === 1 ? 'round' : 'rounds'}`
  if (winners.length === 1) {
    const wins = standings.find((s) => s.entrant === winners[0])?.wins ?? 0
    return {
      kind: 'winner',
      winners,
      headline: `winner · ${joinNames(winners, match.names)}`,
      detail: `${count(top)} points · won ${wins} of ${rounds}`,
    }
  }
  return {
    kind: top > 0 ? 'draw' : 'none',
    winners: top > 0 ? winners : [],
    headline: top > 0 ? `draw · ${joinNames(winners, match.names)}` : 'no winner',
    detail: top > 0 ? `${count(top)} points each · ${rounds}` : `no points · ${rounds}`,
  }
}

export interface VictoryActions {
  onRematch: () => void
  onNewSeed: () => void
  onShare: () => void
  onDebug: () => void
  onDownload: () => void
}

export interface VictoryProps extends VictoryActions {
  /** The last round's engine result, and the order it was fought in. */
  result: Result
  order: readonly number[]
  /** `resultHash(result)`. */
  hash: string
  /** The whole match. */
  match: MatchResult
  names: readonly string[]
  maxCycles: number
  /** Hides the overlay. */
  onDismiss: () => void
}

interface RoundRow {
  readonly bot: number
  readonly name: string
  readonly result: BotResult
}

/**
 * The end of a battle (PRODUCT_SPEC §2): `WINNER · dwarf-v3 · last bot standing · cycle 41,203`
 * over the arena, the bots' numbers, and what to do next: `rematch`, `new seed`, `share`, `open
 * in debugger`, `download replay`. A match of more rounds shows its standings. The result hash is
 * the one a replay checks (ISA §5.6).
 */
export function Victory({
  result,
  order,
  hash,
  match,
  names,
  maxCycles,
  onDismiss,
  ...actions
}: VictoryProps) {
  const titleId = useId()
  const standings = useMemo(() => meleeStandings(match, { maxCycles }), [match, maxCycles])
  const multi = match.of > 1
  const outcome = multi ? matchOutcome(match, standings) : roundOutcome(result, order, names)
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(0,0,0,0.6)] p-4">
      <section
        aria-labelledby={titleId}
        data-result-hash={hash}
        className="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-auto rounded-lg border border-border-strong bg-panel p-4"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDismiss()
        }}
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} aria-live="polite" className="text-modal-title text-accent uppercase">
              {outcome.headline}
            </h2>
            <p className="text-body text-muted">{outcome.detail}</p>
          </div>
          <IconButton icon={X} label="hide" size="sm" onClick={onDismiss} />
        </header>
        {multi ? (
          <MatchTable standings={standings} winners={outcome.winners} />
        ) : (
          <RoundTable result={result} order={order} names={names} winners={outcome.winners} />
        )}
        <p
          className="truncate text-data text-dim"
          title="the result hash a replay checks (ISA §5.6)"
        >
          result {hash}
          {multi && ` · round ${match.rounds.length} of ${match.of}`}
        </p>
        <Actions {...actions} />
      </section>
    </div>
  )
}

function Actions({ onRematch, onNewSeed, onShare, onDebug, onDownload }: VictoryActions) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" icon={RotateCcw} onClick={onRematch}>
        rematch
      </Button>
      <Button icon={Dices} onClick={onNewSeed}>
        new seed
      </Button>
      <Button icon={Link} onClick={onShare}>
        share
      </Button>
      <Button icon={Bug} onClick={onDebug}>
        open in debugger
      </Button>
      <Button icon={Download} onClick={onDownload}>
        download replay
      </Button>
    </div>
  )
}

function BotCell({ bot, name, winner }: { bot: number; name: string; winner: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <HueSwatch hue={bot} />
      <span className={winner ? 'truncate text-accent' : 'truncate text-bright'}>{name}</span>
    </span>
  )
}

function RoundTable({
  result,
  order,
  names,
  winners,
}: {
  result: Result
  order: readonly number[]
  names: readonly string[]
  winners: readonly number[]
}) {
  const rows = botResults(result, order)
    .map((bot, index) => ({ bot: index, name: names[index] ?? bot.name, result: bot }))
    // The standing first, then the latest to die.
    .sort(
      (a, b) =>
        Number(b.result.alive) - Number(a.result.alive) ||
        (b.result.deathCycle ?? 0) - (a.result.deathCycle ?? 0) ||
        a.bot - b.bot,
    )
  const columns: TableColumn<RoundRow>[] = [
    {
      id: 'bot',
      header: 'bot',
      cell: (row) => <BotCell bot={row.bot} name={row.name} winner={winners.includes(row.bot)} />,
    },
    {
      id: 'status',
      header: 'status',
      className: 'w-40',
      cell: ({ result: bot }) =>
        bot.alive ? (
          <span className="text-accent">standing</span>
        ) : (
          <span className="text-danger">
            dead @ {count(bot.deathCycle ?? 0)} · {reasonText(bot.deathReason ?? 'undefined')}
          </span>
        ),
    },
    {
      id: 'points',
      header: 'points',
      align: 'right',
      className: 'w-18',
      cell: ({ result: bot }) => count(bot.points),
    },
    {
      id: 'peak',
      header: 'peak',
      align: 'right',
      className: 'w-12',
      cell: ({ result: bot }) => count(bot.peakProcs),
    },
    {
      id: 'bytes',
      header: 'bytes',
      align: 'right',
      className: 'w-16',
      cell: ({ result: bot }) => count(bot.footprint),
    },
    {
      id: 'writes',
      header: 'writes',
      align: 'right',
      className: 'w-16',
      cell: ({ result: bot }) => count(bot.writes),
    },
  ]
  return (
    <Table
      aria-label="the bots at the end"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.bot}
    />
  )
}

function MatchTable({
  standings,
  winners,
}: {
  standings: readonly MeleeStanding[]
  winners: readonly number[]
}) {
  const columns: TableColumn<MeleeStanding>[] = [
    {
      id: 'rank',
      header: '#',
      align: 'right',
      className: 'w-6',
      cell: (row) => <span className="text-muted">{standings.indexOf(row) + 1}</span>,
    },
    {
      id: 'bot',
      header: 'bot',
      cell: (row) => (
        <BotCell bot={row.entrant} name={row.name} winner={winners.includes(row.entrant)} />
      ),
    },
    {
      id: 'record',
      header: 'w/t/l',
      align: 'right',
      className: 'w-20',
      cell: (row) => `${row.wins}/${row.ties}/${row.losses}`,
    },
    {
      id: 'points',
      header: 'points',
      align: 'right',
      className: 'w-16',
      cell: (row) => <span className="text-bright">{count(row.points)}</span>,
    },
  ]
  return (
    <Table
      aria-label="standings at the end"
      columns={columns}
      rows={standings}
      rowKey={(row) => row.entrant}
    />
  )
}

export interface RoundOverProps {
  /** The round just ended, from 0, of `rounds`. */
  round: number
  rounds: number
  outcome: Outcome
  autoplay: boolean
  onAutoplay: (on: boolean) => void
  onNextRound: () => void
}

/**
 * Between the rounds of a match: how the round ended, and `next round`. With autoplay on, the
 * next round starts by itself after a moment.
 */
export function RoundOver({
  round,
  rounds,
  outcome,
  autoplay,
  onAutoplay,
  onNextRound,
}: RoundOverProps) {
  return (
    <section
      aria-label={`round ${round + 1} over`}
      className="absolute bottom-10 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md border border-border-strong bg-panel px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate text-panel-title text-accent uppercase">
          round {round + 1}/{rounds} · {outcome.headline}
        </p>
        <p className="truncate text-data text-muted">
          {outcome.detail}
          {autoplay && ' · next round in a moment'}
        </p>
      </div>
      <Toggle pressed={autoplay} onPressedChange={onAutoplay}>
        autoplay
      </Toggle>
      <Button variant="primary" icon={SkipForward} onClick={onNextRound}>
        next round
      </Button>
    </section>
  )
}
