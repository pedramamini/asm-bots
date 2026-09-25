import { cx, HueSwatch } from '@asmbots/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useMotionReduced, useSettings } from '../../../store/settings'
import { ArenaCanvas } from '../ArenaCanvas'
import { SIDE } from '../render/scene'
import { ArenaClient, createArenaStore } from '../worker/client'
import { type ArenaBot, type FrameMessage, STAT_FIELDS, STAT_PROCS } from '../worker/protocol'
import { DemoLoop, demoBots, paintStill, STILL_CYCLE, STILL_SEED, stillFrame } from './demo'
import { useSeen } from './seen'

export interface HomeDemoProps {
  /** Hears what the demo shows, for the hero's status: `4 bots · seed 83712`. */
  onStatus?: ((status: string) => void) | undefined
  /** Makes the demo's client. Default: an `ArenaClient` with a store of its own. */
  createClient?: (() => ArenaClient) | undefined
}

const newClient = () => new ArenaClient({ store: createArenaStore() })

const count = (n: number) => n.toLocaleString('en-US')

/** The demo's root: all of the hero's grid, its columns shared. */
const GRID = 'relative col-span-full row-start-1 grid grid-cols-subgrid grid-rows-1'
/** The battle's cell: the hero's black box, the middle column from `xl` on. */
const CELL = 'relative col-start-1 row-start-1 min-h-0 xl:col-start-2'

/**
 * The home page's hero battle (PRODUCT_SPEC §1): the demo's four bots in the arena, over and
 * over (`demo.ts`), with no HUD and no controls, and a legend of the bots. It is a grid item that
 * spans the hero's grid (`HomePage`) as a subgrid: the battle in the hero's black box, and from
 * `xl` on the legend in the column right of it. It pauses while the tab is hidden or the demo is off screen. Under reduced motion it is a
 * still: one battle's owner map.
 */
export function HomeDemo(props: HomeDemoProps) {
  return useMotionReduced() ? <DemoStill {...props} /> : <DemoBattle {...props} />
}

function DemoBattle({ onStatus, createClient = newClient }: HomeDemoProps) {
  const box = useRef<HTMLDivElement>(null)
  const make = useRef(createClient)
  const status = useRef(onStatus)
  status.current = onStatus
  const [bots] = useState(demoBots)
  const [client, setClient] = useState<ArenaClient | null>(null)
  const loop = useRef<DemoLoop | null>(null)
  const seen = useSeen(box)

  useEffect(() => {
    const made = make.current()
    const demo = new DemoLoop(made, {
      bots,
      onBattle: (seed) => status.current?.(`${bots.length} bots · seed ${seed}`),
    })
    loop.current = demo
    setClient(made)
    demo.start()
    return () => {
      demo.dispose()
      made.dispose()
      loop.current = null
      setClient(null)
    }
  }, [bots])

  // Also after a new client: the loop starts as if seen.
  useEffect(() => {
    loop.current?.setVisible(seen)
  }, [seen, client])

  return (
    <div ref={box} className={GRID} data-demo="live">
      {client !== null && (
        <div className={cx(CELL, 'overflow-hidden rounded-sm border border-transparent')}>
          <ArenaCanvas
            client={client}
            interactive={false}
            minimap={false}
            label={`demo battle: ${bots.map((bot) => bot.name).join(', ')}`}
            className="size-full"
          />
        </div>
      )}
      {client !== null && <LiveLegend client={client} bots={bots} />}
    </div>
  )
}

/** The still: battle `STILL_SEED` at `STILL_CYCLE`, a pixel a byte, scaled up square. */
function DemoStill({ onStatus, createClient = newClient }: HomeDemoProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const make = useRef(createClient)
  const status = useRef(onStatus)
  status.current = onStatus
  const [bots] = useState(demoBots)
  const [frame, setFrame] = useState<FrameMessage | null>(null)
  const theme = useSettings((state) => state.theme)

  useEffect(() => {
    const client = make.current()
    let live = true
    stillFrame(client, bots).then(
      (made) => {
        client.dispose()
        if (!live) return
        setFrame(made)
        status.current?.(`${bots.length} bots · seed ${STILL_SEED} · cycle ${count(STILL_CYCLE)}`)
      },
      () => {
        client.dispose()
        if (live) status.current?.(`${bots.length} bots · did not load`)
      },
    )
    return () => {
      live = false
      client.dispose()
    }
  }, [bots])

  useLayoutEffect(() => {
    if (frame !== null && canvas.current !== null) paintStill(canvas.current, frame, theme)
  }, [frame, theme])

  const names = bots.map((bot) => bot.name).join(', ')
  return (
    <div className={GRID} data-demo="still">
      {frame !== null && (
        <div className={cx(CELL, 'flex items-center justify-center')}>
          <canvas
            ref={canvas}
            width={SIDE}
            height={SIDE}
            role="img"
            aria-label={`demo battle at cycle ${count(STILL_CYCLE)}: the core as ${names} own it`}
            className="aspect-square h-full [image-rendering:pixelated]"
          />
        </div>
      )}
      {frame !== null && <Legend bots={bots} alive={aliveOf(frame.stats, bots.length)} />}
    </div>
  )
}

/** Whether each of `n` bots is alive, by its processes in `stats`: alive until a frame says not. */
function aliveOf(stats: Float32Array, n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => (stats[i * STAT_FIELDS + STAT_PROCS] ?? 1) > 0)
}

/** The legend over a live battle: it greys a bot out when it dies. */
function LiveLegend({ client, bots }: { client: ArenaClient; bots: readonly ArenaBot[] }) {
  // A string, so the legend draws again only when a bot lives or dies, not every frame.
  const key = useStore(client.store, (state) =>
    aliveOf(state.stats, bots.length)
      .map((alive) => (alive ? '1' : '0'))
      .join(''),
  )
  return <Legend bots={bots} alive={[...key].map((c) => c === '1')} />
}

/**
 * Each bot's hue and name, on a panel: paper's text would vanish on black. Over the battle's
 * bottom right, and from `xl` on in the column right of it, at its foot.
 */
function Legend({ bots, alive }: { bots: readonly ArenaBot[]; alive: readonly boolean[] }) {
  return (
    <ul
      aria-label="the demo's bots"
      className="pointer-events-none absolute right-3 bottom-3 hidden flex-col gap-0.5 rounded-md border border-border bg-panel px-2.5 py-2 sm:flex xl:static xl:col-start-3 xl:row-start-1 xl:self-end xl:justify-self-start"
    >
      {bots.map((bot, i) => (
        <li
          key={bot.name}
          data-alive={alive[i] !== false}
          className={cx(
            'flex items-center gap-2 text-data',
            alive[i] === false ? 'text-muted line-through' : 'text-text',
          )}
        >
          <HueSwatch hue={i} />
          {bot.name}
        </li>
      ))}
    </ul>
  )
}
