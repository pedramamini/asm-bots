import { useState } from 'react'

/**
 * A control's value, controlled or not: `value` when the caller passes it, else the control's own
 * state from `defaultValue`. The setter updates the own state and calls `onChange` when the value
 * changes; a controlled control changes only when the caller passes the new value back.
 */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange: ((value: T) => void) | undefined,
): [T, (next: T) => void] {
  const [own, setOwn] = useState(defaultValue)
  const current = value === undefined ? own : value
  const set = (next: T) => {
    if (value === undefined) setOwn(next)
    if (!Object.is(next, current)) onChange?.(next)
  }
  return [current, set]
}
