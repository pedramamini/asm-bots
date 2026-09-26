/**
 * The editor page's layout (PRODUCT_SPEC §3): its panels as the leaves of a tree of splits. A split
 * sets its children side by side (`row`) or stacked (`column`); each child takes a share of the
 * space by its weight. Every panel is a leaf of the tree, once; a hidden one keeps its place, so it
 * comes back where it was. The source is never hidden. The module holds no React: the page, the
 * store, and the tests share it.
 */
import { isRecord } from '../../../store/settings'

/** The panels of the editor page, in the order the layout menu lists them. */
export const PANEL_IDS = [
  'source',
  'problems',
  'library',
  'help',
  'debug',
  'registers',
  'processes',
  'watch',
  'breakpoints',
  'memory',
  'trace',
  'arena',
] as const

export type PanelId = (typeof PANEL_IDS)[number]

/** A panel's name, as its menu and the layout menu say it. */
export const PANEL_LABELS: Readonly<Record<PanelId, string>> = {
  source: 'source',
  problems: 'problems',
  library: 'library',
  help: 'help',
  debug: 'debug controls',
  registers: 'registers',
  processes: 'processes',
  watch: 'watch',
  breakpoints: 'breakpoints',
  memory: 'memory',
  trace: 'trace',
  arena: 'arena strip',
}

/** Panels as tall as their content in a column: a divider does not size them. */
export const FIT_PANELS: ReadonlySet<PanelId> = new Set(['debug', 'registers'])

/** The least a panel's tile takes, px: its title row and a line or a field. */
export const TILE_MIN = { width: 140, height: 88 } as const

/** The least height of the panels as tall as their content, px: about their content's. */
export const FIT_MIN: Readonly<Partial<Record<PanelId, number>>> = { debug: 140, registers: 180 }

/** The gutter between two tiles, px. */
export const GUTTER = 12

/** The panels that cannot be hidden. */
export const FIXED_PANELS: ReadonlySet<PanelId> = new Set(['source'])

export type Direction = 'row' | 'column'
/** Where a panel lands against another: beside it, or in its place (`center`: they swap). */
export type Side = 'left' | 'right' | 'top' | 'bottom'
export type Zone = Side | 'center'

export interface PanelLeaf {
  readonly kind: 'panel'
  readonly id: PanelId
}

export interface SplitNode {
  readonly kind: 'split'
  readonly dir: Direction
  readonly children: readonly LayoutNode[]
  /** Each child's share, by index; they add up to 1. */
  readonly weights: readonly number[]
}

export type LayoutNode = PanelLeaf | SplitNode

/** What the editor keeps of its layout: the tree, and the panels hidden in it. */
export interface Layout {
  readonly root: LayoutNode
  readonly hidden: readonly PanelId[]
}

/** A split's children by index, from the root: `[]` is the root. */
export type Path = readonly number[]

const panel = (id: PanelId): PanelLeaf => ({ kind: 'panel', id })

/** A split of `[node, weight]` pairs; the weights are shares, scaled to add up to 1. */
function split(dir: Direction, ...parts: readonly (readonly [LayoutNode, number])[]): SplitNode {
  return {
    kind: 'split',
    dir,
    children: parts.map(([node]) => node),
    weights: scaled(parts.map(([, weight]) => weight)),
  }
}

const row = (...parts: readonly (readonly [LayoutNode, number])[]) => split('row', ...parts)
const column = (...parts: readonly (readonly [LayoutNode, number])[]) => split('column', ...parts)

/**
 * The debugger's panels: the controls over the machine state, the registers over the processes
 * beside the memory (the widest: bytes and their disassembly), the watches, and the breakpoints.
 */
function debuggerColumn(): SplitNode {
  return column(
    [panel('debug'), 0.1],
    [
      row(
        [column([panel('registers'), 0.3], [panel('processes'), 0.7]), 0.4],
        [column([panel('memory'), 0.7], [panel('watch'), 0.15], [panel('breakpoints'), 0.15]), 0.6],
      ),
      0.9,
    ],
  )
}

/** The panels of the debugger, and the arena strip and the trace: what `writing` hides. */
const MACHINE_PANELS = [
  'debug',
  'registers',
  'processes',
  'watch',
  'breakpoints',
  'memory',
  'trace',
  'arena',
] as const satisfies readonly PanelId[]

/** What the phone's layout hides, in the order it stacks them under the help. */
const PHONE_HIDDEN = [
  'debug',
  'registers',
  'memory',
  'processes',
  'watch',
  'breakpoints',
  'trace',
  'arena',
  'library',
] as const satisfies readonly PanelId[]

