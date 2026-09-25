/**
 * The 404 page's imp: the roster's imp alone in the arena, placed at 0x0404 (the page's own
 * address), walking the core a byte a cycle for a lap, then again (`DemoLoop`). The view fits the
 * core's 256 columns to its width and keeps the imp's row in sight. It pauses out of sight and
 * makes no sound; under reduced motion it stands still, `IMP_STILL_CYCLE` cycles in.
 */
import { rosterImage } from '@asmbots/bots'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useMotionReduced } from '../../../store/settings'
import { ArenaCanvas, type ArenaCanvasHandle } from '../ArenaCanvas'
import { type Camera, MAX_ZOOM, MIN_ZOOM } from '../render/camera'
import { SIDE } from '../render/scene'
import { ArenaClient, createArenaStore } from '../worker/client'
import type { ArenaBot, Speed } from '../worker/protocol'
import { DemoLoop, stillFrame } from './demo'
import { useSeen } from './seen'

/** Where the imp is placed: the 404 page's address. */
export const IMP_ADDRESS = 0x0404
/** The seed that places the imp there (`place` of its bytes; a test holds it to that). */
export const IMP_SEED = 182_052
/** Cycles per frame: at 60 fps the imp walks 120 bytes a second, a row of the core in 2 s. */
export const IMP_SPEED: Speed = 2
/** A battle's cycles: one lap of the core, then the imp starts over at 0x0404. */
export const IMP_LAP = 65_536
/** Where the still stands under reduced motion: the imp's trail a row and a half long. */
export const IMP_STILL_CYCLE = 400

/** The roster's imp, as the Worker loads it. */
export function impBot(): ArenaBot {
  const { name, author, strategy, version, bytes } = rosterImage('imp')
  return { name, bytes, meta: { author, strategy, version } }
}

/** The zoom at which the core's 256 columns fit across a view `width` x `height` px: 1..16. */
export function impZoom(width: number, height: number): number {
  if (width <= 0 || height <= 0) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(width / height)))
}

/**
 * Zooms `camera` to fit the core's width, and centers it on the row of address `ip`. False when
 * the camera has no size yet, and nothing moved.
 */
export function followImp(camera: Camera, ip: number): boolean {
  const { width, height } = camera.view
  if (width <= 0 || height <= 0) return false
  const zoom = impZoom(width, height)
  if (camera.zoom !== zoom) camera.zoomBy(zoom / camera.zoom)
  camera.centerOn(SIDE / 2, (ip >> 8) + 0.5)
  return true
}

/**
 * Keeps `canvas`'s camera on the imp's row as `client`'s frames move it (every 128 frames at
 * `IMP_SPEED`), and when the canvas gets its size or a new one.
 */
function useFollowImp(canvas: RefObject<ArenaCanvasHandle | null>, client: ArenaClient | null) {
  useEffect(() => {
    const camera = canvas.current?.camera
    if (client === null || camera === undefined) return
    let ip: number | null = null
    let row = -1
    const follow = () => {
      if (ip === null) return
      if (ip >> 8 === row && camera.zoom === impZoom(camera.view.width, camera.view.height)) return
      // Before the move: the camera's own change comes back here, and must find it done.
      row = ip >> 8
      if (!followImp(camera, ip)) row = -1
    }
    const offFrame = client.on('frame', (frame) => {
      ip = frame.ips[0] ?? ip
      follow()
    })
    const offCamera = camera.subscribe(follow)
    return () => {
      offFrame()
      offCamera()
    }
  }, [canvas, client])
}

export interface LiveImpProps {
  /** Makes the imp's client. Default: an `ArenaClient` with a store of its own. */
  createClient?: (() => ArenaClient) | undefined
}

const newClient = () => new ArenaClient({ store: createArenaStore() })

/** The imp in the arena, walking; standing still under reduced motion. It fills its box. */
export function LiveImp({ createClient = newClient }: LiveImpProps) {
  const still = useMotionReduced()
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<ArenaCanvasHandle>(null)
  const make = useRef(createClient)
  const [client, setClient] = useState<ArenaClient | null>(null)
  const loop = useRef<DemoLoop | null>(null)
  const seen = useSeen(box)

  useEffect(() => {
    const made = make.current()
    const demo = still
      ? null
      : new DemoLoop(made, {
          bots: [impBot()],
          random: () => IMP_SEED,
          speed: IMP_SPEED,
          config: { maxCycles: IMP_LAP },
        })
    loop.current = demo
    setClient(made)
    if (demo === null) void stillFrame(made, [impBot()], IMP_SEED, IMP_STILL_CYCLE).catch(() => {})
    else demo.start()
    return () => {
      demo?.dispose()
      made.dispose()
      loop.current = null
      setClient(null)
    }
  }, [still])

  // Also after a new client: the loop starts as if seen.
  useEffect(() => {
    loop.current?.setVisible(seen)
  }, [seen, client])

  useFollowImp(canvas, client)

  return (
    <div ref={box} className="absolute inset-0" data-imp={still ? 'still' : 'live'}>
      {client !== null && (
        <ArenaCanvas
          ref={canvas}
          client={client}
          interactive={false}
          minimap={false}
          label={
            still
              ? `an imp at cycle ${IMP_STILL_CYCLE}: it moved in at 0x0404, and copies itself one word ahead`
              : 'a live imp: it moved in at 0x0404, and copies itself one word ahead, forever'
          }
          className="size-full"
        />
      )}
    </div>
  )
}
