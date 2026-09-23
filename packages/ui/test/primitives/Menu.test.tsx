import { afterEach, describe, expect, it } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Copy, EllipsisVertical, Trash2 } from 'lucide-react'
import { createRef } from 'react'
import { Button, IconButton, Menu, type MenuEntry, type MenuProps, Toolbar } from '../../src/index'
import { html, useDom, window } from '../dom'

useDom()

const undo: (() => void)[] = []
afterEach(() => {
  for (const restore of undo.splice(0)) restore()
})

/** Every choice the test's items made, in order. */
let chosen: string[] = []

function entries(): MenuEntry[] {
  chosen = []
  const item = (label: string, extra: object = {}) => ({
    label,
    onSelect: () => chosen.push(label),
    ...extra,
  })
  return [
    item('blank'),
    item('imp'),
    item('dwarf', { icon: Copy, shortcut: 'd' }),
    item('scanner skeleton', { disabled: true }),
    'separator',
    item('replicator skeleton'),
    item('delete', { icon: Trash2, danger: true }),
  ]
}

function renderMenu(props: Partial<MenuProps> = {}) {
  return render(<Menu trigger={<Button>templates</Button>} items={entries()} {...props} />)
}

const trigger = () => screen.getByRole('button', { name: 'templates' })
const menu = () => screen.queryByRole('menu')
const item = (name: string) => screen.getByRole('menuitem', { name })
const focused = () => document.activeElement?.textContent

/** Presses `key` on whatever has focus and says whether the menu took it. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(document.activeElement as HTMLElement, { key, ...init })
}

/** Opens the menu with a click, as a pointer does: press, then click. */
function clickOpen(): void {
  fireEvent.pointerDown(trigger())
  fireEvent.click(trigger())
}

