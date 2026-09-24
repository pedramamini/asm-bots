import { Button, HueSwatch, IconButton, Panel, PanelGrid } from '@asmbots/ui'
import { Pause, Play, Settings2 } from 'lucide-react'
import { useStore } from 'zustand'
import { useRouteStat } from '../../app/slots'
import { ArenaCanvas } from './ArenaCanvas'
import type { ArenaFight } from './setup/bots'
import type { ArenaClient } from './worker/client'
import { STAT_FIELDS, STAT_PROCS } from './worker/protocol'

export interface ArenaBattleProps {
  /** The client the fight was loaded into. */
  client: ArenaClient
  fight: ArenaFight
  /** Back to the setup. */
  onExit: () => void
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The arena in battle (PRODUCT_SPEC §2): the canvas beside the bots. Play, pause, and the way back
 * to the setup; the HUD, the transport, and the rail's tables come with the battle playbook task.
 */
export function ArenaBattle({ client, fight, onExit }: ArenaBattleProps) {
  const status = useStore(client.store, (state) => state.status)
  const cycle = useStore(client.store, (state) => state.cycle)
  const alive = useStore(client.store, (state) => state.alive)
  const stats = useStore(client.store, (state) => state.stats)
  const error = useStore(client.store, (state) => state.error)
  const maxCycles = fight.config.maxCycles ?? 0
  const procs = fight.bots.reduce(
    (sum, _, bot) => sum + (stats[bot * STAT_FIELDS + STAT_PROCS] ?? 0),
    0,
  )
  const playing = status === 'playing'

  useRouteStat(`${fight.bots.length} bots · ${count(procs)} procs · cycle ${count(cycle)}`)

  return (
    <PanelGrid className="p-3">
      <Panel
        className="col-span-12 lg:col-span-8"
        title="arena"
        status={
          status === 'error'
            ? 'failed'
            : `cycle ${count(cycle)} / ${count(maxCycles)}${status === 'ended' ? ' · over' : ''}`
        }
        actions={
          <>
            <IconButton
              icon={playing ? Pause : Play}
              label={playing ? 'pause' : 'play'}
              disabled={status === 'ended' || status === 'error'}
              onClick={() => (playing ? client.pause() : client.play())}
            />
            <Button icon={Settings2} onClick={onExit}>
              setup
            </Button>
          </>
        }
      >
        {status === 'error' ? (
          <p className="py-6 text-center text-danger">{error}</p>
        ) : (
          <ArenaCanvas client={client} className="h-[calc(100dvh-12rem)] min-h-80 w-full" />
        )}
      </Panel>
      <Panel
        className="col-span-12 lg:col-span-4"
        title="bots"
        status={`${alive} alive · seed ${fight.config.seed}`}
      >
        <ol aria-label="bots in the battle" className="flex flex-col">
          {fight.bots.map((bot, index) => (
            <li
              key={bot.name}
              className="flex items-center gap-2 border-b border-border py-1 last:border-b-0"
            >
              <HueSwatch hue={index} />
              <span className="min-w-0 flex-1 truncate text-bright">{bot.name}</span>
              <span className="text-data text-muted">
                {count(stats[index * STAT_FIELDS + STAT_PROCS] ?? 0)} procs
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </PanelGrid>
  )
}
