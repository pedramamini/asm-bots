/**
 * The editor's layout model (`layout/tree.ts`): the presets hold every panel once, and a move, a
 * swap, a hide, a resize, and a store read keep it so. The drop zones and the neighbors by the
 * boxes on the page.
 */
import { describe, expect, it } from 'bun:test'
import {
  type Box,
  DEFAULT_LAYOUT,
  dockSide,
  dropZone,
  GUTTER,
  insertPanel,
  type LayoutNode,
  minSize,
  movePanel,
  neighborOf,
  nodeAt,
  normalize,
  PANEL_IDS,
  type PanelId,
  PRESETS,
  panelsOf,
  removePanel,
  sanitizeLayout,
  setHidden,
  setWeights,
  shareBetween,
  shows,
  swapPanels,
  TILE_MIN,
  zoneBox,
} from '../src/features/editor/layout/tree'

const leaf = (id: PanelId): LayoutNode => ({ kind: 'panel', id })
const sorted = (ids: readonly PanelId[]) => [...ids].sort()

/** Each split's weights add up to 1, and no split is of one child or in a split of its direction. */
function tidy(node: LayoutNode, parent: 'row' | 'column' | null = null): void {
  if (node.kind === 'panel') return
  expect(node.children.length).toBeGreaterThan(1)
  expect(node.dir).not.toBe(parent)
  expect(node.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
  for (const child of node.children) tidy(child, node.dir)
}

describe('the presets', () => {
  it('hold every panel once, tidy, and show the source', () => {
    for (const make of Object.values(PRESETS)) {
      const { root, hidden } = make()
      expect(sorted(panelsOf(root))).toEqual(sorted(PANEL_IDS))
      tidy(root)
      expect(hidden).not.toContain('source')
    }
  })

  it('lay out the library, the source over the problems, the debugger, and the strip under all', () => {
    const { root } = DEFAULT_LAYOUT
    expect(root.kind === 'split' && root.dir).toBe('column')
    expect(panelsOf(nodeAt(root, [1]) as LayoutNode)).toEqual(['arena', 'trace'])
    expect(panelsOf(nodeAt(root, [0, 0]) as LayoutNode)).toEqual(['library'])
    expect(panelsOf(nodeAt(root, [0, 1]) as LayoutNode)).toEqual(['source', 'problems'])
  })
})

describe('moves', () => {
  it('puts a panel beside another, sharing its space, and tidies the tree', () => {
    const root = movePanel(DEFAULT_LAYOUT.root, 'memory', 'source', 'left')
    tidy(root)
    expect(sorted(panelsOf(root))).toEqual(sorted(PANEL_IDS))
    // The source's column now starts with a row: the memory, then the source.
    const pair = nodeAt(root, [0, 1, 0])
    expect(pair?.kind === 'split' && pair.dir).toBe('row')
    expect(panelsOf(pair as LayoutNode)).toEqual(['memory', 'source'])
    expect(pair?.kind === 'split' && pair.weights).toEqual([0.5, 0.5])
  })

  it('joins a split of the same direction instead of nesting one', () => {
    // Below the source, in its column: one column of three, not a column in a column.
    const root = movePanel(DEFAULT_LAYOUT.root, 'trace', 'source', 'bottom')
    tidy(root)
    expect(panelsOf(nodeAt(root, [0, 1]) as LayoutNode)).toEqual(['source', 'trace', 'problems'])
  })

  it('swaps two panels on a drop in the middle', () => {
    const root = movePanel(DEFAULT_LAYOUT.root, 'library', 'memory', 'center')
    expect(panelsOf(nodeAt(root, [0, 0]) as LayoutNode)).toEqual(['memory'])
    expect(panelsOf(root)).toContain('library')
    expect(swapPanels(root, 'library', 'memory')).toEqual(DEFAULT_LAYOUT.root)
  })

  it('docks a panel along the page, where it takes a quarter', () => {
    const root = movePanel(DEFAULT_LAYOUT.root, 'arena', null, 'left')
    tidy(root)
    expect(root.kind === 'split' && root.dir).toBe('row')
    expect(panelsOf(nodeAt(root, [0]) as LayoutNode)).toEqual(['arena'])
    expect(root.kind === 'split' && root.weights[0]).toBeCloseTo(0.25, 9)
  })

  it('does nothing for a panel onto itself', () => {
    expect(movePanel(DEFAULT_LAYOUT.root, 'memory', 'memory', 'left')).toBe(DEFAULT_LAYOUT.root)
  })

  it('removes a panel and collapses what held it', () => {
    const two = normalize({
      kind: 'split',
      dir: 'row',
      children: [leaf('source'), leaf('memory')],
      weights: [1, 3],
    })
    expect(removePanel(two, 'memory')).toEqual(leaf('source'))
    expect(removePanel(leaf('source'), 'source')).toBeNull()
    expect(insertPanel(leaf('source'), 'trace', 'source', 'top')).toEqual({
      kind: 'split',
      dir: 'column',
      children: [leaf('trace'), leaf('source')],
      weights: [0.5, 0.5],
    })
  })
})

describe('sizes and hiding', () => {
  it('moves a divider between two children and keeps the others', () => {
    expect(shareBetween([0.2, 0.3, 0.5], 0, 1, 0.8)).toEqual([0.4, 0.09999999999999998, 0.5])
    const root = setWeights(DEFAULT_LAYOUT.root, [], [3, 1])
    expect(root.kind === 'split' && root.weights).toEqual([0.75, 0.25])
    // Weights of the wrong length leave the split alone.
    expect(setWeights(DEFAULT_LAYOUT.root, [], [1])).toEqual(DEFAULT_LAYOUT.root)
  })

  it('hides a panel in its place and shows it there again; never the source', () => {
    const hidden = setHidden(DEFAULT_LAYOUT, 'memory', true)
    expect(hidden.hidden).toEqual(['memory'])
    expect(hidden.root).toBe(DEFAULT_LAYOUT.root)
    expect(setHidden(hidden, 'memory', false).hidden).toEqual([])
    expect(setHidden(DEFAULT_LAYOUT, 'source', true)).toBe(DEFAULT_LAYOUT)
    const off = new Set<PanelId>(['arena', 'trace'])
    expect(shows(nodeAt(DEFAULT_LAYOUT.root, [1]) as LayoutNode, off)).toBe(false)
    expect(shows(DEFAULT_LAYOUT.root, off)).toBe(true)
  })
})

describe('least sizes', () => {
  it('add up along a split and take the most across one, as the panels show', () => {
    const { root } = PRESETS.writing()
    const hidden = new Set(PRESETS.writing().hidden)
    // The library beside the source over the problems.
    expect(minSize(root, hidden, 'width')).toBe(TILE_MIN.width * 2 + GUTTER)
    expect(minSize(root, hidden, 'height')).toBe(TILE_MIN.height * 2 + GUTTER)
    // The registers' least height is their content's.
    expect(minSize(leaf('registers'), new Set(), 'height')).toBeGreaterThan(TILE_MIN.height)
    expect(minSize(DEFAULT_LAYOUT.root, new Set(PANEL_IDS.slice(1)), 'height')).toBe(
      TILE_MIN.height,
    )
  })
})

describe('a stored layout', () => {
  it('reads back as it was written', () => {
    const layout = { root: movePanel(DEFAULT_LAYOUT.root, 'trace', null, 'top'), hidden: ['watch'] }
    expect(sanitizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it('drops what it does not know, and adds the panels it lacks, hidden', () => {
    const stored = {
      root: {
        kind: 'split',
        dir: 'row',
        children: [
          { kind: 'panel', id: 'source' },
          { kind: 'panel', id: 'source' },
          { kind: 'panel', id: 'nope' },
          { kind: 'panel', id: 'memory' },
        ],
        weights: [1, 1, 1, 'x'],
      },
      hidden: ['memory', 'source', 7],
    }
    const layout = sanitizeLayout(stored)
    expect(layout).not.toBeNull()
    if (layout === null) return
    tidy(layout.root)
    expect(sorted(panelsOf(layout.root))).toEqual(sorted(PANEL_IDS))
    expect(panelsOf(layout.root).slice(0, 2)).toEqual(['source', 'memory'])
    expect(layout.hidden).toContain('memory')
    expect(layout.hidden).toContain('trace')
    expect(layout.hidden).not.toContain('source')
  })

  it('is null when it is not a layout', () => {
    expect(sanitizeLayout(null)).toBeNull()
    expect(sanitizeLayout({ root: { kind: 'panel', id: 'nope' } })).toBeNull()
    expect(sanitizeLayout({ root: { kind: 'split', dir: 'diagonal', children: [] } })).toBeNull()
  })
})

describe('drops and neighbors', () => {
  const box: Box = { left: 0, top: 0, right: 200, bottom: 100 }

  it('lands beside a panel near its edges, and on it in the middle', () => {
    expect(dropZone(box, 10, 50)).toBe('left')
    expect(dropZone(box, 190, 50)).toBe('right')
    expect(dropZone(box, 100, 5)).toBe('top')
    expect(dropZone(box, 100, 95)).toBe('bottom')
    expect(dropZone(box, 100, 50)).toBe('center')
    expect(zoneBox(box, 'right')).toEqual({ left: 100, top: 0, right: 200, bottom: 100 })
    expect(zoneBox(box, 'top')).toEqual({ left: 0, top: 0, right: 200, bottom: 50 })
  })

  it('docks along the page only right at its edge', () => {
    expect(dockSide(box, 4, 50)).toBe('left')
    expect(dockSide(box, 100, 96)).toBe('bottom')
    expect(dockSide(box, 100, 50)).toBeNull()
  })

  it('finds the panel next to one on each side, by the boxes', () => {
    const boxes = new Map<PanelId, Box>([
      ['source', { left: 0, top: 0, right: 100, bottom: 200 }],
      ['registers', { left: 112, top: 0, right: 200, bottom: 90 }],
      ['memory', { left: 212, top: 0, right: 300, bottom: 200 }],
      ['trace', { left: 112, top: 150, right: 200, bottom: 200 }],
    ])
    expect(neighborOf(boxes, 'source', 'right')).toBe('registers')
    expect(neighborOf(boxes, 'registers', 'right')).toBe('memory')
    expect(neighborOf(boxes, 'registers', 'bottom')).toBe('trace')
    expect(neighborOf(boxes, 'trace', 'top')).toBe('registers')
    // Two as near: the one that overlaps it more.
    expect(neighborOf(boxes, 'memory', 'left')).toBe('registers')
    expect(neighborOf(boxes, 'source', 'left')).toBeNull()
    expect(neighborOf(boxes, 'source', 'top')).toBeNull()
  })
})