/**
 * The layouts the layout menu offers, the default first. A hidden panel keeps its place in each,
 * so shown again it comes back where it fits: the debugger right of the help, the arena strip and
 * the trace under all.
 */
export const PRESETS = {
  /** The library, the source over its problems, and the help beside them; the machine hidden. */
  writing: (): Layout => ({
    root: column(
      [
        row(
          [panel('library'), 0.13],
          [column([panel('source'), 0.8], [panel('problems'), 0.2]), 0.6],
          [panel('help'), 0.27],
          [debuggerColumn(), 0.45],
        ),
        0.74,
      ],
      [row([panel('arena'), 0.72], [panel('trace'), 0.28]), 0.26],
    ),
    hidden: [...MACHINE_PANELS],
  }),
  /**
   * The source over its problems beside the debugger, its memory the widest panel; the arena strip
   * and the trace under both. The library and the help are hidden, left and right of the source.
   */
  debugging: (): Layout => ({
    root: column(
      [
        row(
          [panel('library'), 0.12],
          [column([panel('source'), 0.76], [panel('problems'), 0.24]), 0.36],
          [panel('help'), 0.2],
          [debuggerColumn(), 0.64],
        ),
        0.76,
      ],
      [row([panel('arena'), 0.7], [panel('trace'), 0.3]), 0.24],
    ),
    hidden: ['library', 'help'],
  }),
  /**
   * A phone's: one column, the source over its problems and the help; the rest hidden under them,
   * the debug controls first, so a panel shown again takes a share of the column.
   */
  phone: (): Layout => ({
    root: column(
      [panel('source'), 0.62],
      [panel('problems'), 0.14],
      [panel('help'), 0.24],
      ...PHONE_HIDDEN.map((id) => [panel(id), 0.3] as const),
    ),
    hidden: [...PHONE_HIDDEN],
  }),
} as const satisfies Record<string, () => Layout>

export type PresetId = keyof typeof PRESETS

export const PRESET_LABELS: Readonly<Record<PresetId, string>> = {
  writing: 'writing',
  debugging: 'debugging',
  phone: 'phone',
}

/** The layout a first visit gets, and a store with none: the writing one. */
export const DEFAULT_LAYOUT: Layout = PRESETS.writing()

/** `weights` scaled to add up to 1; all zero (or none) share alike. */
function scaled(weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return weights.map(() => 1 / weights.length)
  return weights.map((w) => w / sum)
}

/** The panels of `node`, in order. */
export function panelsOf(node: LayoutNode): PanelId[] {
  return node.kind === 'panel' ? [node.id] : node.children.flatMap(panelsOf)
}

/** Whether any panel of `node` shows. */
export function shows(node: LayoutNode, hidden: ReadonlySet<PanelId>): boolean {
  return node.kind === 'panel' ? !hidden.has(node.id) : node.children.some((c) => shows(c, hidden))
}

/**
 * The least `axis` size of `node` as it shows, px: a panel's `TILE_MIN` (or its `FIT_MIN` in
 * height); a split along the axis adds its children's and the gutters, one across takes the most.
 */
export function minSize(
  node: LayoutNode,
  hidden: ReadonlySet<PanelId>,
  axis: 'width' | 'height',
): number {
  if (node.kind === 'panel') {
    return axis === 'height' ? (FIT_MIN[node.id] ?? TILE_MIN.height) : TILE_MIN.width
  }
  const sizes = node.children.filter((c) => shows(c, hidden)).map((c) => minSize(c, hidden, axis))
  if (sizes.length === 0) return 0
  const along = (node.dir === 'row') === (axis === 'width')
  return along ? sizes.reduce((a, b) => a + b, 0) + GUTTER * (sizes.length - 1) : Math.max(...sizes)
}

/** The node at `path`, or null. */
export function nodeAt(root: LayoutNode, path: Path): LayoutNode | null {
  let node: LayoutNode | undefined = root
  for (const i of path) {
    if (node?.kind !== 'split') return null
    node = node.children[i]
  }
  return node ?? null
}

/**
 * `node` tidied: a split of one child is that child, a split in a split of its direction joins it
 * (its children take shares of its weight), and each split's weights add up to 1.
 */
export function normalize(node: LayoutNode): LayoutNode {
  if (node.kind === 'panel') return node
  const children: LayoutNode[] = []
  const weights: number[] = []
  node.children.forEach((child, i) => {
    const tidy = normalize(child)
    const weight = node.weights[i] ?? 0
    if (tidy.kind === 'split' && tidy.dir === node.dir) {
      tidy.children.forEach((grandchild, j) => {
        children.push(grandchild)
        weights.push(weight * (tidy.weights[j] ?? 0))
      })
    } else {
      children.push(tidy)
      weights.push(weight)
    }
  })
  const [only] = children
  if (children.length === 1 && only !== undefined) return only
  return { kind: 'split', dir: node.dir, children, weights: scaled(weights) }
}

