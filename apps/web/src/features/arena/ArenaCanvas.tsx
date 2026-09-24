import { Chip, cx } from '@asmbots/ui'
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMotionReduced, useSettings } from '../../store/settings'
import { HoverTip } from './battle/HoverTip'
import { Camera } from './render/camera'
import { createCanvas2dRenderer } from './render/canvas2d'
import { createGlRenderer } from './render/gl'
import { RulerOverlay } from './render/overlay'
import { ArenaScene } from './render/scene'
import type { ArenaRenderer, RendererKind } from './render/types'
import type { ArenaClient } from './worker/client'

/** Zoom per px of wheel travel: a mouse notch (100 px) zooms about 1.2x. */
const WHEEL_ZOOM = 0.002
/** An arrow key pans this share of the view. */
const ARROW_PAN = 0.1

/** What the canvas needs of an `ArenaClient`: its frames, and a way to ask for the whole core. */
export type FrameSource = Pick<ArenaClient, 'on' | 'store' | 'seek'>

/** The canvas's parts, for the HUD, the screenshot, and tests. */
export interface ArenaCanvasHandle {
  readonly scene: ArenaScene
  readonly camera: Camera
  /** The renderer drawing, once the canvas is laid out. */
  readonly renderer: ArenaRenderer | null
  /** The canvas it draws on. */
  readonly canvas: HTMLCanvasElement | null
  /** The canvas of the rulers and the hover crosshair, over it. */
  readonly overlay: HTMLCanvasElement | null
}

/** What the arena's children (the HUD) read of it. */
export interface ArenaCanvasParts {
  readonly scene: ArenaScene
  readonly camera: Camera
  /** How it draws: WebGL2, or the 2D fallback. */
  readonly kind: RendererKind
}

const PartsContext = createContext<ArenaCanvasParts | null>(null)

/** The arena around the calling component: its scene, camera, and renderer kind. */
export function useArenaCanvas(): ArenaCanvasParts {
  const parts = useContext(PartsContext)
  if (parts === null) throw new Error('useArenaCanvas needs an <ArenaCanvas> around it')
  return parts
}

/** Where the pointer rests over the core: the byte, and the pointer, CSS px in the arena. */
interface Hover {
  readonly address: number
  readonly x: number
  readonly y: number
}

export interface ArenaCanvasProps extends Omit<ComponentProps<'div'>, 'ref'> {
  /** The battle to draw: each frame of its Worker. */
  client: FrameSource
  /** `auto` draws with WebGL2 where it can, else 2D; `2d` never tries WebGL2. Read once. */
  renderer?: 'auto' | '2d' | undefined
  /** Whether the minimap shows when zoomed in (the HUD's toggle). */
  minimap?: boolean | undefined
  /** The bots isolated: the rest dim (PRODUCT_SPEC §2). None: every bot as it is. */
  isolated?: readonly number[] | undefined
  /** Whether a pointer resting on a byte shows the crosshair and the byte's tooltip. */
  hover?: boolean | undefined
  /**
   * Whether the camera takes the wheel, drags, and keys. False: the arena is a picture (the home
   * page's demo), `role="img"`, out of the tab order, and the wheel scrolls the page past it.
   */
  interactive?: boolean | undefined
  /** A band this tall, CSS px, over the core for the HUD's row: the core fits under it. */
  insetTop?: number | undefined
  /** The arena's accessible name. */
  label?: string | undefined
  ref?: Ref<ArenaCanvasHandle> | undefined
}

/**
 * The arena (DESIGN_SYSTEM §5): the renderer on a canvas that fills the box, and the rulers on a
 * canvas over it. It draws `client`'s frames each display frame, in the theme and effects of the
 * settings. The camera: the wheel zooms at the cursor, a drag pans, a press on the minimap moves
 * the view there, and with the arena focused the arrows pan, `+` and `-` zoom, and `0` resets. A
 * pointer resting on a byte draws a crosshair through it and a tooltip of what it holds. Where
 * WebGL2 is missing it draws in 2D, and a `2D` chip says so. `children` lie over the arena: the
 * HUD, which then shows the chip, and reads the arena through `useArenaCanvas`. With
 * `interactive={false}` it is a picture that takes none of this: the home page's demo.
 */
