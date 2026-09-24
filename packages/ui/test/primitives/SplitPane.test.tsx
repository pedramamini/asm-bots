import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { SPLIT_STORAGE_PREFIX, SplitPane, type SplitPaneProps } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const undo: (() => void)[] = []
afterEach(() => {
  for (const restore of undo.splice(0)) restore()
})

function renderSplit(props: Partial<SplitPaneProps> = {}) {
  return render(
    <SplitPane label="editor width" {...props}>
      <p>editor</p>
      <p>debugger</p>
    </SplitPane>,
  )
}

const separator = () => screen.getByRole('separator')
const root = () => separator().parentElement as HTMLElement
const value = () => Number(separator().getAttribute('aria-valuenow'))

/** Presses `key` on the divider and says whether it took the key. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(separator(), { key, ...init })
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  const edges = { left, top, width, height, right: left + width, bottom: top + height }
  return { ...edges, x: left, y: top, toJSON: () => edges } as DOMRect
}

/** Lays the split out: jsdom has no layout, so the drag reads these boxes. */
function layout(container: DOMRect, divider: DOMRect): void {
  root().getBoundingClientRect = () => container
  separator().getBoundingClientRect = () => divider
}

describe('SplitPane', () => {
  it('draws two panes with the divider between them', () => {
    const { container } = renderSplit()
    expect(html(container)).toMatchSnapshot()
  })

  it('is a window splitter: a focusable separator, named, that controls the first pane', () => {
    renderSplit()
    const divider = separator()
    expect(divider.tabIndex).toBe(0)
    expect(divider.getAttribute('aria-label')).toBe('editor width')
    expect(divider.getAttribute('aria-orientation')).toBe('vertical')
    const controls = divider.getAttribute('aria-controls') ?? ''
    expect(document.getElementById(controls)?.textContent).toBe('editor')
    expect(
      ['aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map((name) => divider.getAttribute(name)),
    ).toEqual(['50', '10', '90'])
  })

  it('sizes the first pane from --split, the share of the space beside the 12 px gutter', () => {
    renderSplit({ defaultRatio: 0.3 })
    expect(root().style.getPropertyValue('--split')).toBe('0.3')
    const first = root().firstElementChild as HTMLElement
    expect(first.className).toContain('basis-[calc((100%-var(--space-3))*var(--split))]')
    expect(separator().className.split(' ')).toEqual(
      expect.arrayContaining(['w-3', 'cursor-col-resize', 'touch-none']),
    )
    expect((root().lastElementChild as HTMLElement).className).toContain('flex-1')
  })

  it('stacks the panes in a column with a horizontal divider', () => {
    renderSplit({ direction: 'column' })
    expect(root().className).toContain('flex-col')
    expect(separator().getAttribute('aria-orientation')).toBe('horizontal')
    expect(separator().className.split(' ')).toEqual(
      expect.arrayContaining(['h-3', 'cursor-row-resize']),
    )
  })

  it('steps 2% with Left and Right, 10% with Shift', () => {
    renderSplit()
    expect(press('ArrowRight')).toBe(true)
    expect(value()).toBe(52)
    press('ArrowRight', { shiftKey: true })
    expect(value()).toBe(62)
    press('ArrowLeft')
    expect(value()).toBe(60)
    expect(root().style.getPropertyValue('--split')).toBe('0.6')
    expect(press('ArrowUp')).toBe(false)
    expect(press('ArrowDown')).toBe(false)
    expect(press('Enter')).toBe(false)
    expect(value()).toBe(60)
  })

  it('steps with Up and Down in a column', () => {
    renderSplit({ direction: 'column' })
    press('ArrowDown')
    expect(value()).toBe(52)
    press('ArrowUp', { shiftKey: true })
    expect(value()).toBe(42)
    expect(press('ArrowRight')).toBe(false)
    expect(value()).toBe(42)
  })

  it('goes to min and max with Home and End, and stops there', () => {
    renderSplit({ min: 0.25, max: 0.75 })
    expect(separator().getAttribute('aria-valuemin')).toBe('25')
    expect(separator().getAttribute('aria-valuemax')).toBe('75')
    press('End')
    expect(value()).toBe(75)
    press('ArrowRight', { shiftKey: true })
    expect(value()).toBe(75)
    press('Home')
    expect(value()).toBe(25)
    press('ArrowLeft')
    expect(value()).toBe(25)
  })

  it('keeps the ratio to 4 places, so steps do not drift', () => {
    renderSplit({ storageKey: 'editor' })
    // In floating point, 0.5 plus four steps of 0.02 is 0.5800000000000001.
    for (let i = 0; i < 4; i++) press('ArrowRight')
    expect(root().style.getPropertyValue('--split')).toBe('0.58')
    expect(localStorage.getItem('split:editor')).toBe('0.58')
  })

  it('persists the ratio under split:<storageKey> and starts from it next time', () => {
    const { unmount } = renderSplit({ storageKey: 'editor' })
    press('ArrowRight')
    expect(localStorage.getItem(`${SPLIT_STORAGE_PREFIX}editor`)).toBe('0.52')
    expect(SPLIT_STORAGE_PREFIX).toBe('split:')
    unmount()
    renderSplit({ storageKey: 'editor' })
    expect(value()).toBe(52)
  })

  it('starts from defaultRatio when nothing usable is stored, and holds a stored ratio to min..max', () => {
    localStorage.setItem('split:rail', 'wide')
    const { unmount } = renderSplit({ storageKey: 'rail', defaultRatio: 0.3 })
    expect(value()).toBe(30)
    unmount()
    localStorage.setItem('split:rail', '0.99')
    renderSplit({ storageKey: 'rail' })
    expect(value()).toBe(90)
  })

  it('stores nothing without storageKey', () => {
    renderSplit()
    press('ArrowRight')
    expect(localStorage.length).toBe(0)
  })

  it('works on when storage is off', () => {
    const denied = () => {
      throw new Error('SecurityError: storage is off')
    }
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: denied, setItem: denied },
      configurable: true,
    })
    undo.push(() =>
      Object.defineProperty(globalThis, 'localStorage', storage as PropertyDescriptor),
    )
    renderSplit({ storageKey: 'editor', defaultRatio: 0.4 })
    expect(value()).toBe(40)
    press('ArrowRight')
    expect(value()).toBe(42)
  })

  it('follows a drag from where the pointer holds the divider, without taking focus', () => {
    renderSplit()
    // The container starts at x 100 and is 1012 px wide: 1000 px of panes and the 12 px gutter,
    // whose center sits at 100 + 500 + 6 at the ratio 0.5.
    layout(box(100, 0, 1012, 400), box(600, 0, 12, 400))
    expect(fireEvent.pointerDown(separator(), { pointerId: 1, button: 0, clientX: 610 })).toBe(
      false,
    )
    expect(separator().dataset.dragging).toBe('true')
    expect(root().className.split(' ')).toEqual(
      expect.arrayContaining(['cursor-col-resize', 'select-none']),
    )
    // The pointer held the divider 4 px right of its center, and still does.
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 810 })
    expect(value()).toBe(70)
    expect(root().style.getPropertyValue('--split')).toBe('0.7')
    fireEvent.pointerUp(separator(), { pointerId: 1, clientX: 810 })
    expect(separator().dataset.dragging).toBeUndefined()
    expect(root().className).not.toContain('select-none')
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 300 })
    expect(value()).toBe(70)
  })

  it('drags a column with the pointer’s y', () => {
    renderSplit({ direction: 'column' })
    layout(box(0, 50, 800, 612), box(0, 350, 800, 12))
    fireEvent.pointerDown(separator(), { pointerId: 3, button: 0, clientY: 356 })
    fireEvent.pointerMove(separator(), { pointerId: 3, clientY: 206 })
    expect(value()).toBe(25)
  })

  it('holds a drag to min and max, and persists it', () => {
    renderSplit({ storageKey: 'arena' })
    layout(box(0, 0, 1012, 400), box(500, 0, 12, 400))
    fireEvent.pointerDown(separator(), { pointerId: 1, button: 0, clientX: 506 })
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 5000 })
    expect(value()).toBe(90)
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: -5000 })
    expect(value()).toBe(10)
    expect(localStorage.getItem('split:arena')).toBe('0.1')
  })

  it('ignores moves without a press, other buttons, and other pointers', () => {
    renderSplit()
    layout(box(0, 0, 1012, 400), box(500, 0, 12, 400))
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 800 })
    fireEvent.pointerDown(separator(), { pointerId: 1, button: 2, clientX: 506 })
    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 800 })
    expect(separator().dataset.dragging).toBeUndefined()
    fireEvent.pointerDown(separator(), { pointerId: 1, button: 0, clientX: 506 })
    fireEvent.pointerMove(separator(), { pointerId: 2, clientX: 800 })
    fireEvent.pointerUp(separator(), { pointerId: 2 })
    expect(separator().dataset.dragging).toBe('true')
    expect(value()).toBe(50)
  })

  it('ends a drag when the pointer is cancelled or loses capture', () => {
    renderSplit()
    layout(box(0, 0, 1012, 400), box(500, 0, 12, 400))
    fireEvent.pointerDown(separator(), { pointerId: 1, button: 0, clientX: 506 })
    fireEvent.pointerCancel(separator(), { pointerId: 1 })
    expect(separator().dataset.dragging).toBeUndefined()
    fireEvent.pointerDown(separator(), { pointerId: 4, button: 0, clientX: 506 })
    fireEvent.lostPointerCapture(separator(), { pointerId: 4 })
    expect(separator().dataset.dragging).toBeUndefined()
    fireEvent.pointerMove(separator(), { pointerId: 4, clientX: 800 })
    expect(value()).toBe(50)
  })

  it('folds the second pane when collapsed, keeps both panes mounted, and keeps the ratio', () => {
    const { rerender } = render(
      <SplitPane label="strip height" direction="column" defaultRatio={0.7}>
        <p>editor</p>
        <p>strip</p>
      </SplitPane>,
    )
    const split = root()
    const first = split.firstElementChild as HTMLElement
    const second = split.lastElementChild as HTMLElement
    press('ArrowUp')
    expect(value()).toBe(68)
    const fold = (collapsed: boolean) =>
      rerender(
        <SplitPane label="strip height" direction="column" defaultRatio={0.7} collapsed={collapsed}>
          <p>editor</p>
          <p>strip</p>
        </SplitPane>,
      )
    fold(true)
    const divider = screen.getByRole('separator', { hidden: true })
    expect(divider.hidden).toBe(true)
    expect(screen.queryByRole('separator')).toBeNull()
    expect(first.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'overflow-auto']))
    expect(first.className).not.toContain('basis-')
    expect(second.className.split(' ')).toEqual(expect.arrayContaining(['shrink-0']))
    expect(second.className).not.toContain('flex-1')
    // The same elements: nothing inside mounts anew.
    expect(split.firstElementChild).toBe(first)
    expect(split.lastElementChild).toBe(second)
    fold(false)
    expect(separator().hidden).toBe(false)
    expect(value()).toBe(68)
    expect(first.className).toContain('basis-[calc((100%-var(--space-3))*var(--split))]')
    expect(second.className).toContain('flex-1')
  })

  it('passes className, style, and attributes through to the container', () => {
    renderSplit({ className: 'h-full', style: { opacity: 0.5 }, id: 'editor-split' })
    expect(root().className.endsWith(' h-full')).toBe(true)
    expect(root().id).toBe('editor-split')
    expect(root().style.opacity).toBe('0.5')
    expect(root().style.getPropertyValue('--split')).toBe('0.5')
  })
})