/** `root` without the leaf of `id`: null when it was the only panel. */
export function removePanel(root: LayoutNode, id: PanelId): LayoutNode | null {
  const without = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === 'panel') return node.id === id ? null : node
    const children: LayoutNode[] = []
    const weights: number[] = []
    node.children.forEach((child, i) => {
      const kept = without(child)
      if (kept === null) return
      children.push(kept)
      weights.push(node.weights[i] ?? 0)
    })
    if (children.length === 0) return null
    return { ...node, children, weights }
  }
  const left = without(root)
  return left === null ? null : normalize(left)
}

const dirOf = (side: Side): Direction => (side === 'left' || side === 'right' ? 'row' : 'column')
const before = (side: Side) => side === 'left' || side === 'top'

/**
 * `root` with `id` beside `target`, on `side`: the two share the target's space. `target: null`
 * docks it along the edge of the whole page, where it takes a quarter.
 */
export function insertPanel(
  root: LayoutNode,
  id: PanelId,
  target: PanelId | null,
  side: Side,
): LayoutNode {
  const leaf = panel(id)
  const pair = (node: LayoutNode, share: number): SplitNode =>
    before(side)
      ? split(dirOf(side), [leaf, share], [node, 1 - share])
      : split(dirOf(side), [node, 1 - share], [leaf, share])
  if (target === null) return normalize(pair(root, 0.25))
  const place = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'panel') return node.id === target ? pair(node, 0.5) : node
    return { ...node, children: node.children.map(place) }
  }
  return normalize(place(root))
}

/** `root` with `id` moved beside `target` (or into its place, `center`: the two swap). */
export function movePanel(
  root: LayoutNode,
  id: PanelId,
  target: PanelId | null,
  zone: Zone,
): LayoutNode {
  if (target === id) return root
  if (zone === 'center') return target === null ? root : swapPanels(root, id, target)
  const left = removePanel(root, id)
  if (left === null) return root
  if (target !== null && !panelsOf(left).includes(target)) return root
  return insertPanel(left, id, target, zone)
}

/** `root` with the places of `a` and `b` swapped. */
export function swapPanels(root: LayoutNode, a: PanelId, b: PanelId): LayoutNode {
  const swap = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'split') return { ...node, children: node.children.map(swap) }
    return node.id === a ? panel(b) : node.id === b ? panel(a) : node
  }
  return swap(root)
}

/** `root` with the weights of the split at `path` set to `weights` (scaled to add up to 1). */
export function setWeights(root: LayoutNode, path: Path, weights: readonly number[]): LayoutNode {
  const at = (node: LayoutNode, depth: number): LayoutNode => {
    if (node.kind !== 'split') return node
    if (depth === path.length) {
      if (weights.length !== node.children.length) return node
      return { ...node, weights: scaled(weights) }
    }
    const index = path[depth]
    return {
      ...node,
      children: node.children.map((child, i) => (i === index ? at(child, depth + 1) : child)),
    }
  }
  return at(root, 0)
}

/**
 * The weights of a split after its divider between the children `a` and `b` moved: `a` takes
 * `share` of the space the two hold together, 0..1, and `b` the rest; the others keep theirs.
 */
export function shareBetween(
  weights: readonly number[],
  a: number,
  b: number,
  share: number,
): number[] {
  const wa = weights[a] ?? 0
  const wb = weights[b] ?? 0
  const pair = wa + wb
  const s = Math.min(1, Math.max(0, share))
  return weights.map((w, i) => (i === a ? pair * s : i === b ? pair * (1 - s) : w))
}

/** `layout` with `id` hidden or shown. The fixed panels always show. */
export function setHidden(layout: Layout, id: PanelId, hide: boolean): Layout {
  if (hide && FIXED_PANELS.has(id)) return layout
  const hidden = layout.hidden.filter((h) => h !== id)
  return { ...layout, hidden: hide ? [...hidden, id] : hidden }
}

/** A box on the page, as `getBoundingClientRect` has it. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** How near an edge of a panel, as a share of its size, a drop lands beside it. */
export const EDGE_SHARE = 0.3

/** Where a drop at `x, y` lands on a panel of `box`: beside it at the nearest edge, or in its place. */
export function dropZone(box: Box, x: number, y: number): Zone {
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (width <= 0 || height <= 0) return 'center'
  const edges: [Side, number][] = [
    ['left', (x - box.left) / width],
    ['right', (box.right - x) / width],
    ['top', (y - box.top) / height],
    ['bottom', (box.bottom - y) / height],
  ]
  const [side, share] = edges.reduce((near, edge) => (edge[1] < near[1] ? edge : near))
  return share < EDGE_SHARE ? side : 'center'
}

