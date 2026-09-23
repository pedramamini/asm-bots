import type { Placement } from '@floating-ui/react-dom'
import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { LAYER_CLASSES, useFloatingLayer } from '../hooks/useFloatingLayer'
import { mergeRefs, type TriggerProps } from '../refs'
import { cx } from '../style'

/** The wait before a tooltip shows, ms. */
export const TOOLTIP_DELAY = 400
/** How long a tooltip stays after the pointer leaves the trigger, ms: time to move onto it. */
const GRACE = 100

export interface TooltipProps {
  /** What the tooltip says: `step`, with a `<Kbd>` for its key. */
  content: ReactNode
  /** The one element it explains: a button, a link, a chip. It takes a ref and the handlers. */
  children: ReactElement<TriggerProps>
  /** The side it prefers; it flips when that side has no room. */
  placement?: Placement | undefined
  /** The wait before it shows, ms. */
  delay?: number | undefined
  /**
   * The tooltip describes the trigger (`aria-describedby`) while it shows. False when it only
   * repeats the trigger's name, as an icon button's does: it is hidden from assistive tech then.
   */
  describe?: boolean | undefined
}

/**
 * A short label that shows 400 ms after the pointer rests on the trigger, or its keyboard focus,
 * placed by floating-ui on the preferred side, 6 px out. It hides when the pointer or the focus
 * leaves, on a press, and on Escape; the pointer can cross onto it without it hiding (WCAG 1.4.13).
 * `--panel` fill, a strong hairline, 12 px data type.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = TOOLTIP_DELAY,
  describe = true,
}: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const layer = useFloatingLayer(open, placement, 6)
  const trigger = children.props
  const ref = useMemo(() => mergeRefs(trigger.ref, layer.reference), [trigger.ref, layer.reference])

  /** Opens or closes after `ms`, in place of any change already waiting. */
  const later = (ms: number, next: boolean) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  // Escape hides it wherever the focus is: the pointer may be resting on a trigger never focused.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      clearTimeout(timer.current)
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {cloneElement(children, {
        ref,
        'aria-describedby': cx(trigger['aria-describedby'], open && describe && id) || undefined,
        onPointerEnter: (event) => {
          trigger.onPointerEnter?.(event)
          // A touch has no hover: a tap would show it just as the press hides it.
          if (event.pointerType !== 'touch') later(delay, true)
        },
        onPointerLeave: (event) => {
          trigger.onPointerLeave?.(event)
          if (open) later(GRACE, false)
          else hide()
        },
        onPointerDown: (event) => {
          trigger.onPointerDown?.(event)
          hide()
        },
        onFocus: (event) => {
          trigger.onFocus?.(event)
          // Keyboard focus only: a click focuses a button too, and the press just hid the tooltip.
          if (focusVisible(event.currentTarget)) later(delay, true)
        },
        onBlur: (event) => {
          trigger.onBlur?.(event)
          hide()
        },
        onKeyDown: (event) => {
          trigger.onKeyDown?.(event)
          if (event.key === 'Escape') hide()
        },
      })}
      {open && (
        <span
          ref={layer.floating}
          id={id}
          role="tooltip"
          popover="manual"
          aria-hidden={describe ? undefined : true}
          style={layer.style}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={hide}
          className={cx(
            LAYER_CLASSES,
            'z-modal flex max-w-80 items-center gap-2 rounded-sm border border-border-strong bg-panel px-2 py-1 text-data text-text transition-opacity duration-120 ease-out',
            !layer.positioned && 'opacity-0',
          )}
        >
          {content}
        </span>
      )}
    </>
  )
}

/** True when the element shows keyboard focus; true where the browser cannot tell. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}
