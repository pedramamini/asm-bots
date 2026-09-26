/**
 * The editor page's panels, laid out as the user likes them (PRODUCT_SPEC §3; the model:
 * `tree.ts`). Each split draws its children with a divider between two that it sizes: drag it, or
 * focus it and use the arrow keys. Grab a panel by its title row and drop it beside another (the
 * edge nearest the pointer), on another (the two swap), or along the edge of the page. The grip at
 * the end of each title row opens the panel's menu: move it past its neighbor, or hide it; the
 * layout menu in the toolbar shows it again.
 *
 * Each panel renders once, into a box of its own that the layout moves between its tiles: a move
 * keeps the panel's state (the source's text and history, the watches, the arena's view). A hidden
 * panel keeps it too, off the page.
 */
import { cx, IconButton, Menu, type MenuEntry, PanelHost } from '@asmbots/ui'
import { GripVertical } from 'lucide-react'
import {
  Fragment,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  type Box,
  dockSide,
  dropZone,
  FIT_PANELS,
  FIXED_PANELS,
  type Layout,
  type LayoutNode,
  minSize,
  movePanel,
  neighborOf,
  PANEL_IDS,
  PANEL_LABELS,
  type PanelId,
  type Path,
  panelsOf,
  type Side,
  setHidden,
  setWeights,
  shareBetween,
  shows,
  swapPanels,
  type Zone,
  zoneBox,
} from './tree'

export interface WorkspaceProps {
  layout: Layout
  onLayout: (layout: Layout) => void
  /** Each panel's content: a `Panel`, or a surface that draws its own title row. */
  panels: Readonly<Record<PanelId, ReactNode>>
  /** Tells the user why a move did nothing. */
  notify: (message: string) => void
  className?: string | undefined
}

/** How far, px, the pointer moves on a title row before the press is a drag. */
const DRAG_START = 6
/** The least a divider drag leaves a tile, px. */
const MIN_DRAG = 48
/** How far an arrow key moves a divider, as a share of the two tiles, and with Shift. */
const STEP = 0.05
const BIG_STEP = 0.2
/** A docked panel's share of the page, as the drop preview shows it. */
const DOCK_SHARE = 0.25

/** What a press on the controls of a title row is for: not a drag. */
const CONTROLS = 'button:not([data-panel-grip]), input, textarea, select, a, [role="slider"]'

/** Where a drag would put its panel: beside or on `target`, or along the page's edge (null). */
interface Drop {
  readonly target: PanelId | null
  readonly zone: Zone
  /** The preview, px from the workspace's corner. */
  readonly box: Box
}

interface Drag {
  readonly id: PanelId
  readonly drop: Drop | null
  /** The pointer, px from the window's corner: the dragged panel's chip follows it. */
  readonly x: number
  readonly y: number
}

/** What a drop in `drop` does to panel `id`, in words: `left of source`, `swap with memory`. */
export function dropWords(drop: Drop | null): string {
  if (drop === null) return 'no move here'
  if (drop.target === null) return `dock ${drop.zone === 'center' ? 'here' : `at the ${drop.zone}`}`
  const target = PANEL_LABELS[drop.target]
  return drop.zone === 'center' ? `swap with ${target}` : `${SIDE_WORDS[drop.zone]} ${target}`
}

const SIDE_WORDS: Readonly<Record<Side, string>> = {
  left: 'left of',
  right: 'right of',
  top: 'above',
  bottom: 'below',
}

const MOVES: readonly (readonly [Side, string])[] = [
  ['left', 'move left'],
  ['right', 'move right'],
  ['top', 'move up'],
  ['bottom', 'move down'],
]

