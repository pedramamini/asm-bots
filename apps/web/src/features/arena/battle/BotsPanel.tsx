import { HueSwatch, Panel, Sparkline, Table, type TableColumn } from '@asmbots/ui'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import type { ArenaClient } from '../worker/client'
import { STAT_FIELDS, STAT_FOOTPRINT, STAT_PROCS, STAT_WRITES } from '../worker/protocol'
import { useLogTick } from './hooks'
import { type BattleLog, type BotDeath, killerText, reasonText } from './log'

export interface BotsPanelProps {
  client: ArenaClient
  log: BattleLog
  /** The bots isolated. */
  isolated: readonly number[]
  /** Isolates `bot`, or with `add` adds it to the isolated bots or takes it out. */
  onIsolate: (bot: number, add: boolean) => void
  className?: string | undefined
}

/** A row of the table: a bot as the last frame left it. */
interface BotRow {
  readonly index: number
  readonly name: string
  readonly procs: number
  readonly footprint: number
  readonly writes: number
  readonly history: readonly number[]
  readonly death: BotDeath | null
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The rail's bots (PRODUCT_SPEC §2): hue, name, processes now and over the last 120 frames, bytes
 * owned, writes, and alive or dead. A click on a row isolates the bot (the rest of the arena dims),
 * a shift-click adds it; the name is the button that does it from the keyboard, as `1`..`9` do.
 */
export function BotsPanel({ client, log, isolated, onIsolate, className }: BotsPanelProps) {
  // Redraws with the log, a few times a second, not with every frame.
  const tick = useLogTick(log)
  const meta = useStore(client.store, (state) => state.botMeta)
  const alive = useStore(client.store, (state) => state.alive)
  const rows = useMemo<BotRow[]>(() => {
    // Read at each tick of the log, not each frame.
    void tick
    const { stats } = client.store.getState()
    return meta.map((bot, index) => {
      const o = index * STAT_FIELDS
      return {
        index,
        name: bot.name,
        procs: stats[o + STAT_PROCS] ?? 0,
        footprint: stats[o + STAT_FOOTPRINT] ?? 0,
        writes: stats[o + STAT_WRITES] ?? 0,
        history: [...(log.history[index] ?? [])],
        death: log.deaths[index] ?? null,
      }
    })
  }, [client, log, meta, tick])

  const columns = useMemo<TableColumn<BotRow>[]>(
    () => [
      {
        id: 'bot',
        header: 'bot',
        cell: (bot) => (
          <button
            type="button"
            aria-pressed={isolated.includes(bot.index)}
            aria-label={`isolate ${bot.name}`}
            title={bot.index < 9 ? `isolate · ${bot.index + 1}, shift-click adds` : 'isolate'}
            className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-sm focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <HueSwatch hue={bot.index} />
            <span className={bot.death === null ? 'truncate text-bright' : 'truncate text-muted'}>
              {bot.name}
            </span>
          </button>
        ),
      },
      {
        id: 'procs',
        header: 'procs',
        align: 'right',
        className: 'w-24',
        cell: (bot) => (
          <span className="inline-flex items-center justify-end gap-2">
            <Sparkline
              values={bot.history}
              min={0}
              hue={bot.index}
              width={40}
              height={12}
              aria-label={`${bot.name}: processes over the last ${bot.history.length} frames`}
            />
            <span className="w-7">{count(bot.procs)}</span>
          </span>
        ),
      },
      {
        id: 'bytes',
        header: 'bytes',
        align: 'right',
        className: 'w-16',
        cell: (bot) => count(bot.footprint),
      },
      {
        id: 'writes',
        header: 'writes',
        align: 'right',
        className: 'w-18',
        cell: (bot) => count(bot.writes),
      },
      {
        id: 'status',
        header: 'status',
        className: 'w-28',
        cell: (bot) =>
          bot.death === null ? (
            <span className="text-accent-fg">alive</span>
          ) : (
            <span
              className="text-danger"
              title={`${reasonText(bot.death.reason)} · ${killerText(bot.death.killer, bot.index, log.names)}`}
            >
              dead @ {count(bot.death.cycle)}
            </span>
          ),
      },
    ],
    [isolated, log],
  )

  const dead = rows.filter((row) => row.death !== null).length
  return (
    <Panel
      dense
      className={className}
      title="bots"
      data-tour="arena-bots"
      status={`${count(alive)} alive${dead > 0 ? ` · ${count(dead)} dead` : ''}`}
    >
      <Table
        aria-label="bots"
        columns={columns}
        rows={rows}
        rowKey={(bot) => bot.index}
        rowSelected={(bot) => isolated.includes(bot.index)}
        onRowClick={(bot, event) => onIsolate(bot.index, event.shiftKey)}
        className="h-full"
      />
    </Panel>
  )
}
