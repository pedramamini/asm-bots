/**
 * The arena alone on a page, for the Playwright specs (`arena-render.spec.ts`, `arena-perf.spec.ts`):
 * `ArenaCanvas` in a fixed box, driven by a real `ArenaClient` and its Worker, and `window.harness`
 * to reach in. Only the dev server serves it (`/e2e/harness/arena.html`); no build includes it.
 */
import '../../src/styles.css'
import { initTheme } from '@asmbots/ui'
import { createRef, StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { ArenaCanvas, type ArenaCanvasHandle } from '../../src/features/arena/ArenaCanvas'
import { ArenaClient } from '../../src/features/arena/worker/client'
import type { ArenaBot, FrameMessage } from '../../src/features/arena/worker/protocol'
import { useSettings } from '../../src/store/settings'

initTheme()

export interface MountOptions {
  renderer?: 'auto' | '2d'
  /** The arena box, CSS px. */
  width?: number
  height?: number
  minimap?: boolean
}

/** A frame's parts, as plain lists: what a spec can pass through `page.evaluate`. */
export interface FrameSpec {
  cycle?: number
  /** Full frames: (address, owner tag) and (address, byte); the rest of the core is 0. */
  owner?: [number, number][]
  bytes?: [number, number][]
  /** Activity frames: (address, cell) and (address, bot). */
  writes?: [number, number][]
  execs?: [number, number][]
  /** (IP, bot | IP_FRONT). */
  ips?: [number, number][]
  /** (address, bot). */
  spawns?: [number, number][]
  deaths?: [number, number][]
  botDeaths?: number[]
}

let root: Root | null = null
const handle = createRef<ArenaCanvasHandle>()
const client = new ArenaClient()

function mount({
  renderer = 'auto',
  width = 800,
  height = 600,
  minimap = true,
}: MountOptions = {}) {
  root?.unmount()
  const node = document.getElementById('root') as HTMLElement
  root = createRoot(node)
  flushSync(() => {
    root?.render(
      <StrictMode>
        <div style={{ position: 'fixed', left: 0, top: 0, width, height }}>
          <ArenaCanvas
            ref={handle}
            client={client}
            renderer={renderer}
            minimap={minimap}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </StrictMode>,
    )
  })
}

/** The arena's parts, once it is laid out. */
function arena(): ArenaCanvasHandle {
  const h = handle.current
  if (h === null || h.renderer === null || h.canvas === null) throw new Error('arena not ready')
  return h
}

const pairs = (list: [number, number][] = []) => Uint16Array.from(list.flat())

/** A frame from plain lists: full when it has an owner map. */
function frame(spec: FrameSpec): FrameMessage {
  const full = spec.owner !== undefined || spec.bytes !== undefined
  let ownerDirty: Uint8Array | null = null
  let bytesDirty: Uint8Array | null = null
  if (full) {
    ownerDirty = new Uint8Array(0x10000)
    bytesDirty = new Uint8Array(0x10000)
    for (const [a, tag] of spec.owner ?? []) ownerDirty[a] = tag
    for (const [a, byte] of spec.bytes ?? []) bytesDirty[a] = byte
  }
  return {
    type: 'frame',
    cycle: spec.cycle ?? 0,
    alive: 2,
    over: false,
    writes: pairs(spec.writes),
    writeCycles: Uint32Array.from(
      (spec.writes ?? []).map(() => Math.max(0, (spec.cycle ?? 0) - 1)),
    ),
    execs: pairs(spec.execs),
    ips: pairs(spec.ips),
    spawns: Uint32Array.from((spec.spawns ?? []).flatMap(([a, bot]) => [0, bot, 0, a])),
    deaths: Uint32Array.from((spec.deaths ?? []).flatMap(([a, bot]) => [0, bot, 0, a, 1, 0])),
    botDeaths: Uint32Array.from((spec.botDeaths ?? []).flatMap((bot) => [0, bot, 1, 0])),
    stats: new Float32Array(0),
    firstBlood: null,
    keyframes: null,
    ownerDirty,
    bytesDirty,
  }
}

/** The center of byte `address`'s cell, CSS px from the arena's top-left. */
function cellCenter(address: number): [number, number] {
  const { camera } = arena()
  return [
    camera.originX + ((address & 0xff) + 0.5) * camera.cell,
    camera.originY + ((address >> 8) + 0.5) * camera.cell,
  ]
}

/**
 * Draws now, whatever changed, and reads the canvas at CSS points in the same task, before the
 * browser takes the image: RGBA each.
 */
function pixels(points: [number, number][], now = performance.now()): number[][] {
  const { renderer, canvas } = arena()
  renderer?.render(now, true)
  const target = canvas as HTMLCanvasElement
  const scratch = document.createElement('canvas')
  scratch.width = target.width
  scratch.height = target.height
  const ctx = scratch.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(target, 0, 0)
  const ratio = target.width / target.clientWidth
  return points.map(([x, y]) =>
    Array.from(ctx.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data),
  )
}

/** Loads bots and waits for the battle's first frame. */
async function load(bots: { name: string; bytes: number[] }[], config: Record<string, number>) {
  const loaded: ArenaBot[] = bots.map((b) => ({ name: b.name, bytes: new Uint8Array(b.bytes) }))
  const first = client.once('frame')
  client.load(loaded, config)
  await first
}

const harness = {
  mount,
  arena,
  client,
  settings: useSettings,
  frame,
  /** Hands the scene a frame, as the client would. */
  apply: (spec: FrameSpec) => arena().scene.apply(frame(spec)),
  /** Isolates `bots`, as the battle's rail does: the rest dims. */
  isolate: (bots: number[]) => {
    const { scene, renderer } = arena()
    scene.isolate(bots)
    renderer?.invalidate()
  },
  cellCenter,
  pixels,
  load,
}

declare global {
  interface Window {
    harness: typeof harness
  }
}

window.harness = harness
