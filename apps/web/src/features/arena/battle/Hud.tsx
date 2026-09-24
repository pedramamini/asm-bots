import { Chip, IconButton } from '@asmbots/ui'
import { Camera, Map as MapIcon, Maximize, Minimize, ZoomIn, ZoomOut } from 'lucide-react'
import { useStore } from 'zustand'
import { RendererChip, useArenaCanvas } from '../ArenaCanvas'
import { MAX_ZOOM, MIN_ZOOM } from '../render/camera'
import type { ArenaClient } from '../worker/client'
import { useZoom } from './hooks'
import { speedLabel } from './speed'

export interface HudProps {
  client: Pick<ArenaClient, 'store'>
  /** The frame rate while playing, else null. */
  fps: number | null
  minimap: boolean
  onMinimap: (on: boolean) => void
  fullscreen: boolean
  onFullscreen: () => void
  onScreenshot: () => void
}

const count = (n: number) => n.toLocaleString('en-US')

/** A zoom as the HUD shows it: `1x`, `2.4x`. */
export function zoomLabel(zoom: number): string {
  return `${Number(zoom.toFixed(zoom < 10 ? 1 : 0))}x`
}

/** The HUD's band over the arena, CSS px: the core fits under it, so the HUD hides none of it. */
export const HUD_BAND = 36

/**
 * The arena's HUD (PRODUCT_SPEC §2), in a band over the core: on the left the cycle, the speed,
 * the frame rate, and the zoom; on the right zoom in and out, the minimap, fullscreen (`f`), and
 * the screenshot (`s`). The controls sit on a panel: paper's dark text would vanish on black.
 */
export function Hud({
  client,
  fps,
  minimap,
  onMinimap,
  fullscreen,
  onFullscreen,
  onScreenshot,
}: HudProps) {
  const { camera } = useArenaCanvas()
  const zoom = useZoom(camera)
  const cycle = useStore(client.store, (state) => state.cycle)
  const maxCycles = useStore(client.store, (state) => state.config?.maxCycles ?? 0)
  const speed = useStore(client.store, (state) => state.speed)
  return (
    <>
      <div className="pointer-events-none absolute top-2.5 left-14 flex gap-1">
        <Chip className="text-text">
          cycle {count(cycle)} / {count(maxCycles)}
        </Chip>
        <Chip title="cycles per frame">{speedLabel(speed)}</Chip>
        {fps !== null && <Chip variant={fps < 50 ? 'warn' : 'neutral'}>{Math.round(fps)} fps</Chip>}
        <Chip>zoom {zoomLabel(zoom)}</Chip>
        <RendererChip />
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
      </div>
    </>
  )
}