export function Workspace({ layout, onLayout, panels, notify, className }: WorkspaceProps) {
  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden])
  // The box each panel renders into; the tile that shows the panel holds it.
  const [hosts] = useState(() => new Map(PANEL_IDS.map((id) => [id, makeHost(id)])))
  const slots = useRef(new Map<PanelId, HTMLElement>())
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(layout)
  latest.current = layout
  const [drag, setDrag] = useState<Drag | null>(null)

  /** The boxes of the panels on the page. */
  const boxes = useCallback(() => {
    const out = new Map<PanelId, Box>()
    for (const [id, slot] of slots.current) {
      if (slot.isConnected) out.set(id, boxOf(slot))
    }
    return out
  }, [])

  const move = useCallback(
    (id: PanelId, side: Side) => {
      const next = neighborOf(boxes(), id, side)
      if (next === null) {
        notify(`no panel ${SIDE_WORDS[side]} ${PANEL_LABELS[id]}.`)
        return
      }
      const now = latest.current
      onLayout({ ...now, root: swapPanels(now.root, id, next) })
    },
    [boxes, notify, onLayout],
  )

  const hide = useCallback(
    (id: PanelId) => onLayout(setHidden(latest.current, id, true)),
    [onLayout],
  )

  /** Where a drop at `x, y` puts panel `id`: along the page's edge, or at a panel's. */
  const dropAt = (id: PanelId, x: number, y: number): Drop | null => {
    if (root.current === null) return null
    const frame = boxOf(root.current)
    // From the workspace's corner, as it scrolls.
    const x0 = frame.left - (root.current?.scrollLeft ?? 0)
    const y0 = frame.top - (root.current?.scrollTop ?? 0)
    const local = (box: Box): Box => ({
      left: box.left - x0,
      top: box.top - y0,
      right: box.right - x0,
      bottom: box.bottom - y0,
    })
    const dock = dockSide(frame, x, y)
    if (dock !== null) {
      const w = (frame.right - frame.left) * DOCK_SHARE
      const h = (frame.bottom - frame.top) * DOCK_SHARE
      const edge = {
        left: { ...frame, right: frame.left + w },
        right: { ...frame, left: frame.right - w },
        top: { ...frame, bottom: frame.top + h },
        bottom: { ...frame, top: frame.bottom - h },
      }[dock]
      return { target: null, zone: dock, box: local(edge) }
    }
    for (const [target, box] of boxes()) {
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      if (target === id) return null
      const zone = dropZone(box, x, y)
      return { target, zone, box: local(zoneBox(box, zone)) }
    }
    return null
  }

  // A drag starts on a panel's title row, past its controls; the grip starts one too.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const slot = event.target.closest<HTMLElement>('[data-panel]')
    const header = event.target.closest('header')
    if (slot === null || header === null || slot.querySelector('header') !== header) return
    if (event.target.closest(CONTROLS) !== null) return
    const id = slot.dataset.panel as PanelId
    const start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    let dragging = false
    let drop: Drop | null = null
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== start.pointerId) return
      if (!dragging) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START) return
        dragging = true
      }
      e.preventDefault()
      drop = dropAt(id, e.clientX, e.clientY)
      setDrag({ id, drop, x: e.clientX, y: e.clientY })
    }
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      setDrag(null)
      if (!dragging) return
      // The press was a drag: the click that ends it (on the grip, the menu's trigger) does nothing.
      const swallow = (e: MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
      }
      window.addEventListener('click', swallow, true)
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      if (!commit || drop === null) return
      const now = latest.current
      onLayout({ ...now, root: movePanel(now.root, id, drop.target, drop.zone) })
    }
    const onUp = (e: globalThis.PointerEvent) => {
      if (e.pointerId === start.pointerId) end(true)
    }
    const onCancel = (e: globalThis.PointerEvent) => {
      if (e.pointerId === start.pointerId) end(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragging) return
      e.preventDefault()
      e.stopPropagation()
      end(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  const slotRef = useCallback((id: PanelId, node: HTMLElement | null) => {
    if (node === null) slots.current.delete(id)
    else slots.current.set(id, node)
  }, [])

  return (
    <div
      ref={root}
      data-dragging={drag === null ? undefined : drag.id}
      onPointerDown={onPointerDown}
      className={cx(
        'relative flex min-h-0 min-w-0 overflow-auto',
        drag !== null && 'cursor-grabbing select-none',
        className,
      )}
    >
      {/* At least as big as the tiles' least sizes: past them, the workspace scrolls. */}
      <div
        className="flex size-full"
        style={{
          minWidth: minSize(layout.root, hidden, 'width'),
          minHeight: minSize(layout.root, hidden, 'height'),
        }}
      >
        <Tile
          node={layout.root}
          path={[]}
          layout={layout}
          hidden={hidden}
          hosts={hosts}
          dragging={drag?.id ?? null}
          slotRef={slotRef}
          onLayout={onLayout}
        />
      </div>
      {drag?.drop != null && (
        // Where the panel lands: the part of the page it takes, lit, and what the drop does.
        <div
          aria-hidden="true"
          data-drop={drag.drop.zone}
          className="pointer-events-none absolute z-20 flex items-center justify-center rounded-md border-2 border-accent bg-accent-25 transition-[left,top,width,height] duration-75 ease-out motion-reduce:transition-none"
          style={{
            left: drag.drop.box.left,
            top: drag.drop.box.top,
            width: drag.drop.box.right - drag.drop.box.left,
            height: drag.drop.box.bottom - drag.drop.box.top,
          }}
        >
          <span className="max-w-[90%] truncate rounded-sm border border-accent bg-panel px-2 py-0.5 text-panel-status text-accent-fg uppercase">
            {PANEL_LABELS[drag.id]} · {dropWords(drag.drop)}
          </span>
        </div>
      )}
      {drag !== null && (
        // The dragged panel's name at the pointer; muted where a drop would do nothing.
        <div
          aria-hidden="true"
          data-drag-chip=""
          className={cx(
            'pointer-events-none fixed z-modal rounded-sm border bg-panel px-2 py-0.5 text-panel-status uppercase',
            drag.drop === null ? 'border-border text-muted' : 'border-accent text-accent-fg',
          )}
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          {PANEL_LABELS[drag.id]}
          {drag.drop === null && ' · no move here'}
        </div>
      )}
      {/* What the drag does, for a screen reader. */}
      <span role="status" className="sr-only">
        {drag === null ? '' : `${PANEL_LABELS[drag.id]}: ${dropWords(drag.drop)}`}
      </span>
      {PANEL_IDS.map((id) =>
        createPortal(
          <PanelHost
            fill
            chrome={
              <PanelMenu
                id={id}
                onMove={(side) => move(id, side)}
                onHide={FIXED_PANELS.has(id) ? undefined : () => hide(id)}
              />
            }
          >
            {panels[id]}
          </PanelHost>,
          hosts.get(id) as HTMLElement,
          id,
        ),
      )}
    </div>
  )
}

/**
 * `node`'s box as a plain object: a `DOMRect`'s sides are getters on its prototype, so spreading one
 * (`{ ...rect, right }`) copies none of them.
 */
function boxOf(node: Element): Box {
  const { left, top, right, bottom } = node.getBoundingClientRect()
  return { left, top, right, bottom }
}

/** The box a panel renders into: it fills its tile, and its title row is a handle. */
function makeHost(id: PanelId): HTMLElement {
  const host = document.createElement('div')
  host.dataset.panelHost = id
  host.className = 'flex size-full min-h-0 min-w-0 flex-col [&>section>header]:cursor-grab'
  return host
}

interface TileProps {
  node: LayoutNode
  path: Path
  layout: Layout
  hidden: ReadonlySet<PanelId>
  hosts: ReadonlyMap<PanelId, HTMLElement>
  dragging: PanelId | null
  slotRef: (id: PanelId, node: HTMLElement | null) => void
  onLayout: (layout: Layout) => void
}

/** A node of the layout: a panel's tile, or a split of the children that show. */
function Tile(props: TileProps) {
  const { node, path, layout, hidden, onLayout } = props
  if (node.kind === 'panel') return <Slot {...props} id={node.id} />
  const shown = node.children.flatMap((child, i) => (shows(child, hidden) ? [{ child, i }] : []))
  const [only] = shown
  if (only === undefined) return null
  if (shown.length === 1) return <Tile {...props} node={only.child} path={[...path, only.i]} />
  const row = node.dir === 'row'
  const fits = (child: LayoutNode) => !row && child.kind === 'panel' && FIT_PANELS.has(child.id)
  // The shares of the children that show, out of theirs alone: flex hands out only a part of the
  // space when the grow factors add up to less than 1, and a hidden child's share would go empty.
  // A panel as tall as its content takes no share.
  const total = shown.reduce(
    (sum, { child, i }) => sum + (fits(child) ? 0 : (node.weights[i] ?? 0)),
    0,
  )
  const grow = (i: number) => (total > 0 ? (node.weights[i] ?? 0) / total : 1 / shown.length)
  return (
    <div className={cx('flex size-full min-h-0 min-w-0', row ? 'flex-row' : 'flex-col')}>
      {shown.map(({ child, i }, k) => {
        const next = shown[k + 1]
        return (
          <Fragment key={panelsOf(child)[0]}>
            <div
              className="flex overflow-hidden"
              style={{
                flex: fits(child) ? '0 0 auto' : `${grow(i)} 1 0px`,
                minWidth: minSize(child, hidden, 'width'),
                minHeight: fits(child) ? undefined : minSize(child, hidden, 'height'),
              }}
            >
              <Tile {...props} node={child} path={[...path, i]} />
            </div>
            {next !== undefined &&
              (fits(child) || fits(next.child) ? (
                <div aria-hidden="true" className={row ? 'w-3 shrink-0' : 'h-3 shrink-0'} />
              ) : (
                <Divider
                  row={row}
                  first={lone(child, hidden)}
                  second={lone(next.child, hidden)}
                  hidden={hidden}
                  weights={node.weights}
                  a={i}
                  b={next.i}
                  onWeights={(weights) =>
                    onLayout({ ...layout, root: setWeights(layout.root, path, weights) })
                  }
                />
              ))}
          </Fragment>
        )
      })}
    </div>
  )
}

/** A panel's tile: it holds the panel's box while it is on the page. */
function Slot({ id, hosts, dragging, slotRef }: TileProps & { id: PanelId }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = slot.current
    const host = hosts.get(id)
    if (node === null || host === undefined) return
    node.append(host)
    slotRef(id, node)
    return () => {
      if (host.parentNode === node) host.remove()
      slotRef(id, null)
    }
  }, [id, hosts, slotRef])
  return (
    <div
      ref={slot}
      data-panel={id}
      className={cx(
        'size-full min-h-0 min-w-0 transition-opacity duration-120 motion-reduce:transition-none',
        dragging === id && 'opacity-40',
      )}
    />
  )
}

