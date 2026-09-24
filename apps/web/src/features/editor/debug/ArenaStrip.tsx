import { cx, IconButton, Toggle } from '@asmbots/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { type RefObject, useEffect, useState } from 'react'
import { ArenaCanvas, type ArenaCanvasHandle } from '../../arena/ArenaCanvas'
import { MAX_ZOOM } from '../../arena/render/camera'
import type { DebugSession, DebugState } from './session'
import { BattleSource } from './source'

export interface ArenaStripProps {
  session: DebugSession | null
  state: DebugState | null
  /** Whether the strip shows the arena, or only its title row. */
  open: boolean
  onOpen: (open: boolean) => void
  /** The canvas's parts: the `0` key resets its zoom. */
  canvas: RefObject<ArenaCanvasHandle | null>
  className?: string | undefined
}

/** The least zoom the viewport lock goes to when the whole core is in view. */
export const LOCK_ZOOM = 4

/**
 * The lock's zoom for a view `width` by `height` px: a strip is wide, so the core's 256 columns
 * fill its width, and the rows around the IP its height. At least `LOCK_ZOOM`, at most `MAX_ZOOM`.
 */
export function lockZoom(width: number, height: number): number {
  if (width <= 0 || height <= 0) return LOCK_ZOOM
  return Math.min(MAX_ZOOM, Math.max(LOCK_ZOOM, Math.floor(width / height)))
}

/**
 * The arena strip (PRODUCT_SPEC §3): the arena's renderer, small, drawing the debugger's battle
 * (`BattleSource`: no Worker). With the viewport lock on, the view stays on the followed process's
 * IP, zoomed in. Folded, it keeps only its title row, and draws nothing.
 */
export function ArenaStrip({ session, state, open, onOpen, canvas, className }: ArenaStripProps) {
  const [lock, setLock] = useState(true)
  const [source, setSource] = useState<BattleSource | null>(null)

  useEffect(() => {
    if (session === null || !open) {
      setSource(null)
      return
    }
    const made = new BattleSource(session)
    setSource(made)
    return () => made.dispose()
  }, [session, open])

  // The lock: the view on the followed IP after each change, zoomed in if it shows the whole core.
  // A camera with no size yet centers itself, so the first view waits for the canvas's size.
  const ip = state?.ip ?? null
  useEffect(() => {
    const camera = canvas.current?.camera
    if (!lock || ip === null || camera === undefined || source === null) return
    const center = () => {
      const zoom = lockZoom(camera.view.width, camera.view.height)
      if (camera.zoom < zoom) camera.zoomBy(zoom / camera.zoom)
      camera.centerOn((ip & 0xff) + 0.5, (ip >> 8) + 0.5)
    }
    if (camera.width > 0 && camera.height > 0) {
      center()
      return
    }
    const off = camera.subscribe(() => {
      if (camera.width === 0 || camera.height === 0) return
      off()
      center()
    })
    return off
  }, [lock, ip, source, canvas])

  const alive = session === null ? 0 : session.battle.alive
  return (
    <section
      aria-label="arena strip"
      className={cx(
        'flex h-full min-h-0 flex-col rounded-md border border-border bg-panel',
        className,
      )}
    >
      <header className="flex h-8 shrink-0 items-center gap-3 border-b border-border px-2">
        <h2 className="text-panel-title text-accent">arena</h2>
        {state !== null && (
          <span className="text-panel-status text-muted">
            cycle {state.cycle.toLocaleString('en-US')} · {alive} alive
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {open && (
            <Toggle
              pressed={lock}
              onPressedChange={setLock}
              title="keep the view on the followed process's IP"
            >
              lock on ip
            </Toggle>
          )}
          <IconButton
            icon={open ? ChevronDown : ChevronUp}
            size="sm"
            label={open ? 'fold the arena strip' : 'open the arena strip'}
            pressed={open}
            onClick={() => onOpen(!open)}
          />
        </div>
      </header>
      {open && (
        <div className="relative min-h-0 flex-1">
          {source === null ? (
            <p className="p-2 text-data text-muted">load a bot to see the arena.</p>
          ) : (
            <ArenaCanvas
              ref={canvas}
              client={source}
              label="debug arena"
              className="size-full rounded-b-md"
            />
          )}
        </div>
      )}
    </section>
  )
}
