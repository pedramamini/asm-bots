/**
 * A hill submission as it runs and after (PRODUCT_SPEC §5): the progress panel ("fighting 24 of
 * 32"), a row per match as it lands and one for the match being fought, then the result card: the
 * rank it took, or the score it had against the score it needed and its closest fight. While
 * its job runs, the hill's live room says each time the job moves, and the submission is read
 * again; with the room not open it is polled instead. When it has finished, the hill's reads
 * load again.
 */
import {
  type BotLabel,
  type Hill,
  hillJobId,
  type MatchSummary,
  type SubmissionDetail,
} from '@asmbots/protocol'
import { Chip, cx, IconButton, Panel, Skeleton, Stat, Table, type TableColumn } from '@asmbots/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { submissionQuery, useSubmission } from '../../api/queries'
import { LoadFailure } from '../../app/LoadFailure'
import { useMotionReduced } from '../../store/settings'
import type { LiveRoomState } from '../live/room'
import { VerifyMatch } from '../verify/VerifyMatch'
import { BotLink, CELL_LINK, count } from './links'
import { matchTitle, verifiable } from './MatchesTable'

/** A match from the challenger's side (entrant 0): won, lost, or tied, and the points. */
export interface Fight {
  readonly outcome: 'won' | 'lost' | 'tie'
  readonly mine: number
  readonly theirs: number
}

export function fightOf({ match }: MatchSummary): Fight | null {
  const [mine, theirs] = match.result?.points ?? []
  if (mine === undefined || theirs === undefined) return null
  return { outcome: mine > theirs ? 'won' : mine < theirs ? 'lost' : 'tie', mine, theirs }
}

/** `lost 2–8`. */
export const fightText = (fight: Fight) => `${fight.outcome} ${fight.mine}–${fight.theirs}`

/** The match it lost by the fewest points: its closest fight; null when it lost none. */
export function closestFight(matches: readonly MatchSummary[]): MatchSummary | null {
  let closest: MatchSummary | null = null
  let margin = Number.POSITIVE_INFINITY
  for (const summary of matches) {
    const fight = fightOf(summary)
    if (fight?.outcome !== 'lost' || fight.theirs - fight.mine >= margin) continue
    closest = summary
    margin = fight.theirs - fight.mine
  }
  return closest
}

const nameOf = (bot: BotLabel | null | undefined) => bot?.name ?? '[deleted]'

/**
 * What the result card says of a submission that did not stay: `scored 112, needed more than 131.
 * closest fight: vs Paper (lost 2–8).` A tie with the lowest entry goes to the entry.
 */
export function missedText({ submission, matches }: SubmissionDetail): string {
  const score = count(submission.score ?? 0)
  const needed = submission.needed === null ? '' : `, needed more than ${count(submission.needed)}`
  const closest = closestFight(matches)
  const fight = closest && fightOf(closest)
  const tail =
    closest && fight ? ` closest fight: vs ${nameOf(closest.bots[1])} (${fightText(fight)}).` : ''
  return `scored ${score}${needed}.${tail}`
}

/** The panel's status (its chip says where the job is): `3 / 14` fought, or `14 matches`. */
export function submissionStatus({ progress, matches }: SubmissionDetail): string {
  return progress === null
    ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
    : `${progress.done} / ${progress.of}`
}

/** A row of the matches table: a match played, or the one being fought. */
type Row =
  | { readonly kind: 'played'; readonly summary: MatchSummary }
  | { readonly kind: 'fighting'; readonly opponent: BotLabel | null }

const OUTCOME_CLASS = { won: 'text-accent', lost: 'text-danger', tie: 'text-muted' } as const

const COLUMNS: TableColumn<Row>[] = [
  {
    id: 'opponent',
    header: 'vs',
    cell: (row) => (
      <span className="text-bright">
        {nameOf(row.kind === 'played' ? row.summary.bots[1] : row.opponent)}
      </span>
    ),
  },
  {
    id: 'result',
    header: 'result',
    cell: (row) => {
      if (row.kind === 'fighting') return <span className="text-info">fighting…</span>
      const fight = fightOf(row.summary)
      return fight && <span className={OUTCOME_CLASS[fight.outcome]}>{fightText(fight)}</span>
    },
    className: 'w-24',
  },
  {
    id: 'verify',
    header: '',
    cell: (row) =>
      row.kind === 'played' &&
      verifiable(row.summary) && (
        <VerifyMatch id={row.summary.match.id} label={matchTitle(row.summary)} />
      ),
    align: 'right',
    className: 'w-24',
  },
  {
    id: 'watch',
    header: '',
    cell: (row) => {
      const key = row.kind === 'played' ? row.summary.match.replayKey : null
      return (
        key !== null && (
          <Link to="/arena/$replayId" params={{ replayId: key }} className={CELL_LINK}>
            watch
          </Link>
        )
      )
    },
    align: 'right',
    className: 'w-14',
  },
]

