import {
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react'
import { cx, vars } from '../style'

/** A persisted ratio lives in `localStorage[SPLIT_STORAGE_PREFIX + storageKey]`. */
export const SPLIT_STORAGE_PREFIX = 'split:'
/** How far an arrow key moves the divider, as a share of the space, and with Shift. */
const STEP = 0.02
const BIG_STEP = 0.1

export interface SplitPaneProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The two panes: left and right in a row, top and bottom in a column. */
  children: readonly [ReactNode, ReactNode]
  /** The divider's accessible name, after what it sizes: "editor width". */
  label: string
  /** `row` sets the panes side by side, `column` stacks them. */
  direction?: 'row' | 'column' | undefined
  /** The first pane's share of the space, 0..1, until the user moves the divider. */
  defaultRatio?: number | undefined
  /** The first pane's smallest share. */
  min?: number | undefined
  /** The first pane's largest share. */
  max?: number | undefined
  /** Keeps the ratio across visits, in `localStorage` under `split:<storageKey>`. */
  storageKey?: string | undefined
  /**
   * The second pane folds to its own size (a title row) and the first takes the rest; the
   * divider goes. The ratio stays for when it opens again, and neither pane mounts anew.
   */
  collapsed?: boolean | undefined
}

/**
 * Two panes with a divider between them (the WAI-ARIA window splitter). Drag the divider, or focus
 * it and use the arrow keys (Shift for bigger steps), Home, and End. The divider is a 12 px
 * gutter, the grid's; its grip spans the gutter on hover and turns accent on focus and while it is
 * dragged. A drag leaves focus and the selection where they were. The ratio is the first pane's
 * share of the space beside the gutter; with `storageKey` it persists.
 */
export function SplitPane({
  children: [first, second],
  label,
  direction = 'row',
  defaultRatio = 0.5,
  min = 0.1,
  max = 0.9,
  storageKey,
  collapsed = false,
  className,
  style,
  ...rest
}: SplitPaneProps) {
  const firstId = useId()
  const row = direction === 'row'
  const [ratio, setRatio] = useState(() => clamp(readRatio(storageKey) ?? defaultRatio, min, max))
  /** The dragging pointer, and where it holds the divider: px from the divider's center. */
  const drag = useRef<{ readonly pointerId: number; readonly offset: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const resize = (next: number) => {
    const value = clamp(next, min, max)
    setRatio(value)
    writeRatio(storageKey, value)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget.getBoundingClientRect()
    const center = row ? handle.left + handle.width / 2 : handle.top + handle.height / 2
    const offset = (row ? event.clientX : event.clientY) - center
    drag.current = { pointerId: event.pointerId, offset }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const grab = drag.current
    const container = event.currentTarget.parentElement
    if (grab?.pointerId !== event.pointerId || container === null) return
    const box = container.getBoundingClientRect()
    const handle = event.currentTarget.getBoundingClientRect()
    const gutter = row ? handle.width : handle.height
    const space = (row ? box.width : box.height) - gutter
    if (space <= 0) return
    const center = (row ? event.clientX - box.left : event.clientY - box.top) - grab.offset
    resize((center - gutter / 2) / space)
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const moves: Readonly<Record<string, number>> = {
      [row ? 'ArrowLeft' : 'ArrowUp']: ratio - step,
      [row ? 'ArrowRight' : 'ArrowDown']: ratio + step,
      Home: min,
      End: max,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    resize(next)
  }

  return (
    <div
      {...rest}
      className={cx(
        'flex min-h-0 min-w-0',
        row ? 'flex-row' : 'flex-col',
        dragging && (row ? 'cursor-col-resize select-none' : 'cursor-row-resize select-none'),
        className,
      )}
      style={{ ...style, ...vars({ '--split': String(ratio) }) }}
    >
      <div
        id={firstId}
        className={
          collapsed
            ? 'min-h-0 min-w-0 flex-1 overflow-auto'
            : 'min-h-0 min-w-0 shrink-0 grow-0 basis-[calc((100%-var(--space-3))*var(--split))] overflow-auto'
        }
      >
        {first}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable window splitter, not a thematic break. */}
      <div
        hidden={collapsed || undefined}
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-controls={firstId}
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-valuenow={percent(ratio)}
        aria-valuemin={percent(min)}
        aria-valuemax={percent(max)}
        data-dragging={dragging || undefined}
        className={cx(
          'group/split flex shrink-0 touch-none items-center justify-center outline-none',
          row ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <span
          className={cx(
            'bg-border-strong transition-[width,height,background-color] duration-120 ease-out motion-reduce:transition-none group-focus-visible/split:bg-accent group-data-dragging/split:bg-accent',
            row
              ? 'h-6 w-px group-hover/split:h-full group-focus-visible/split:h-full group-data-dragging/split:h-full'
              : 'h-px w-6 group-hover/split:w-full group-focus-visible/split:w-full group-data-dragging/split:w-full',
          )}
        />
      </div>
      <div className={cx('min-h-0 min-w-0', collapsed ? 'shrink-0' : 'flex-1 overflow-auto')}>
        {second}
      </div>
    </div>
  )
}

/** `value` held to `min..max` and rounded to 4 places, so that steps do not drift. */
function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 10_000) / 10_000
}

function percent(ratio: number): number {
  return Math.round(ratio * 100)
}

/** The stored ratio, or null when there is none, it is not a number, or storage is off. */
function readRatio(key: string | undefined): number | null {
  if (key === undefined) return null
  try {
    const value = Number.parseFloat(localStorage.getItem(SPLIT_STORAGE_PREFIX + key) ?? '')
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeRatio(key: string | undefined, ratio: number): void {
  if (key === undefined) return
  try {
    localStorage.setItem(SPLIT_STORAGE_PREFIX + key, String(ratio))
  } catch {
    // No storage (a sandboxed frame, storage turned off): the ratio holds for this page.
  }
}
