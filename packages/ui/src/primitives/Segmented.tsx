import { type ComponentProps, type KeyboardEvent, type ReactNode, useRef } from 'react'
import { CONTROL_BOX, CONTROL_SIZE, DISABLED, FOCUS_RING, IDLE } from '../control'
import { useControllable } from '../hooks/useControllable'
import { cx } from '../style'

export interface SegmentedOption<T extends string> {
  value: T
  /** The pill's text; the value when absent. */
  label?: ReactNode
  disabled?: boolean | undefined
}

export interface SegmentedProps<T extends string>
  extends Omit<ComponentProps<'div'>, 'onChange' | 'defaultValue' | 'children'> {
  /** The choices, left to right: a value is its own label. */
  options: readonly (T | SegmentedOption<T>)[]
  /** The group's accessible name, after what it picks: "range". */
  label: string
  /** The chosen value, when the caller holds the state. */
  value?: T | undefined
  /** The chosen value at first, when the control holds its own state. */
  defaultValue?: T | undefined
  onValueChange?: ((value: T) => void) | undefined
}

/** The chosen pill: accent border and text, no fill (the reference's `WEEK`). */
const CHOSEN = 'border-accent text-accent-fg'

/** The keys that move the choice, as a step through the enabled pills or an end. */
const MOVES: Readonly<Record<string, 'next' | 'previous' | 'first' | 'last'>> = {
  ArrowRight: 'next',
  ArrowDown: 'next',
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
}

/**
 * One choice of a few (DESIGN_SYSTEM §4): bordered UPPER pills 2 px apart, the chosen one accent.
 * It is a radio group with one tab stop, the chosen pill (or the first); the arrow keys move the
 * choice through the enabled pills and wrap, Home and End go to the ends. Inside a toolbar it keeps
 * the arrow keys to itself.
 */
export function Segmented<T extends string>({
  options,
  label,
  value,
  defaultValue,
  onValueChange,
  onKeyDown,
  className,
  ...rest
}: SegmentedProps<T>) {
  const items = options.map((option) => (typeof option === 'string' ? { value: option } : option))
  const [chosen, choose] = useControllable<T | undefined>(value, defaultValue, (next) => {
    if (next !== undefined) onValueChange?.(next)
  })
  const pills = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]))
  const chosenIndex = items.findIndex((item) => item.value === chosen && !item.disabled)
  const stop = chosenIndex >= 0 ? chosenIndex : enabled[0]

  const onGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    const move = MOVES[event.key]
    if (event.defaultPrevented || move === undefined) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const at = enabled.indexOf(pills.current.indexOf(event.target as HTMLButtonElement))
    if (at < 0) return
    event.preventDefault()
    const steps = { next: at + 1, previous: at - 1, first: 0, last: enabled.length - 1 }
    const index = enabled[(steps[move] + enabled.length) % enabled.length] as number
    pills.current[index]?.focus()
    choose((items[index] as SegmentedOption<T>).value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...rest}
      onKeyDown={onGroupKeyDown}
      className={cx('inline-flex items-center gap-0.5', className)}
    >
      {items.map((item, index) => {
        const checked = item.value === chosen
        return (
          // biome-ignore lint/a11y/useSemanticElements: a pill in a roving radio group, not a form field.
          <button
            key={item.value}
            ref={(node) => {
              pills.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === stop ? 0 : -1}
            disabled={item.disabled}
            onClick={() => choose(item.value)}
            className={cx(
              CONTROL_BOX,
              CONTROL_SIZE.md,
              'text-nav',
              FOCUS_RING,
              DISABLED,
              checked ? CHOSEN : IDLE,
            )}
          >
            {item.label ?? item.value}
          </button>
        )
      })}
    </div>
  )
}