/** How far the job is: `fighting 3 of 14` over a bar, or what it waits on. */
function Progress({ detail }: { detail: SubmissionDetail }) {
  const { progress, submission } = detail
  const reduced = useMotionReduced()
  if (progress === null) {
    return <p className="text-data text-muted">waiting for the runner…</p>
  }
  const { done, of, next } = progress
  const fighting = next !== null && done < of
  return (
    <div className="flex flex-col gap-1">
      <p className="text-data text-bright">
        {fighting
          ? `fighting ${count(done + 1)} of ${count(of)}`
          : submission.status === 'running'
            ? `fought ${count(done)} of ${count(of)}: settling the board…`
            : `fought ${count(done)} of ${count(of)}`}
      </p>
      <div
        role="progressbar"
        aria-label="matches fought"
        aria-valuemin={0}
        aria-valuemax={of}
        aria-valuenow={done}
        className="h-1 overflow-hidden rounded-full bg-panel-2"
      >
        <div
          className={cx(
            'h-full rounded-full bg-accent',
            !reduced && 'transition-[width] duration-300 ease-out',
          )}
          style={{ width: `${of === 0 ? 0 : (100 * done) / of}%` }}
        />
      </div>
    </div>
  )
}

/** The result card: the rank it took and what it pushed off, or why it did not stay. */
function Result({ detail }: { detail: SubmissionDetail }) {
  const { submission, events } = detail
  const entered = events.find((e) => e.event.kind === 'entered')
  const evicted = events.find((e) => e.event.kind === 'evicted')
  const replaced = events.find((e) => e.event.kind === 'replaced')
  if (submission.rank === null) {
    return (
      <section aria-label="result" className="flex flex-col gap-2">
        <Stat label="result" value="off the hill" className="border-l-danger" />
        <p className="text-data">{missedText(detail)}</p>
      </section>
    )
  }
  const delta = entered?.event.delta ?? null
  const pushed = evicted ?? replaced
  return (
    <section aria-label="result" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Stat
          label="rank"
          value={`#${submission.rank}`}
          className="min-w-28 flex-1 border-l-accent"
          {...(delta !== null && {
            delta,
            formatDelta: (n: number) => `${n} rank`,
            note: 'on its best before',
          })}
        />
        <Stat label="score" value={count(submission.score ?? 0)} className="min-w-28 flex-1" />
      </div>
      <p className="text-data">
        on the hill at #{submission.rank}
        {pushed === undefined
          ? '.'
          : `: ${pushed.event.kind === 'evicted' ? 'pushed off' : 'replaced'} ${nameOf(pushed.bot)} (#${pushed.event.rank}).`}
      </p>
    </section>
  )
}

export interface SubmissionPanelProps {
  hill: Hill
  /** The submission to follow. */
  id: string
  /** Stops following it: the page drops it from the URL. */
  onClose: () => void
  /** The hill's live room. Without it, or while it is not open, the submission is polled. */
  live?: LiveRoomState | undefined
  className?: string | undefined
}

export function SubmissionPanel({ hill, id, onClose, live, className }: SubmissionPanelProps) {
  const read = useSubmission(hill.slug, id, live?.status !== 'live')
  const { data, error } = read
  const client = useQueryClient()
  const reduced = useMotionReduced()
  const status = data?.submission.status
  // Each progress of its job (a match played, the board written) is a new read of it.
  const moved = live?.jobs.get(hillJobId(hill.slug, id))
  useEffect(() => {
    if (moved === undefined) return
    void client.invalidateQueries({ queryKey: submissionQuery(hill.slug, id).queryKey })
  }, [moved, client, hill.slug, id])
  useEffect(() => {
    // The board, its matches and history, the hills list, and profiles' best ranks all changed.
    if (status !== 'finished') return
    void client.invalidateQueries({ queryKey: ['hills'] })
    void client.invalidateQueries({ queryKey: ['users'] })
  }, [status, client])

  const close = <IconButton icon={X} label="close the submission" size="sm" onClick={onClose} />
  if (data === undefined) {
    return (
      <Panel
        className={className}
        title="submission"
        status={error === null ? 'loading' : 'error'}
        actions={close}
      >
        {error === null ? <Skeleton rows={3} /> : <LoadFailure read={read} />}
      </Panel>
    )
  }
  const { submission, bot, progress, matches } = data
  const active = submission.status === 'queued' || submission.status === 'running'
  const opponent = progress?.next?.[1] ?? null
  const rows: Row[] = [
    ...matches.map((summary): Row => ({ kind: 'played', summary })),
    ...(active && progress?.next ? [{ kind: 'fighting' as const, opponent }] : []),
  ]
  return (
    <Panel
      className={className}
      title="submission"
      status={submissionStatus(data)}
      actions={close}
      aria-busy={active || undefined}
    >
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-data">
            {bot === null ? '[deleted]' : <BotLink bot={bot} />}
            {bot !== null && (
              <span className="text-muted">
                {' '}
                v{bot.version} · {bot.owner}
              </span>
            )}
          </span>
          <Chip
            variant={
              submission.status === 'finished'
                ? 'accent'
                : submission.status === 'failed'
                  ? 'danger'
                  : submission.status === 'cancelled'
                    ? 'warn'
                    : 'info'
            }
            data-live={active ? 'true' : undefined}
            className={cx('ml-auto', active && !reduced && 'animate-skeleton')}
          >
            {submission.status}
          </Chip>
        </div>
        {active && <Progress detail={data} />}
        {submission.status === 'finished' && <Result detail={data} />}
        {submission.status === 'failed' && (
          <p className="text-data text-danger">the server could not finish this submission.</p>
        )}
        {submission.status === 'cancelled' && (
          <p className="text-data text-warn">
            cancelled after {count(progress?.done ?? matches.length)}
            {progress === null ? '' : ` of ${count(progress.of)}`} matches.
          </p>
        )}
        <Table
          aria-label="submission matches"
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => (row.kind === 'played' ? row.summary.match.id : 'fighting')}
          empty={<p className="text-data text-muted">no match fought yet.</p>}
        />
      </div>
    </Panel>
  )
}