export function ArenaCanvas({
  client,
  renderer: want = 'auto',
  minimap = true,
  isolated,
  hover: hoverWanted = true,
  interactive = true,
  insetTop = 0,
  label = 'arena',
  ref,
  className,
  children,
  ...rest
}: ArenaCanvasProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; minimap: boolean } | null>(null)
  const [scene] = useState(() => new ArenaScene(performance.now()))
  const [camera] = useState(() => new Camera())
  const [mode, setMode] = useState<RendererKind>(want === '2d' ? '2d' : 'webgl2')
  const [renderer, setRenderer] = useState<ArenaRenderer | null>(null)
  const [overlay, setOverlay] = useState<RulerOverlay | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const theme = useSettings((state) => state.theme)
  const effects = useSettings((state) => state.effects)
  const reduced = useMotionReduced()
  const hovers = hoverWanted && interactive
  const isolation = isolated?.join(',') ?? ''
  const parts = useMemo(() => ({ scene, camera, kind: mode }), [scene, camera, mode])

  useImperativeHandle(
    ref,
    () => ({ scene, camera, renderer, canvas: canvasRef.current, overlay: overlayRef.current }),
    [scene, camera, renderer],
  )

  // The renderer, made again on the new canvas when WebGL2 fails and the arena falls back to 2D.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const { theme, effects } = useSettings.getState()
    const options = { scene, camera, theme, effects }
    let made: ArenaRenderer | null
    if (mode === 'webgl2') {
      try {
        made = createGlRenderer(canvas, options)
      } catch (error) {
        console.warn('arena: WebGL2 failed, drawing in 2D', error)
        made = null
      }
      if (made === null) {
        setMode('2d')
        return
      }
    } else {
      made = createCanvas2dRenderer(canvas, options)
      if (made === null) return
    }
    const current = made
    setRenderer(current)
    return () => {
      current.dispose()
      setRenderer(null)
    }
  }, [mode, scene, camera])

  useLayoutEffect(() => {
    const canvas = overlayRef.current
    if (canvas === null) return
    const made = new RulerOverlay(canvas, camera, useSettings.getState().theme)
    setOverlay(made)
    // The rulers' type is a web font: draw them again once it is in.
    void document.fonts?.ready.then(() => made.invalidate())
  }, [camera])

  useEffect(() => {
    renderer?.setTheme(theme)
    overlay?.setTheme(theme)
  }, [renderer, overlay, theme])

  useEffect(() => {
    renderer?.setEffects(effects)
  }, [renderer, effects])

  useEffect(() => {
    renderer?.setMinimap(minimap)
  }, [renderer, minimap])

  useEffect(() => {
    scene.reducedMotion = reduced
    renderer?.invalidate()
  }, [scene, renderer, reduced])

  useEffect(() => {
    scene.isolate(isolation === '' ? null : isolation.split(',').map(Number))
    renderer?.invalidate()
  }, [scene, renderer, isolation])

  useEffect(() => {
    overlay?.setHover(hover?.address ?? null)
  }, [overlay, hover])

  useLayoutEffect(() => {
    camera.setInsetTop(insetTop)
  }, [camera, insetTop])

  useEffect(() => {
    const off = client.on('frame', (frame) => scene.apply(frame))
    // A battle loaded before the canvas mounted: a seek to where it stands sends the whole core.
    const { status, cycle } = client.store.getState()
    if (status === 'paused' || status === 'playing' || status === 'ended') client.seek(cycle)
    return off
  }, [client, scene])

  // Size, then a draw each display frame: the renderer skips the frames where nothing moved.
  useLayoutEffect(() => {
    const node = box.current
    if (node === null || renderer === null || overlay === null) return
    let ratio = 0
    const measure = () => {
      ratio = window.devicePixelRatio || 1
      const width = node.clientWidth
      const height = node.clientHeight
      camera.resize(width, height)
      renderer.resize(width, height, ratio)
      overlay.resize(width, height, ratio)
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    let id = 0
    const tick = (now: number) => {
      if ((window.devicePixelRatio || 1) !== ratio) measure()
      renderer.render(now)
      overlay.render()
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(id)
      observer?.disconnect()
    }
  }, [renderer, overlay, camera])

  // The wheel: a native listener, since React's is passive and cannot keep the page from scrolling.
  useEffect(() => {
    const node = box.current
    if (node === null || !interactive) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      camera.zoomBy(
        Math.exp(-event.deltaY * unit * WHEEL_ZOOM),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [camera, interactive])

  // The cursor says what a drag does: `grab` once zoomed in.
  useEffect(() => {
    const node = box.current
    if (node === null) return
    const show = () => {
      node.dataset.zoomed = String(camera.zoom > 1)
    }
    show()
    return camera.subscribe(show)
  }, [camera])

  const at = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const { x, y } = at(event)
    const cell = camera.minimapCell(x, y)
    if (cell !== null) camera.centerOn(cell[0], cell[1])
    drag.current = { id: event.pointerId, x, y, minimap: cell !== null }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = 'true'
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d === null || d.id !== event.pointerId) {
      if (d === null) hoverAt(event)
      return
    }
    const { x, y } = at(event)
    if (d.minimap) {
      const cell = camera.minimapCell(x, y, true)
      if (cell !== null) camera.centerOn(cell[0], cell[1])
    } else {
      camera.panBy(x - d.x, y - d.y)
    }
    d.x = x
    d.y = y
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    delete event.currentTarget.dataset.dragging
  }

  /** The byte under a mouse or a pen, off the minimap and the HUD: the crosshair's, the tip's. */
  const hoverAt = (event: PointerEvent<HTMLDivElement>) => {
    if (!hovers || event.pointerType === 'touch') return
    if (!(event.target instanceof HTMLCanvasElement)) {
      setHover(null)
      return
    }
    const { x, y } = at(event)
    const address = camera.minimapCell(x, y) === null ? camera.addressAt(x, y) : null
    setHover((last) =>
      address === null
        ? null
        : last?.address === address && last.x === x && last.y === y
          ? last
          : { address, x, y },
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const view = camera.view
    const step = Math.max(view.width, view.height) * ARROW_PAN
    switch (event.key) {
      case 'ArrowLeft':
        camera.panBy(step, 0)
        break
      case 'ArrowRight':
        camera.panBy(-step, 0)
        break
      case 'ArrowUp':
        camera.panBy(0, step)
        break
      case 'ArrowDown':
        camera.panBy(0, -step)
        break
      case '+':
      case '=':
        camera.zoomBy(2)
        break
      case '-':
      case '_':
        camera.zoomBy(0.5)
        break
      case '0':
        camera.reset()
        break
      default:
        return
    }
    event.preventDefault()
  }

  const layers = (
    <>
      <canvas key={mode} ref={canvasRef} className="absolute inset-0 size-full" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full" />
      <PartsContext value={parts}>
        {children ?? (mode === '2d' && <RendererChip className="absolute top-2 right-2" />)}
        {hover !== null && (
          <HoverTip
            client={client}
            scene={scene}
            address={hover.address}
            x={hover.x}
            y={hover.y}
            width={camera.width}
            height={camera.height}
          />
        )}
      </PartsContext>
    </>
  )
  const isolatedBots = isolation === '' ? undefined : isolation

  if (!interactive) {
    return (
      <div
        {...rest}
        ref={box}
        role="img"
        aria-label={label}
        data-renderer={renderer?.kind}
        data-isolated={isolatedBots}
        className={cx('relative overflow-hidden bg-arena-bg select-none', className)}
      >
        {layers}
      </div>
    )
  }
  return (
    <div
      {...rest}
      ref={box}
      role="application"
      aria-roledescription="arena map"
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a pan-and-zoom surface that the keyboard drives.
      tabIndex={0}
      data-renderer={renderer?.kind}
      className={cx(
        'relative touch-none overflow-hidden bg-arena-bg select-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent data-[dragging=true]:cursor-grabbing data-[zoomed=true]:cursor-grab',
        className,
      )}
      data-isolated={isolatedBots}
      onPointerDown={(event) => {
        setHover(null)
        onPointerDown(event)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      {layers}
    </div>
  )
}

/** The `2D` chip: the arena draws without WebGL2, so without bloom. Nothing under WebGL2. */
export function RendererChip({ className }: { className?: string | undefined }) {
  const { kind } = useArenaCanvas()
  if (kind !== '2d') return null
  return (
    <Chip
      className={cx('pointer-events-none', className)}
      title="no WebGL2 here: the arena draws in 2D, without bloom"
    >
      2D
    </Chip>
  )
}
