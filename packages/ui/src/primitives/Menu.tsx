import type { Placement } from '@floating-ui/react-dom'
import type { LucideIcon } from 'lucide-react'
import {
  type ComponentProps,
  cloneElement,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { drawIcon } from '../control'
import { LAYER_CLASSES, useFloatingLayer } from '../hooks/useFloatingLayer'
import { mergeRefs, type TriggerProps } from '../refs'
import { cx } from '../style'
import { Kbd } from './Kbd'

export interface MenuItem {
  /** Lowercase, as a control's text is: `rename`. Type-ahead matches its first letter. */
  label: string
  /** What the item does. The focus is back on the trigger by then, so it may move it on. */
  onSelect: () => void
  /** A 12 px lucide icon before the label. */
  icon?: LucideIcon | undefined
  /** The key that does the same, shown at the right. */
  shortcut?: string | undefined
  /** Shown faded; the keys skip it and a click does nothing. */
  disabled?: boolean | undefined
  /** A destructive item, in `--danger`. */
  danger?: boolean | undefined
}

/** An item, or a hairline between two groups of items. */
export type MenuEntry = MenuItem | 'separator'

export interface MenuProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The button that opens the menu (a Button, an IconButton). It takes a ref and the handlers. */
  trigger: ReactElement<TriggerProps>
  items: readonly MenuEntry[]
  /** The side it opens on; it flips when that side has no room. */
  placement?: Placement | undefined
}

/** The enabled items of `menu`, in order. */
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return menu === null ? [] : [...menu.querySelectorAll<HTMLElement>('[role=menuitem]:enabled')]
}

/**
 * A menu button (the WAI-ARIA pattern): the trigger opens a list of actions under it, placed by
 * floating-ui. Opening focuses the first item (Up Arrow on the trigger: the last). In the menu,
 * Down and Up move through the enabled items and wrap, Home and End go to the ends, a letter jumps
 * to the next item that starts with it, Enter and Space choose. Escape closes it and returns to the
 * trigger; Tab closes it and moves on from the trigger; a press outside closes it. `--panel` fill,
 * a strong hairline, radius 4; the focused item takes the 10% accent fill. `className` and the
 * other props go to the menu.
 */
export function Menu({
  trigger,
  items,
  placement = 'bottom-start',
  className,
  style,
  onKeyDown,
  onBlur,
  ...rest
}: MenuProps) {
  const menuId = useId()
  const ownId = useId()
  const triggerId = trigger.props.id ?? ownId
  const [open, setOpen] = useState(false)
  const layer = useFloatingLayer(open, placement, 4)
  const triggerNode = useRef<HTMLElement>(null)
  const menuNode = useRef<HTMLDivElement>(null)
  /** Which end of the menu takes the focus as it opens. */
  const start = useRef<'first' | 'last'>('first')
  const triggerRef = useMemo(
    () => mergeRefs(trigger.props.ref, layer.reference, triggerNode),
    [trigger.props.ref, layer.reference],
  )
  const menuRef = useMemo(() => mergeRefs(layer.floating, menuNode), [layer.floating])

  const focusEnd = (end: 'first' | 'last') => {
    const list = itemsOf(menuNode.current)
    list.at(end === 'first' ? 0 : -1)?.focus({ preventScroll: true })
  }
  const show = (end: 'first' | 'last') => {
    start.current = end
    if (open) focusEnd(end)
    else setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerNode.current?.focus()
  }

  // Into the menu as it opens.
  useEffect(() => {
    if (!open) return
    const list = itemsOf(menuNode.current)
    list.at(start.current === 'first' ? 0 : -1)?.focus({ preventScroll: true })
  }, [open])

  // A press anywhere but the menu and its trigger closes it, and leaves the focus to the press.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuNode.current?.contains(target) || triggerNode.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const list = itemsOf(event.currentTarget)
    const at = list.indexOf(document.activeElement as HTMLElement)
    const go = (index: number) => {
      event.preventDefault()
      list.at(index % list.length)?.focus({ preventScroll: true })
    }
    switch (event.key) {
      case 'ArrowDown':
        return go(at + 1)
      case 'ArrowUp':
        return go(at < 0 ? -1 : at - 1)
      case 'Home':
        return go(0)
      case 'End':
        return go(-1)
      case 'ArrowLeft':
      case 'ArrowRight':
        // No submenus: the keys do nothing here, and a toolbar around the menu must not take them.
        event.preventDefault()
        return
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        return close(true)
      case 'Tab':
        // From the trigger, the Tab (or Shift+Tab) goes on to the trigger's neighbor.
        return close(true)
    }
    if (event.key.length !== 1 || event.key === ' ') return
    const letter = event.key.toLowerCase()
    const next = [...list.slice(at + 1), ...list.slice(0, at + 1)].find((item) =>
      item.textContent?.toLowerCase().startsWith(letter),
    )
    if (next === undefined) return
    event.preventDefault()
    next.focus({ preventScroll: true })
  }

  return (
    <>
      {cloneElement(trigger, {
        ref: triggerRef,
        id: triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: (event) => {
          trigger.props.onClick?.(event)
          if (event.defaultPrevented) return
          // Closing from the trigger returns the focus there: it may be on an item going away.
          if (open) close(true)
          else show('first')
        },
        onKeyDown: (event) => {
          trigger.props.onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          show(event.key === 'ArrowDown' ? 'first' : 'last')
        },
      })}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          popover="manual"
          // Focusable, so a click on a separator or a disabled item keeps the focus in the menu.
          tabIndex={-1}
          {...rest}
          style={{ ...style, ...layer.style }}
          onKeyDown={onMenuKeyDown}
          onBlur={(event) => {
            onBlur?.(event)
            const next = event.relatedTarget
            if (next !== null && event.currentTarget.contains(next)) return
            if (next !== null && triggerNode.current?.contains(next)) return
            setOpen(false)
          }}
          className={cx(
            LAYER_CLASSES,
            'z-modal flex min-w-40 flex-col rounded-md border border-border-strong bg-panel p-1 text-data text-text outline-hidden transition-opacity duration-120 ease-out',
            // Transparent, not hidden, until placed: a hidden item cannot take the focus.
            !layer.positioned && 'opacity-0',
            className,
          )}
        >
          {items.map((entry, index) =>
            entry === 'separator' ? (
              // A separator is known only by its place.
              <hr key={index} className="-mx-1 my-1 border-border" />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={entry.disabled}
                onClick={() => {
                  close(true)
                  entry.onSelect()
                }}
                onPointerMove={(event) => {
                  const item = event.currentTarget
                  if (document.activeElement !== item) item.focus({ preventScroll: true })
                }}
                className={cx(
                  'flex h-6 w-full items-center gap-2 rounded-sm px-2 text-left whitespace-nowrap outline-hidden disabled:cursor-not-allowed disabled:opacity-40',
                  entry.danger
                    ? 'text-danger focus:bg-danger/10'
                    : 'text-text focus:bg-accent-10 focus:text-accent',
                )}
              >
                {drawIcon(entry.icon, 12)}
                <span className="flex-1">{entry.label}</span>
                {entry.shortcut !== undefined && <Kbd aria-hidden="true">{entry.shortcut}</Kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </>
  )
}