describe('Menu', () => {
  it('draws the trigger and, open, the menu under it', () => {
    const { container } = renderMenu()
    clickOpen()
    expect(html(container)).toMatchSnapshot()
  })

  it('is a menu button: haspopup, expanded, and controls while open', () => {
    renderMenu()
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().getAttribute('aria-controls')).toBeNull()
    expect(menu()).toBeNull()
    clickOpen()
    const list = menu() as HTMLElement
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(list.id)
    expect(list.getAttribute('aria-labelledby')).toBe(trigger().id)
    expect(screen.getByRole('menu', { name: 'templates' })).toBe(list)
  })

  it('lists menuitems off the Tab order, with a separator between the groups', () => {
    renderMenu()
    clickOpen()
    const items = screen.getAllByRole('menuitem')
    expect(items.map((each) => each.textContent)).toEqual([
      'blank',
      'imp',
      'dwarfd',
      'scanner skeleton',
      'replicator skeleton',
      'delete',
    ])
    expect(items.every((each) => each.tabIndex === -1)).toBe(true)
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    // The shortcut shows but does not join the item's name.
    expect(item('dwarf').querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('opens on a click and focuses the first item; a second click closes it', () => {
    renderMenu()
    clickOpen()
    expect(focused()).toBe('blank')
    clickOpen()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('opens with Down Arrow on the first item and Up Arrow on the last', () => {
    renderMenu()
    trigger().focus()
    expect(press('ArrowDown')).toBe(true)
    expect(focused()).toBe('blank')
    press('Escape')
    expect(press('ArrowUp')).toBe(true)
    expect(focused()).toBe('delete')
  })

  it('opens with Enter and Space (the button’s click)', () => {
    renderMenu()
    trigger().focus()
    fireEvent.click(trigger(), { detail: 0 })
    expect(focused()).toBe('blank')
  })

  it('moves through the enabled items with Down and Up, and wraps', () => {
    renderMenu()
    clickOpen()
    const path: (string | null | undefined)[] = []
    for (const key of [
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
    ]) {
      expect(press(key)).toBe(true)
      path.push(focused())
    }
    expect(path).toEqual(['imp', 'dwarfd', 'replicator skeleton', 'delete', 'blank', 'imp'])
    press('ArrowUp')
    press('ArrowUp')
    expect(focused()).toBe('delete')
  })

  it('goes to the first and last item with Home and End', () => {
    renderMenu()
    clickOpen()
    expect(press('End')).toBe(true)
    expect(focused()).toBe('delete')
    expect(press('Home')).toBe(true)
    expect(focused()).toBe('blank')
  })

  it('jumps to the next item that starts with a typed letter', () => {
    renderMenu()
    clickOpen()
    expect(press('d')).toBe(true)
    expect(focused()).toBe('dwarfd')
    press('D')
    expect(focused()).toBe('delete')
    press('d')
    expect(focused()).toBe('dwarfd')
    // A disabled item is not a stop, and a letter nothing starts with is left alone.
    expect(press('s')).toBe(false)
    expect(press('q')).toBe(false)
    expect(focused()).toBe('dwarfd')
  })

  it('chooses with a click: returns to the trigger, runs the item, and closes', () => {
    const seen: string[] = []
    render(
      <Menu
        trigger={<Button>templates</Button>}
        items={[
          {
            label: 'imp',
            onSelect: () =>
              seen.push(document.activeElement === trigger() ? 'trigger' : 'elsewhere'),
          },
        ]}
      />,
    )
    clickOpen()
    fireEvent.click(item('imp'))
    expect(seen).toEqual(['trigger'])
    expect(menu()).toBeNull()
  })

  it('lets a chosen item move the focus on (to a dialog it opens)', () => {
    render(
      <>
        <Menu
          trigger={<Button>templates</Button>}
          items={[{ label: 'rename', onSelect: () => screen.getByRole('textbox').focus() }]}
        />
        <input aria-label="new name" />
      </>,
    )
    clickOpen()
    fireEvent.click(item('rename'))
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
    expect(menu()).toBeNull()
  })

  it('chooses the focused item with Enter (the item’s click)', () => {
    renderMenu()
    clickOpen()
    press('ArrowDown')
    fireEvent.click(document.activeElement as HTMLElement)
    expect(chosen).toEqual(['imp'])
  })

  it('does nothing for a disabled item', () => {
    renderMenu()
    clickOpen()
    const disabled = item('scanner skeleton') as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    fireEvent.click(disabled)
    expect(chosen).toEqual([])
    expect(menu()).not.toBeNull()
  })

  it('closes on Escape, returns to the trigger, and keeps the Escape to itself', () => {
    const outer: string[] = []
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a modal that closes on Escape.
      <div onKeyDown={(event) => outer.push(event.key)}>
        <Menu trigger={<Button>templates</Button>} items={entries()} />
      </div>,
    )
    clickOpen()
    expect(press('Escape')).toBe(true)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(outer).toEqual([])
  })

  it('closes on Tab from the trigger, so the Tab moves on to the trigger’s neighbor', () => {
    renderMenu()
    clickOpen()
    press('ArrowDown')
    // The browser moves the focus after the keydown: the menu leaves the default alone.
    expect(press('Tab')).toBe(false)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on a press outside and leaves the focus to it', () => {
    render(
      <>
        <Menu trigger={<Button>templates</Button>} items={entries()} />
        <input aria-label="search" />
      </>,
    )
    clickOpen()
    fireEvent.pointerDown(document.body)
    expect(menu()).toBeNull()
    expect(document.activeElement).not.toBe(trigger())
  })

  it('stays open for a press inside it', () => {
    renderMenu()
    clickOpen()
    fireEvent.pointerDown(item('scanner skeleton'))
    fireEvent.pointerDown(screen.getByRole('separator'))
    expect(menu()).not.toBeNull()
  })

  it('closes when the focus leaves for elsewhere, and not when it moves inside', () => {
    render(
      <>
        <Menu trigger={<Button>templates</Button>} items={entries()} />
        <input aria-label="search" />
      </>,
    )
    clickOpen()
    act(() => item('imp').focus())
    expect(menu()).not.toBeNull()
    act(() => (menu() as HTMLElement).focus())
    expect(menu()).not.toBeNull()
    act(() => screen.getByRole('textbox').focus())
    expect(menu()).toBeNull()
  })

  it('moves the focus to the item under the pointer', () => {
    renderMenu()
    clickOpen()
    fireEvent.pointerMove(item('replicator skeleton'))
    expect(focused()).toBe('replicator skeleton')
    press('ArrowDown')
    expect(focused()).toBe('delete')
  })

  it('draws the focused item in the accent fill and a danger item in --danger', () => {
    renderMenu()
    clickOpen()
    expect(item('imp').className.split(' ')).toEqual(
      expect.arrayContaining(['h-6', 'text-text', 'focus:bg-accent-10', 'focus:text-accent']),
    )
    expect(item('delete').className.split(' ')).toEqual(
      expect.arrayContaining(['text-danger', 'focus:bg-danger/10']),
    )
    expect((menu() as HTMLElement).className.split(' ')).toEqual(
      expect.arrayContaining(['bg-panel', 'border', 'border-border-strong', 'rounded-md', 'p-1']),
    )
  })

  it('stays focusable while floating-ui places it: transparent, never invisible', () => {
    renderMenu()
    clickOpen()
    // jsdom lays nothing out, so the menu is never placed here, as in a browser's first frame.
    const names = (menu() as HTMLElement).className.split(' ')
    expect(names).toContain('opacity-0')
    expect(names.filter((name) => ['invisible', 'hidden', 'collapse'].includes(name))).toEqual([])
    expect(focused()).toBe('blank')
  })

  it('is a manual popover in the top layer where the browser has the API', () => {
    const shown: Element[] = []
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
    proto.showPopover = function showPopover(this: Element) {
      shown.push(this)
    }
    undo.push(() => {
      delete proto.showPopover
    })
    renderMenu()
    clickOpen()
    expect(menu()?.getAttribute('popover')).toBe('manual')
    expect(shown).toEqual([menu() as HTMLElement])
  })

  it('keeps the trigger’s own id, ref, and handlers', () => {
    const ref = createRef<HTMLButtonElement>()
    const calls: string[] = []
    render(
      <Menu
        trigger={
          <Button
            ref={ref}
            id="templates"
            onClick={() => calls.push('click')}
            onKeyDown={(event) => calls.push(event.key)}
          >
            templates
          </Button>
        }
        items={entries()}
      />,
    )
    expect(ref.current).toBe(trigger() as HTMLButtonElement)
    expect(trigger().id).toBe('templates')
    clickOpen()
    expect(menu()?.getAttribute('aria-labelledby')).toBe('templates')
    press('Escape')
    press('ArrowDown')
    expect(calls).toEqual(['click', 'ArrowDown'])
  })

  it('lets the trigger’s own handler keep a click', () => {
    render(
      <Menu
        trigger={<Button onClick={(event) => event.preventDefault()}>templates</Button>}
        items={entries()}
      />,
    )
    clickOpen()
    expect(menu()).toBeNull()
  })

  it('opens from an icon button, named by the button’s label', () => {
    render(<Menu trigger={<IconButton icon={EllipsisVertical} label="more" />} items={entries()} />)
    const more = screen.getByRole('button', { name: 'more' })
    fireEvent.pointerDown(more)
    fireEvent.click(more)
    expect(screen.getByRole('menu', { name: 'more' })).not.toBeNull()
    expect(focused()).toBe('blank')
  })

  it('keeps Left and Right from a toolbar around it', () => {
    render(
      <Toolbar aria-label="editor">
        <Menu trigger={<Button>templates</Button>} items={entries()} />
        <button type="button">format</button>
      </Toolbar>,
    )
    clickOpen()
    expect(press('ArrowRight')).toBe(true)
    expect(press('ArrowLeft')).toBe(true)
    expect(focused()).toBe('blank')
  })

  it('passes className and attributes through to the menu', () => {
    renderMenu({ className: 'min-w-56', 'data-kind': 'templates' } as Partial<MenuProps>)
    clickOpen()
    const list = menu() as HTMLElement
    expect(list.className.endsWith(' min-w-56')).toBe(true)
    expect(list.dataset.kind).toBe('templates')
  })
})
