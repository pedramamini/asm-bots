import { Chip, IconButton } from '@asmbots/ui'
import { Camera, Map as MapIcon, Maximize, Minimize, Video, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { SoundButton } from '../../sound/SoundButton'
import { RendererChip, useArenaCanvas } from '../ArenaCanvas'
import { MAX_ZOOM, MIN_ZOOM } from '../render/camera'
import type { ArenaClient } from '../worker/client'
import { useZoom } from './hooks'
import { speedLabel } from './speed'
import { recordingLabel } from './video'

export interface HudProps {
  client: Pick<ArenaClient, 'store'>
  /** The frame rate while playing, else null. */
  fps: number | null
  minimap: boolean
  onMinimap: (on: boolean) => void
  fullscreen: boolean
  onFullscreen: () => void
  onScreenshot: () => void
  /** When the video's recording started (`performance.now()`), or null when none is under way. */
  recording?: number | null | undefined
  /** Starts or stops the video (`v`). None where the browser cannot record: no button. */
  onRecord?: (() => void) | undefined
}

const count = (n: number) => n.toLocaleString('en-US')

/** A zoom as the HUD shows it: `1x`, `2.4x`. */
export function zoomLabel(zoom: number): string {
  return `${Number(zoom.toFixed(zoom < 10 ? 1 : 0))}x`
}

/** The HUD's band over the arena, CSS px: the core fits under it, so the HUD hides none of it. */
export const HUD_BAND = 36
/** The band under `md`, where the chips take a second row under the controls. */
export const HUD_BAND_NARROW = 62

/**
 * The arena's HUD (PRODUCT_SPEC §2), in a band over the core: on the left the cycle, the speed,
 * the frame rate, and the zoom; on the right zoom in and out, the minimap, sound (`m`), fullscreen
 * (`f`), the screenshot (`s`), and the video (`v`), whose `rec` chip counts on the left while it
 * records. The controls sit on a panel: paper's dark text would vanish on black. Under `md` the
 * chips drop to a row under the controls, without the frame rate and the zoom.
 */
export function Hud({
  client,
  fps,
  minimap,
  onMinimap,
  fullscreen,
  onFullscreen,
  onScreenshot,
  recording = null,
  onRecord,
}: HudProps) {
  const { camera } = useArenaCanvas()
  const zoom = useZoom(camera)
  const cycle = useStore(client.store, (state) => state.cycle)
  const maxCycles = useStore(client.store, (state) => state.config?.maxCycles ?? 0)
  const speed = useStore(client.store, (state) => state.speed)
  return (
    <>
      <div className="pointer-events-none absolute top-2.5 left-14 flex gap-1 max-md:top-9">
        <Chip className="text-text">
          cycle {count(cycle)} / {count(maxCycles)}
        </Chip>
        <Chip title="cycles per frame">{speedLabel(speed)}</Chip>
        {fps !== null && (
          <Chip variant={fps < 50 ? 'warn' : 'neutral'} className="max-md:hidden">
            {Math.round(fps)} fps
          </Chip>
        )}
        <Chip className="max-md:hidden">zoom {zoomLabel(zoom)}</Chip>
        <RendererChip />
        {recording !== null && <RecChip since={recording} />}
      </div>
      {/* A press here is the control's, not the start of a drag on the arena under it. */}
      <div
        role="toolbar"
        aria-label="arena view"
        className="absolute top-1 right-1 flex gap-1 rounded-md bg-panel p-1"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <IconButton
          size="sm"
          icon={ZoomIn}
          label="zoom in"
          shortcut="+"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => camera.zoomBy(2)}
        />
        <IconButton
          size="sm"
          icon={ZoomOut}
          label="zoom out"
          shortcut="-"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => camera.zoomBy(0.5)}
        />
        <IconButton
          size="sm"
          icon={MapIcon}
          label="minimap"
          pressed={minimap}
          onClick={() => onMinimap(!minimap)}
        />
        <SoundButton size="sm" />
        <IconButton
          size="sm"
          icon={fullscreen ? Minimize : Maximize}
          label={fullscreen ? 'leave fullscreen' : 'fullscreen'}
          shortcut="f"
          onClick={onFullscreen}
        />
        <IconButton
          size="sm"
          icon={Camera}
          label="screenshot"
          shortcut="s"
          onClick={onScreenshot}
        />
        {onRecord !== undefined && (
          <IconButton
            size="sm"
            icon={Video}
            label={recording === null ? 'record video' : 'stop and save the video'}
            shortcut="v"
            pressed={recording !== null}
            onClick={onRecord}
          />
        )}
      </div>
    </>
  )
}

/** `● rec 0:07`: the video records, this long so far. */
function RecChip({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [])
  return (
    <Chip variant="danger" role="status" aria-label="recording video">
      ● rec {recordingLabel(now - since)}
    </Chip>
  )
}
