import type { ComponentProps } from 'react'
import { CONTROL_BOX, CONTROL_SIZE, DISABLED, FOCUS_RING, IDLE, ON } from '../control'
import { useControllable } from '../hooks/useControllable'
import { cx } from '../style'

export interface ToggleProps extends Omit<ComponentProps<'button'>, 'onChange'> {
  /** On or off, when the caller holds the state. */
  pressed?: boolean | undefined
  /** On or off at first, when the toggle holds its own state. */
  defaultPressed?: boolean | undefined
  onPressedChange?: ((pressed: boolean) => void) | undefined
}

/**
 * An on/off button (`aria-pressed`): the reference's `ALPR` filter, the arena's `bloom`. Off, it is
 * a muted UPPER label in a hairline; on, it takes the active nav button's accent. A 6 px square
 * before the label fills when on, so the state reads without color.
 */
export function Toggle({
  pressed,
  defaultPressed = false,
  onPressedChange,
  onClick,
  className,
  children,
  ...rest
}: ToggleProps) {
  const [on, setOn] = useControllable(pressed, defaultPressed, onPressedChange)
  return (
    <button
      type="button"
      aria-pressed={on}
      {...rest}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOn(!on)
      }}
      className={cx(
        CONTROL_BOX,
        CONTROL_SIZE.md,
        'text-nav',
        FOCUS_RING,
        DISABLED,
        on ? ON : IDLE,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx('size-1.5 border border-current', on && 'bg-current')}
      />
      {children}
    </button>
  )
}
