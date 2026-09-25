/**
 * A hill's recent submissions (PRODUCT_SPEC §5), newest first, with their deltas: who entered at
 * which rank and how many places its bot gained (`+3 rank`), who missed and by what score, and
 * what each pushed off.
 */
import type { HillEventSummary } from '@asmbots/protocol'
import { EmptyState, type EmptyStateAction, Panel, Skeleton } from '@asmbots/ui'
import type { ReactNode } from 'react'
import { useHillHistory } from '../../api/queries'
import { LoadFailure, readStatus } from '../../app/LoadFailure'
import { ago, BotLink, count, day } from './links'

/** The events a feed shows. */
const EVENTS = 20

/** One submission's line: its challenger's event, then what it did to the others. */
export interface FeedItem {
  readonly key: string
  readonly events: readonly HillEventSummary[]
}

/** `events` (newest first, each submission's in the order written) as one line per submission. */
export function feedItems(events: readonly HillEventSummary[]): FeedItem[] {
  const items: { key: string; events: HillEventSummary[] }[] = []
  for (const e of events) {
    const last = items.at(-1)
    const submission = e.event.submissionId
    if (last !== undefined && submission !== null && last.key === submission) {
      last.events.push(e)
    } else {
      items.push({ key: submission ?? e.event.id, events: [e] })
    }
  }
  return items
}

/** `+3 rank`, `-2 rank`, or `new` when its bot had no place before. */
export function rankDelta(delta: number | null): string {
  if (delta === null) return 'new'
  return `${delta > 0 ? '+' : ''}${delta} rank`
}

function Bot({ summary }: { summary: HillEventSummary }) {
  return summary.bot === null ? <>[deleted]</> : <BotLink bot={summary.bot} />
}

/** What one event says. */
function eventText(summary: HillEventSummary): ReactNode {
  const { event } = summary
  switch (event.kind) {
    case 'entered':
      return (
        <>
          <Bot summary={summary} /> entered at #{event.rank}{' '}
          <span
            className={
              event.delta === null
                ? 'text-muted'
                : event.delta >= 0
                  ? 'text-accent-fg'
                  : 'text-danger'
            }
          >
            {rankDelta(event.delta)}
          </span>
        </>
      )
    case 'rejected':
      return (
        <>
          <Bot summary={summary} /> missed the hill{' '}
          <span className="text-muted">· scored {count(event.score)}</span>
        </>
      )
    case 'evicted':
      return (
        <>
          pushed off <Bot summary={summary} /> <span className="text-muted">(#{event.rank})</span>
        </>
      )
    case 'replaced':
      return (
        <>
          replaced <Bot summary={summary} /> <span className="text-muted">(#{event.rank})</span>
        </>
      )
  }
}

export interface HillFeedProps {
  slug: string
  /** What an empty feed offers: the hill page's `submit a bot`. */
  emptyAction: EmptyStateAction
  className?: string | undefined
  /** The clock `ago` reads; tests fix it. */
  now?: number | undefined
}

export function HillFeed({ slug, emptyAction, className, now }: HillFeedProps) {
  const read = useHillHistory(slug, EVENTS)
  const { data, error } = read
  const items = feedItems(data?.events ?? [])
  return (
    <Panel
      className={className}
      title="recent submissions"
      status={readStatus(data, error, () => `last ${items.length}`)}
    >
      {error !== null && data === undefined ? (
        <LoadFailure read={read} />
      ) : data === undefined ? (
        <Skeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState action={emptyAction}>
          no submissions yet: the hill is as it was seeded.
        </EmptyState>
      ) : (
        <ol aria-label="recent submissions" className="flex flex-col gap-1.5 text-data">
          {items.map((item) => {
            const at = item.events[0]?.event.at ?? ''
            return (
              <li key={item.key} className="flex min-w-0 gap-2">
                <time dateTime={at} title={day(at)} className="w-14 shrink-0 text-muted">
                  {ago(at, now)}
                </time>
                <span className="min-w-0">
                  {item.events.map((e, i) => (
                    <span key={e.event.id}>
                      {i > 0 && <span className="text-muted"> · </span>}
                      {eventText(e)}
                    </span>
                  ))}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