/** What of `node` shows, down through the splits that show one child. */
function lone(node: LayoutNode, hidden: ReadonlySet<PanelId>): LayoutNode {
  if (node.kind === 'panel') return node
  const shown = node.children.filter((child) => shows(child, hidden))
  const [only] = shown
  return shown.length === 1 && only !== undefined ? lone(only, hidden) : node
}

interface DividerProps {
  row: boolean
  /** The tiles on either side, as they show. */
  first: LayoutNode
  second: LayoutNode
  hidden: ReadonlySet<PanelId>
  weights: readonly number[]
  /** The children it sits between, by index in the split. */
  a: number
  b: number
  onWeights: (weights: number[]) => void
}

/**
 * The divider between two tiles of a split (the WAI-ARIA window splitter), as `SplitPane`'s: a
 * 12 px gutter whose grip spans it on hover and turns accent on focus and while it is dragged. It
 * is named for the panel it sizes: of the two tiles, the one that is a panel alone, else the
 * smaller one's first panel.
 */
function Divider({ row, first, second, hidden, weights, a, b, onWeights }: DividerProps) {
  const drag = useRef<{ pointerId: number; start: number; a: number; b: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const pair = (weights[a] ?? 0) + (weights[b] ?? 0)
  const shareA = pair > 0 ? (weights[a] ?? 0) / pair : 0.5
  // Named for the tile that is one panel, else for the smaller: the arena strip's height.
  const named =
    first.kind === 'panel' ? first : second.kind === 'panel' || shareA > 0.5 ? second : first
  const namedShare = named === first ? shareA : 1 - shareA
  const shown = panelsOf(named).find((id) => !hidden.has(id)) ?? 'source'
  const label = `${PANEL_LABELS[shown]} ${row ? 'width' : 'height'}`

  const setShare = (share: number) =>
    onWeights(shareBetween(weights, a, b, Math.min(0.95, Math.max(0.05, share))))

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const before = event.currentTarget.previousElementSibling?.getBoundingClientRect()
    const after = event.currentTarget.nextElementSibling?.getBoundingClientRect()
    if (before === undefined || after === undefined) return
    event.preventDefault()
    event.stopPropagation()
    drag.current = {
      pointerId: event.pointerId,
      start: row ? event.clientX : event.clientY,
      a: row ? before.width : before.height,
      b: row ? after.width : after.height,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const grab = drag.current
    if (grab?.pointerId !== event.pointerId) return
    const total = grab.a + grab.b
    if (total <= 0) return
    const delta = (row ? event.clientX : event.clientY) - grab.start
    // The tiles' own least sizes hold them past this.
    const size = Math.min(total - MIN_DRAG, Math.max(MIN_DRAG, grab.a + delta))
    onWeights(shareBetween(weights, a, b, size / total))
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const moves: Readonly<Record<string, number>> = {
      [row ? 'ArrowLeft' : 'ArrowUp']: shareA - step,
      [row ? 'ArrowRight' : 'ArrowDown']: shareA + step,
      Home: 0,
      End: 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    setShare(next)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter, not a thematic break.
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(namedShare * 100)}
      aria-valuemin={5}
      aria-valuemax={95}
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
  )
}

/** The grip at the end of a panel's title row: drag it to move the panel, or open its menu. */
function PanelMenu({
  id,
  onMove,
  onHide,
}: {
  id: PanelId
  onMove: (side: Side) => void
  onHide: (() => void) | undefined
}) {
  const label = PANEL_LABELS[id]
  const items: MenuEntry[] = [
    ...MOVES.map(([side, words]) => ({ label: words, onSelect: () => onMove(side) })),
    'separator',
    {
      label: `hide ${label}`,
      disabled: onHide === undefined,
      onSelect: () => onHide?.(),
    },
  ]
  return (
    <Menu
      placement="bottom-end"
      trigger={
        <IconButton
          icon={GripVertical}
          size="sm"
          label={`${label}: drag to move, or open its menu`}
          data-panel-grip=""
          className="cursor-grab border-transparent"
        />
      }
      items={items}
    />
  )
}
