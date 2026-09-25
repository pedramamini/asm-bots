/**
 * Reduced motion (DESIGN_SYSTEM §8): the system's `prefers-reduced-motion`, unless the app
 * overrides it. `applyMotion` puts the user's choice on `<html data-motion>` (`reduce` or `full`;
 * none for `system`), and the kit reads the attribute before the media query in both places it
 * moves things: the `motion-reduce:` and `motion-safe:` variants (tailwind.css) and
 * `useReducedMotion()`. So one setting stills the ticker, the coach marks, the dialogs, the toasts,
 * and the loaders alike.
 */

/** `system` follows `prefers-reduced-motion`; `reduce` and `full` override it. */
export type MotionPreference = 'system' | 'reduce' | 'full'

/** The attribute on `<html>` that carries an override. */
export const MOTION_ATTRIBUTE = 'data-motion'

const QUERY = '(prefers-reduced-motion: reduce)'

const listeners = new Set<() => void>()

/** Sets or clears the override on `<html>`, and tells `useReducedMotion()`. No DOM: nothing. */
export function applyMotion(preference: MotionPreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (preference === 'system') root.removeAttribute(MOTION_ATTRIBUTE)
  else root.setAttribute(MOTION_ATTRIBUTE, preference)
  for (const listener of listeners) listener()
}

/** Whether to reduce motion now: the override on `<html>`, else the system's preference. */
export function reducedMotion(): boolean {
  const override =
    typeof document === 'undefined' ? null : document.documentElement.getAttribute(MOTION_ATTRIBUTE)
  if (override === 'reduce') return true
  if (override === 'full') return false
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches
}

/** Calls `onChange` when the answer of `reducedMotion()` may have changed. Returns the unsubscribe. */
export function subscribeMotion(onChange: () => void): () => void {
  listeners.add(onChange)
  const query = typeof matchMedia === 'function' ? matchMedia(QUERY) : null
  query?.addEventListener('change', onChange)
  return () => {
    listeners.delete(onChange)
    query?.removeEventListener('change', onChange)
  }
}
