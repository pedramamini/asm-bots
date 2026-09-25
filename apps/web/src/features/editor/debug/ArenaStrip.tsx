import { Toggle } from '@asmbots/ui'
import { type RefObject, useEffect, useState } from 'react'
import { ArenaCanvas, type ArenaCanvasHandle } from '../../arena/ArenaCanvas'
import { MAX_ZOOM } from '../../arena/render/camera'
import { TileFrame } from '../layout/TileFrame'
import type { DebugSession, DebugState } from './session'
import { BattleSource } from './source'

export interface ArenaStripProps {
  session: DebugSession | null
  state: DebugState | null
  /** Whether the strip is on the page: hidden, it draws nothing. */
  open: boolean
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
 * IP, zoomed in. Hidden (the layout's), it draws nothing.
 */
export function ArenaStrip({ session, state, open, canvas, className }: ArenaStripProps) {
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
    <TileFrame
      label="arena strip"
      title="arena"
      status={
        state === null ? undefined : `cycle ${state.cycle.toLocaleString('en-US')} · ${alive} alive`
      }
      actions={
        <Toggle
          pressed={lock}
          onPressedChange={setLock}
          title="keep the view on the followed process's IP"
        >
          lock on ip
        </Toggle>
      }
      className={className}
    >
      {!open ? null : source === null ? (
        <p className="p-2 text-data text-muted">load a bot to see the arena.</p>
      ) : (
        <ArenaCanvas
          ref={canvas}
          client={source}
          label="debug arena"
          className="size-full rounded-b-md"
        />
      )}
    </TileFrame>
  )
}
