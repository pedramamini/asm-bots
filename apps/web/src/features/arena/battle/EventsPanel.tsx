import { cx, HueSwatch, Panel, Segmented, Table, type TableColumn } from '@asmbots/ui'
import { useMemo } from 'react'
import type { ArenaClient } from '../worker/client'
import { useLogTick } from './hooks'
import { type BattleLog, describe, type LogEvent, type LogKind } from './log'
import type { EventFilter } from './view'

export interface EventsPanelProps {
  client: ArenaClient
  log: BattleLog
  filter: EventFilter
  onFilter: (filter: EventFilter) => void
  className?: string | undefined
}

const FILTERS = [
  { value: 'all', label: 'all' },
  { value: 'deaths', label: 'deaths' },
  { value: 'bots', label: 'bots' },
] as const satisfies readonly { value: EventFilter; label: string }[]

/** Each kind of line in its tone: the bots' fates stand out, the churn does not. */
const TONE: Readonly<Record<LogKind, string>> = {
  round: 'text-muted',
  spawn: 'text-text',
  death: 'text-text',
  blood: 'text-warn',
  dead: 'text-danger',
  end: 'text-accent',
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The rail's events log (PRODUCT_SPEC §2): the round's spawns, deaths, first blood, bot deaths,
 * and end, newest first, each stamped with its cycle. A click on a line (or its cycle, from the
 * keyboard) takes the battle to that cycle, just before the line happens: `.` then plays it. Lines
 * past the playhead, after a seek back, are dimmer.
 */
export function EventsPanel({ client, log, filter, onFilter, className }: EventsPanelProps) {
  // Redraws with the log, a few times a second, not with every frame.
  const tick = useLogTick(log)
  // Read at each tick of the log, not each frame: the playhead too.
  const [events, now] = useMemo(() => {
    void tick
    return [log.events(filter), client.store.getState().cycle] as const
  }, [client, log, tick, filter])
  const go = (event: LogEvent) => {
    client.pause()
    client.seek(event.cycle)
  }

  const columns = useMemo<TableColumn<LogEvent>[]>(
    () => [
      {
        id: 'cycle',
        header: 'cycle',
        align: 'right',
        className: 'w-18',
        cell: (event) => (
          <button
            type="button"
            aria-label={`go to cycle ${count(event.cycle)}`}
            className="cursor-pointer rounded-sm text-muted hover:text-bright focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {count(event.cycle)}
          </button>
        ),
      },
      {
        id: 'event',
        header: 'event',
        cell: (event) => (
          <span className={cx('inline-flex max-w-full items-center gap-2', TONE[event.kind])}>
            {event.bot === null ? (
              <span aria-hidden="true" className="size-2.5 shrink-0" />
            ) : (
              <HueSwatch hue={event.bot} className="shrink-0" />
            )}
            <span className="truncate">{describe(event, log.names, log.rounds)}</span>
          </span>
        ),
      },
    ],
    [log],
  )

  return (
    <Panel
      dense
      className={className}
      title="events"
      actions={
        <Segmented label="events shown" options={FILTERS} value={filter} onValueChange={onFilter} />
      }
    >
      <Table
        aria-label="events"
        columns={columns}
        rows={events}
        rowKey={(event) => event.id}
        rowClassName={(event) => (event.cycle > now ? 'opacity-45' : undefined)}
        onRowClick={go}
        className="h-full"
      />
    </Panel>
  )
}
