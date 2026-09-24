/**
 * The bracket (PRODUCT_SPEC §4): `@asmbots/tourney`'s `bracketSvg` in the page's theme, in a box
 * that pans and zooms. It opens fitted to the box. A drag pans; Ctrl or ⌘ with the wheel (a
 * trackpad's pinch) zooms at the pointer; `+`, `-`, and `fit` do the same from buttons. The
 * matches in flight pulse, unless motion is reduced. A click on a match, or Enter or Space on one
 * focused, selects it.
 */
import { type Bracket, bracketSvg } from '@asmbots/tourney'
import { cx, IconButton, vars } from '@asmbots/ui'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMotionReduced, useSettings } from '../../store/settings'
import { themePalette } from './export'

export interface BracketSvgProps {
  bracket: Bracket
  /** The ids of the matches being played now. */
  live?: readonly number[] | undefined
  /** The id of the match chosen, or null. */
  selected: number | null
  onSelect: (id: number) => void
  className?: string | undefined
}

/** The zoom's range. */
const MIN_SCALE = 0.25
const MAX_SCALE = 3
/** A press that moves farther than this, px, is a drag, not a click. */
const DRAG = 4
/** The box's tallest, px, before the bracket is fitted into it. */
const MAX_HEIGHT = 640

interface View {
  readonly scale: number
  readonly x: number
  readonly y: number
}

const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** The size the SVG string says it is. */
function svgSize(svg: string): { width: number; height: number } {
  const width = Number(/ width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0)
  const height = Number(/ height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0)
  return { width, height }
}

/** The match id on or around `target`, or null. */
function matchAt(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null
  const id = target.closest('[data-match-id]')?.getAttribute('data-match-id')
  return id == null ? null : Number(id)
}

export function BracketSvg({ bracket, live, selected, onSelect, className }: BracketSvgProps) {
  const theme = useSettings((state) => state.theme)
  const reduced = useMotionReduced()
  // `theme` is not read, but the tokens the palette resolves change with it.
  const palette = useMemo(() => ({ ...themePalette(), background: 'none' }), [theme])
  const svg = useMemo(
    () => bracketSvg(bracket, { palette, live, selected, interactive: true }),
    [bracket, palette, live, selected],
  )
  const { width, height } = svgSize(svg)
  const box = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const press = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null)
  const dragged = useRef(false)
  /** The match to give the focus back to once the SVG is drawn again. */
  const refocus = useRef<number | null>(null)

  const fit = useCallback(() => {
    const el = box.current
    if (el === null || el.clientWidth === 0 || width === 0) {
      setView({ scale: 1, x: 0, y: 0 })
      return
    }
    const scale = clamp(Math.min(1, el.clientWidth / width, el.clientHeight / height))
    setView({ scale, x: (el.clientWidth - width * scale) / 2, y: 0 })
  }, [width, height])

  // Fitted when the bracket's size changes, not on every save.
  useLayoutEffect(() => {
    fit()
  }, [fit])

  useLayoutEffect(() => {
    if (refocus.current === null) return
    const g = content.current?.querySelector<SVGGElement>(`[data-match-id="${refocus.current}"]`)
    g?.focus()
    refocus.current = null
  })

  /** Zooms by `factor` about the box point (`px`, `py`). */
  const zoom = useCallback((factor: number, px?: number, py?: number) => {
    setView((v) => {
      const el = box.current
      const cx0 = px ?? (el?.clientWidth ?? 0) / 2
      const cy0 = py ?? (el?.clientHeight ?? 0) / 2
      const scale = clamp(v.scale * factor)
      const k = scale / v.scale
      return { scale, x: cx0 - (cx0 - v.x) * k, y: cy0 - (cy0 - v.y) * k }
    })
  }, [])

  // A native listener: React's wheel listener is passive and cannot keep the page from zooming.
  useEffect(() => {
    const el = box.current
    if (el === null) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      zoom(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom])

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    press.current = { x: event.clientX, y: event.clientY, view, moved: false }
    dragged.current = false
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const p = press.current
    if (p === null) return
    const dx = event.clientX - p.x
    const dy = event.clientY - p.y
    if (!p.moved && Math.hypot(dx, dy) < DRAG) return
    if (!p.moved) event.currentTarget.setPointerCapture?.(event.pointerId)
    p.moved = true
    setView({ ...p.view, x: p.view.x + dx, y: p.view.y + dy })
  }
  const onPointerUp = () => {
    dragged.current = press.current?.moved ?? false
    press.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const id = matchAt(event.target)
    if (id === null) return
    event.preventDefault()
    refocus.current = id
    onSelect(id)
  }

  return (
    <div className={cx('relative flex flex-col', className)}>
      <section
        ref={box}
        aria-label="bracket"
        data-scale={view.scale.toFixed(2)}
        style={vars({ '--bracket-h': `${Math.min(height, MAX_HEIGHT)}px` })}
        className={cx(
          'relative h-(--bracket-h) cursor-grab touch-none overflow-hidden rounded-md border border-border bg-panel-2 select-none active:cursor-grabbing',
          '[&_[data-match-id]]:outline-none [&_[data-match-id]:focus-visible>rect]:stroke-accent',
          !reduced && '[&_[data-live]]:animate-skeleton',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(event) => {
          if (dragged.current) return
          const id = matchAt(event.target)
          if (id !== null) onSelect(id)
        }}
        onKeyDown={onKeyDown}
      >
        <div
          ref={content}
          style={vars({
            '--bx': `${view.x}px`,
            '--by': `${view.y}px`,
            '--bs': view.scale,
          })}
          className="absolute top-0 left-0 origin-top-left translate-x-(--bx) translate-y-(--by) scale-(--bs)"
          // bracketSvg escapes every name, so the string is safe markup.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </section>
      <div className="absolute top-1 right-1 flex gap-1 rounded-sm bg-panel/80">
        <IconButton icon={ZoomOut} label="zoom out" onClick={() => zoom(1 / 1.25)} />
        <IconButton icon={ZoomIn} label="zoom in" onClick={() => zoom(1.25)} />
        <IconButton icon={Maximize} label="fit" onClick={fit} />
      </div>
    </div>
  )
}