/** The part of `box` a drop in `zone` takes: the half on that side, or all of it. */
export function zoneBox(box: Box, zone: Zone): Box {
  const midX = (box.left + box.right) / 2
  const midY = (box.top + box.bottom) / 2
  switch (zone) {
    case 'left':
      return { ...box, right: midX }
    case 'right':
      return { ...box, left: midX }
    case 'top':
      return { ...box, bottom: midY }
    case 'bottom':
      return { ...box, top: midY }
    case 'center':
      return box
  }
}

/** How near the page's edge, px, a drop docks along it. */
export const DOCK_EDGE = 16

/** The edge of the page `box` a drop at `x, y` docks along, or null away from the edges. */
export function dockSide(box: Box, x: number, y: number): Side | null {
  const edges: [Side, number][] = [
    ['left', x - box.left],
    ['right', box.right - x],
    ['top', y - box.top],
    ['bottom', box.bottom - y],
  ]
  const [side, distance] = edges.reduce((near, edge) => (edge[1] < near[1] ? edge : near))
  return distance >= 0 && distance < DOCK_EDGE ? side : null
}

/**
 * The panel next to `id` on `side`, by the boxes on the page: the nearest past its edge on that
 * side that overlaps it across; of two as near, the one that overlaps it more. Null when none is.
 */
export function neighborOf(
  boxes: ReadonlyMap<PanelId, Box>,
  id: PanelId,
  side: Side,
): PanelId | null {
  const me = boxes.get(id)
  if (me === undefined) return null
  const across = dirOf(side) === 'row'
  let best: { id: PanelId; overlap: number; gap: number } | null = null
  for (const [other, box] of boxes) {
    if (other === id) continue
    const gap =
      side === 'left'
        ? me.left - box.right
        : side === 'right'
          ? box.left - me.right
          : side === 'top'
            ? me.top - box.bottom
            : box.top - me.bottom
    if (gap < -1) continue
    const overlap = across
      ? Math.min(me.bottom, box.bottom) - Math.max(me.top, box.top)
      : Math.min(me.right, box.right) - Math.max(me.left, box.left)
    if (overlap <= 0) continue
    if (
      best === null ||
      gap < best.gap - 1 ||
      (Math.abs(gap - best.gap) <= 1 && overlap > best.overlap)
    ) {
      best = { id: other, overlap, gap }
    }
  }
  return best?.id ?? null
}

const isPanelId = (value: unknown): value is PanelId =>
  typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value)

/**
 * The layout a store holds, made whole: a tree of known panels, each once, with weights that add
 * up; the panels it lacks join at the end of the root, hidden. Null when it is not a layout at all.
 */
export function sanitizeLayout(stored: unknown): Layout | null {
  if (!isRecord(stored)) return null
  const seen = new Set<PanelId>()
  const read = (node: unknown, depth: number): LayoutNode | null => {
    if (!isRecord(node) || depth > 16) return null
    if (node.kind === 'panel') {
      if (!isPanelId(node.id) || seen.has(node.id)) return null
      seen.add(node.id)
      return panel(node.id)
    }
    if (node.kind !== 'split' || (node.dir !== 'row' && node.dir !== 'column')) return null
    const { children: kids, weights: shares, dir } = node
    if (!Array.isArray(kids) || !Array.isArray(shares)) return null
    const children: LayoutNode[] = []
    const weights: number[] = []
    kids.forEach((child: unknown, i: number) => {
      const kept = read(child, depth + 1)
      if (kept === null) return
      const weight: unknown = shares[i]
      const fair = 1 / kids.length
      children.push(kept)
      weights.push(
        typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : fair,
      )
    })
    if (children.length === 0) return null
    return { kind: 'split', dir, children, weights }
  }
  const root = read(stored.root, 0)
  if (root === null) return null
  const missing = PANEL_IDS.filter((id) => !seen.has(id))
  const whole =
    missing.length === 0
      ? root
      : {
          kind: 'split' as const,
          dir: root.kind === 'split' ? root.dir : ('column' as const),
          children: [...(root.kind === 'split' ? root.children : [root]), ...missing.map(panel)],
          weights: [...(root.kind === 'split' ? root.weights : [1]), ...missing.map(() => 0.2)],
        }
  const hidden = Array.isArray(stored.hidden) ? [...new Set(stored.hidden.filter(isPanelId))] : []
  return {
    root: normalize(whole),
    hidden: [...new Set([...hidden, ...missing])].filter((id) => !FIXED_PANELS.has(id)),
  }
}
